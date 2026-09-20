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

export async function mergePull(client, { owner, repo, number, method = 'merge', commitTitle, commitMessage, deleteBranch = false }) {
  ensureRepo({ owner, repo })
  if (!number) throw new Error('number is required')
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

  return {
    pull: pullData,
    areas: areasFor(files),
    files: files.map(({ patch, ...rest }) => ({ ...rest, patchChars: patch.length })),
    findings: analyzePull({ files, rules }),
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
