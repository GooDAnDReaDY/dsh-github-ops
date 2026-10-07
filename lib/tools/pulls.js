import { encodeRepoPath } from '../github.js'
import { pushFiles } from './write-files.js'
import { analyzePull, areasFor, verdictFor } from '../review-rules.js'

export { areasFor }

// Pull request operations: create, update, merge, read a review pack
// (metadata + capped diff + comments + CI + rule-based findings), publish a review,
// and read the check rollup. The findings are deterministic rules, not an LLM: they
// point the reader at what needs human attention and never pretend to be a verdict
// on correctness.

function ensureRepo({ owner, repo }) {
  if (!owner || !repo) {
    throw new Error('owner and repo are required (pass "repository": "owner/repo" or set defaults in settings)')
  }
}

export function normalizePull(data) {
  if (!data || typeof data !== 'object') return data
  return {
    number: data.number,
    title: data.title,
    state: data.state,
    draft: Boolean(data.draft),
    merged: Boolean(data.merged),
    mergeable: data.mergeable,
    mergeableState: data.mergeable_state,
    author: data.user && data.user.login,
    head: data.head && data.head.ref,
    base: data.base && data.base.ref,
    additions: data.additions,
    deletions: data.deletions,
    changedFiles: data.changed_files,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    url: data.html_url,
    body: typeof data.body === 'string' ? data.body : '',
    labels: Array.isArray(data.labels) ? data.labels.map((l) => (typeof l === 'string' ? l : l.name)) : [],
    requestedReviewers: Array.isArray(data.requested_reviewers)
      ? data.requested_reviewers.map((r) => r.login)
      : [],
  }
}

export async function createPull(client, { owner, repo, title, head, base, body, draft = false }) {
  ensureRepo({ owner, repo })
  if (!title) throw new Error('title is required')
  if (!head) throw new Error('head branch is required')
  const payload = { title, head, base: base || 'main', body: body || '', draft: Boolean(draft) }
  const { data } = await client.post(`/repos/${owner}/${repo}/pulls`, payload)
  return normalizePull(data)
}

export async function updatePull(client, { owner, repo, number, title, body, state, base }) {
  ensureRepo({ owner, repo })
  if (!number) throw new Error('number is required')
  const payload = {}
  if (title !== undefined) payload.title = title
  if (body !== undefined) payload.body = body
  if (state !== undefined) payload.state = state
  if (base !== undefined) payload.base = base
  if (!Object.keys(payload).length) throw new Error('nothing to update: pass title, body, state or base')
  const { data } = await client.patch(`/repos/${owner}/${repo}/pulls/${number}`, payload)
  return normalizePull(data)
}

const MERGE_METHODS = { merge: 'merge', squash: 'squash', rebase: 'rebase' }

export async function mergePull(client, { owner, repo, number, method = 'merge', commitTitle, commitMessage, deleteBranch = false, requireSigned = false }) {
  ensureRepo({ owner, repo })
  if (!number) throw new Error('number is required')
  if (requireSigned) {
    const sigs = await getPullCommitSignatures(client, { owner, repo, number })
    if (!sigs.allVerified) {
      throw new Error(`cannot merge pull request #${number}: ${sigs.warning}`)
    }
  }
  const mergeMethod = MERGE_METHODS[String(method).toLowerCase()]
  if (!mergeMethod) throw new Error(`method must be one of: ${Object.keys(MERGE_METHODS).join(', ')}`)
  const payload = { merge_method: mergeMethod }
  if (commitTitle) payload.commit_title = commitTitle
  if (commitMessage) payload.commit_message = commitMessage
  const { data } = await client.put(`/repos/${owner}/${repo}/pulls/${number}/merge`, payload)
  const result = { merged: Boolean(data && data.merged), message: data && data.message, sha: data && data.sha }
  if (result.merged && deleteBranch) {
    try {
      const pull = await client.get(`/repos/${owner}/${repo}/pulls/${number}`)
      const branch = pull.data && pull.data.head && pull.data.head.ref
      if (branch) {
        await client.del(`/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`)
        result.branchDeleted = branch
      }
    } catch (err) {
      result.branchDeleteError = String(err && err.message || err)
    }
  }
  return result
}

export async function reviewPull(client, { owner, repo, number, maxDiffChars = 60000, rules }) {
  ensureRepo({ owner, repo })
  if (!number) throw new Error('number is required')
  const [pull, filesRes, commentsRes] = await Promise.all([
    client.get(`/repos/${owner}/${repo}/pulls/${number}`),
    client.get(`/repos/${owner}/${repo}/pulls/${number}/files`, { query: { per_page: 100 } }),
    client.get(`/repos/${owner}/${repo}/issues/${number}/comments`, { query: { per_page: 50 } }),
  ])
  const pullData = normalizePull(pull.data)
  const files = Array.isArray(filesRes.data)
    ? filesRes.data.map((f) => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      patch: typeof f.patch === 'string' ? f.patch : '',
    }))
    : []

  let diff = files.map((f) => `--- ${f.filename} (${f.status})\n${f.patch}`).join('\n')
  const diffTruncated = diff.length > maxDiffChars
  if (diffTruncated) diff = diff.slice(0, maxDiffChars)

  let checks = null
  try {
    checks = await getChecks(client, { owner, repo, ref: pullData.head })
  } catch (err) {
    checks = { error: String(err && err.message || err) }
  }

  let signatures = null
  try {
    signatures = await getPullCommitSignatures(client, { owner, repo, number })
  } catch (err) {
    signatures = { error: String((err && err.message) || err) }
  }

  const findings = analyzePull({ files, rules })
  if (signatures && signatures.unverifiedCount > 0) {
    findings.push({
      level: 'attention',
      area: 'security',
      detail: signatures.warning,
    })
  }

  return {
    pull: pullData,
    areas: areasFor(files),
    files: files.map(({ patch, ...rest }) => ({ ...rest, patchChars: patch.length })),
    findings,
    signatures,
    comments: Array.isArray(commentsRes.data)
      ? commentsRes.data.map((c) => ({ id: c.id, author: c.user && c.user.login, body: c.body }))
      : [],
    checks,
    diff,
    diffTruncated,
  }
}

export async function postReview(client, { owner, repo, number, body, mode = 'summary', inline = [] }) {
  ensureRepo({ owner, repo })
  if (!number) throw new Error('number is required')
  if (!body) throw new Error('body is required')
  if (mode === 'inline' && inline.length) {
    const payload = {
      body,
      event: 'COMMENT',
      comments: inline.map((c) => ({ path: c.path, line: c.line, body: c.body })),
    }
    const { data } = await client.post(`/repos/${owner}/${repo}/pulls/${number}/reviews`, payload)
    return { mode: 'inline', id: data && data.id, url: data && data.html_url }
  }
  const { data } = await client.post(`/repos/${owner}/${repo}/issues/${number}/comments`, { body })
  return { mode: 'summary', id: data && data.id, url: data && data.html_url }
}

/** Check rollup: check runs plus legacy commit statuses, normalized to one verdict. */
export async function getChecks(client, { owner, repo, ref }) {
  ensureRepo({ owner, repo })
  if (!ref) throw new Error('ref is required')
  const [runs, statuses] = await Promise.all([
    client.get(`/repos/${owner}/${repo}/commits/${ref}/check-runs`, { query: { per_page: 100 } }),
    client.get(`/repos/${owner}/${repo}/commits/${ref}/status`),
  ])
  const checkRuns = ((runs.data && runs.data.check_runs) || []).map((r) => ({
    name: r.name,
    status: r.status,
    conclusion: r.conclusion,
    url: r.html_url,
  }))
  const state = (statuses.data && statuses.data.state) || 'unknown'
  const failed = checkRuns.filter((r) => r.conclusion && !['success', 'neutral', 'skipped'].includes(r.conclusion))
  const pending = checkRuns.filter((r) => r.status !== 'completed')
  const rollup = failed.length || ['failure', 'error'].includes(state)
    ? 'failure'
    : pending.length || state === 'pending'
      ? 'pending'
      : checkRuns.length || state === 'success'
        ? 'success'
        : 'unknown'
  return { ref, rollup, checkRuns, statuses: (statuses.data && statuses.data.statuses) || [] }
}

/**
 * One-shot CI review run: the review pack plus a deterministic verdict. `success`
 * means no rule found something needing attention, not that the change is correct.
 */
export async function ciRun(client, { owner, repo, number, maxDiffChars, rules }) {
  const pack = await reviewPull(client, { owner, repo, number, maxDiffChars, rules })
  const blocking = pack.findings.filter((f) => f.level === 'critical')
  const attention = pack.findings.filter((f) => f.level === 'attention')
  const verdict = verdictFor({ findings: pack.findings, checkRollup: pack.checks ? pack.checks.rollup : 'unknown' })
  return {
    verdict,
    number: pack.pull.number,
    title: pack.pull.title,
    url: pack.pull.url,
    areas: pack.areas,
    findings: pack.findings,
    checks: pack.checks ? pack.checks.rollup : 'unknown',
    summary: [
      `PR #${pack.pull.number}: ${pack.pull.title}`,
      `areas: ${pack.areas.join(', ') || 'none'}`,
      `checks: ${pack.checks ? pack.checks.rollup : 'unknown'}`,
      blocking.length ? `critical: ${blocking.map((f) => f.detail).join('; ')}` : '',
      attention.length ? `attention: ${attention.map((f) => f.detail).join('; ')}` : '',
      `verdict: ${verdict}`,
    ].filter(Boolean).join('\n'),
  }
}

export async function listReviewThreads(client, { owner, repo, number, unresolvedOnly = false }) {
  ensureRepo({ owner, repo })
  if (!number) throw new Error('number is required')
  const query = `query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        reviewThreads(first: 50) {
          nodes {
            id
            isResolved
            isOutdated
            path
            line
            diffSide
            resolvedBy { login }
            comments(first: 20) {
              nodes {
                id
                databaseId
                body
                author { login }
                createdAt
                url
              }
            }
          }
        }
      }
    }
  }`
  const data = await client.graphql(query, { owner, repo, number: Number(number) })
  const pull = data && data.repository && data.repository.pullRequest
  if (!pull) throw new Error(`pull request #${number} not found in ${owner}/${repo}`)
  const rawNodes = (pull.reviewThreads && pull.reviewThreads.nodes) || []
  let threads = rawNodes.map((t) => ({
    id: t.id,
    isResolved: Boolean(t.isResolved),
    isOutdated: Boolean(t.isOutdated),
    path: t.path || '',
    line: t.line || null,
    diffSide: t.diffSide || 'RIGHT',
    resolvedBy: t.resolvedBy && t.resolvedBy.login ? t.resolvedBy.login : null,
    comments: ((t.comments && t.comments.nodes) || []).map((c) => ({
      id: c.id,
      databaseId: c.databaseId,
      author: (c.author && c.author.login) || 'unknown',
      body: c.body || '',
      createdAt: c.createdAt,
      url: c.url || '',
    })),
  }))
  if (unresolvedOnly) {
    threads = threads.filter((t) => !t.isResolved)
  }
  return { threads, count: threads.length, number: Number(number) }
}

export async function replyReviewThread(client, { owner, repo, number, threadId, commentId, body }) {
  ensureRepo({ owner, repo })
  if (!body || typeof body !== 'string' || !body.trim()) {
    throw new Error('body is required')
  }
  if (!threadId && !commentId) {
    throw new Error('either threadId or commentId is required to reply to a review thread')
  }

  if (threadId) {
    const mutation = `mutation($threadId: ID!, $body: String!) {
      addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $threadId, body: $body }) {
        comment {
          id
          databaseId
          body
          createdAt
        }
      }
    }`
    const data = await client.graphql(mutation, { threadId, body })
    const comment = data?.addPullRequestReviewThreadReply?.comment
    return {
      replied: true,
      threadId,
      commentId: comment?.databaseId || null,
      body,
      createdAt: comment?.createdAt || null,
    }
  }

  if (!number) throw new Error('pull number is required when replying via commentId')
  const { data } = await client.post(`/repos/${owner}/${repo}/pulls/${number}/comments`, {
    body,
    in_reply_to: Number(commentId),
  })
  return {
    replied: true,
    number: Number(number),
    commentId: data?.id || Number(commentId),
    body,
    createdAt: data?.created_at || null,
  }
}

export async function resolveReviewThread(client, { owner, repo, threadId, resolve = true }) {
  ensureRepo({ owner, repo })
  if (!threadId) throw new Error('threadId is required (GraphQL ID of the review thread)')
  const shouldResolve = resolve !== false
  const mutation = shouldResolve
    ? `mutation($threadId: ID!) {
        resolveReviewThread(input: { threadId: $threadId }) {
          thread { id isResolved }
        }
      }`
    : `mutation($threadId: ID!) {
        unresolveReviewThread(input: { threadId: $threadId }) {
          thread { id isResolved }
        }
      }`

  const data = await client.graphql(mutation, { threadId })
  const thread = shouldResolve
    ? data?.resolveReviewThread?.thread
    : data?.unresolveReviewThread?.thread

  if (!thread) {
    throw new Error(`failed to ${shouldResolve ? 'resolve' : 'unresolve'} review thread: mutation returned no thread`)
  }

  return {
    threadId,
    isResolved: Boolean(thread.isResolved),
  }
}

export function parseSuggestionBlock(body) {
  if (!body || typeof body !== 'string') return null
  const match = body.match(/```suggestion(?:\r?\n([\s\S]*?))?\r?\n```/)
  if (!match) return null
  return match[1] !== undefined ? match[1] : ''
}

export async function applySuggestion(client, {
  owner,
  repo,
  pullNumber,
  commentId,
  commentIds,
  confirm = false,
  message,
}) {
  ensureRepo({ owner, repo })
  if (!pullNumber) throw new Error('pullNumber is required')
  if (confirm !== true) {
    throw new Error('refusing to apply suggestion without confirm: true')
  }

  const ids = Array.isArray(commentIds) && commentIds.length > 0
    ? commentIds
    : (commentId ? [commentId] : [])

  if (ids.length === 0) {
    throw new Error('commentId or commentIds is required')
  }

  const { data: pr } = await client.get(`/repos/${owner}/${repo}/pulls/${pullNumber}`)
  if (!pr) throw new Error(`pull request #${pullNumber} not found`)
  if (pr.state !== 'open') {
    throw new Error(`cannot apply suggestion: pull request #${pullNumber} is not open (state: ${pr.state})`)
  }
  const branch = pr.head && pr.head.ref
  if (!branch) throw new Error('cannot resolve head branch for pull request')

  const commentsToApply = []
  for (const id of ids) {
    const { data: comment } = await client.get(`/repos/${owner}/${repo}/pulls/comments/${id}`)
    if (!comment) throw new Error(`comment #${id} not found`)

    if (comment.position === null && comment.original_position !== undefined && comment.original_position !== null) {
      throw new Error(`cannot apply suggestion: comment #${id} is outdated (diff context has changed)`)
    }
    if (comment.outdated === true) {
      throw new Error(`cannot apply suggestion: comment #${id} is outdated`)
    }

    const replacement = parseSuggestionBlock(comment.body)
    if (replacement === null) {
      throw new Error(`cannot apply suggestion: comment #${id} does not contain a markdown suggestion block`)
    }

    const startLine = comment.start_line != null
      ? comment.start_line
      : (comment.original_start_line != null ? comment.original_start_line : (comment.line != null ? comment.line : comment.original_line))
    const endLine = comment.line != null ? comment.line : comment.original_line

    if (startLine == null || endLine == null) {
      throw new Error(`cannot apply suggestion: comment #${id} has no line numbers`)
    }

    commentsToApply.push({
      id,
      path: comment.path,
      startLine,
      endLine,
      replacement,
      user: comment.user && comment.user.login ? comment.user.login : 'reviewer',
    })
  }

  const filesMap = new Map()
  for (const item of commentsToApply) {
    let fileInfo = filesMap.get(item.path)
    if (!fileInfo) {
      const fileRes = await client.get(`/repos/${owner}/${repo}/contents/${encodeRepoPath(item.path)}`, {
        query: { ref: branch },
      })
      if (!fileRes || !fileRes.data || !fileRes.data.content) {
        throw new Error(`cannot apply suggestion: file ${item.path} not found in branch ${branch}`)
      }
      const rawContent = Buffer.from(fileRes.data.content, 'base64').toString('utf8')
      fileInfo = { path: item.path, lines: rawContent.split('\n'), items: [] }
      filesMap.set(item.path, fileInfo)
    }
    fileInfo.items.push(item)
  }

  const changedFiles = []
  const authors = new Set()
  for (const [filePath, fileInfo] of filesMap.entries()) {
    fileInfo.items.sort((a, b) => b.startLine - a.startLine)
    for (const item of fileInfo.items) {
      const startIdx = item.startLine - 1
      const endIdx = item.endLine - 1
      if (startIdx < 0 || endIdx < startIdx || endIdx >= fileInfo.lines.length) {
        throw new Error(`cannot apply suggestion: line range ${item.startLine}-${item.endLine} is out of bounds for ${filePath} (${fileInfo.lines.length} lines)`)
      }
      const replacementLines = item.replacement === '' ? [] : item.replacement.split('\n')
      fileInfo.lines.splice(startIdx, endIdx - startIdx + 1, ...replacementLines)
      authors.add(item.user)
    }
    changedFiles.push({ path: filePath, content: fileInfo.lines.join('\n') })
  }

  const authorList = Array.from(authors).map((a) => `@${a}`).join(', ')
  const commitMsg = message || `Apply suggestion from ${authorList}\n\nRefs: #${pullNumber}`
  const pushRes = await pushFiles(client, {
    owner,
    repo,
    branch,
    message: commitMsg,
    files: changedFiles,
  })

  return {
    applied: true,
    commit: pushRes.commit,
    branch,
    pullNumber: Number(pullNumber),
    commentIds: ids,
    files: changedFiles.map((f) => f.path),
  }
}

export async function getPullCommitSignatures(client, { owner, repo, number }) {
  ensureRepo({ owner, repo })
  if (!number) throw new Error('number is required')

  const { data: commits } = await client.get(`/repos/${owner}/${repo}/pulls/${number}/commits`, {
    query: { per_page: 100 },
  })

  const list = Array.isArray(commits) ? commits : []
  const audit = []
  let unverifiedCount = 0

  for (const c of list) {
    const sha = c.sha || ''
    const shortSha = sha.slice(0, 7)
    const author = c.commit?.author?.name || c.author?.login || ''
    const verification = c.commit?.verification || {}
    const verified = Boolean(verification.verified)
    const reason = verification.reason || (verified ? 'valid' : 'unsigned')

    if (!verified) unverifiedCount++
    audit.push({
      sha,
      shortSha,
      author,
      verified,
      reason,
      signature: Boolean(verification.signature),
    })
  }

  const allVerified = list.length > 0 && unverifiedCount === 0
  const unverifiedCommits = audit.filter((c) => !c.verified)
  const warning = unverifiedCount > 0
    ? `pull request #${number} contains ${unverifiedCount} unverified commit(s): ${unverifiedCommits.map((c) => c.shortSha).join(', ')}`
    : null

  return {
    pullNumber: Number(number),
    totalCommits: list.length,
    allVerified,
    unverifiedCount,
    commits: audit,
    unverifiedCommits,
    warning,
  }
}
