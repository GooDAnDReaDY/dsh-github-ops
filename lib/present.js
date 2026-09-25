// Tool presentation: what the human sees instead of a JSON blob.
//
// `presentCall` renders the pending card before a tool runs, `presentResult` the completed
// one. Both are pure: they take the arguments and the tool result and return a card, which
// keeps them testable and cheap. A missing presentation simply falls back to the default
// renderer, so an unlisted tool is never broken.

const text = (title, body) => ({
  card: 'generic',
  title,
  content: [{ type: 'text', text: body }],
})

const pending = (title, rawInput) => ({ card: 'generic', title, rawInput })

/** Reduce an arbitrary argument set to the fields a pending card should show. */
function pick(args, keys) {
  const out = {}
  for (const key of keys) if (args && args[key] !== undefined) out[key] = args[key]
  return out
}

function failure(title, result) {
  if (!result || result.ok !== false) return null
  return text(title, String(result.error || 'unknown error'))
}

function repoOf(args) {
  return args && args.repository ? String(args.repository) : 'the default repository'
}

const PRESENTATIONS = {
  gh_repo: {
    call: (args) => pending(`Read repository ${repoOf(args)}`, pick(args, ['repository'])),
    result: (_args, r) => failure('Repository not read', r)
      || text(r.data.fullName, `${r.data.description || '(no description)'}\n${r.data.private ? 'private' : 'public'} · ${r.data.defaultBranch} · ★${r.data.stars} · topics: ${r.data.topics.join(', ') || 'none'}`),
  },
  gh_file: {
    call: (args) => pending(`Read ${args.path || 'a file'}`, pick(args, ['repository', 'path', 'ref'])),
    result: (_args, r) => failure('File not read', r)
      || text(r.data.path, r.data.kind === 'directory'
        ? `${r.data.entries.length} entries: ${r.data.entries.slice(0, 12).map((e) => e.name).join(', ')}`
        : `${r.data.size} bytes · sha ${String(r.data.sha || '').slice(0, 7)}${r.data.truncated ? ' · truncated' : ''}`),
  },
  gh_repo_search: {
    call: (args) => pending(`Search repositories: ${args.query}`, pick(args, ['query'])),
    result: (_args, r) => failure('Search failed', r)
      || text(`${r.data.total} repositories`, r.data.repos.slice(0, 10).map((x) => `${x.fullName} ★${x.stars} — ${x.description || ''}`).join('\n')),
  },
  gh_release_list: {
    call: (args) => pending(`List releases of ${repoOf(args)}`, pick(args, ['repository'])),
    result: (_args, r) => failure('Releases not listed', r)
      || text(`${r.data.count} releases`, r.data.releases.map((x) => `${x.tag}${x.draft ? ' (draft)' : ''}${x.prerelease ? ' (pre)' : ''} — ${x.name}`).join('\n')),
  },
  gh_release_view: {
    call: (args) => pending(`Read release ${args.tag}`, pick(args, ['repository', 'tag'])),
    result: (_args, r) => failure('Release not read', r)
      || text(`Release ${r.data.tag}`, `${r.data.name}\n${r.data.draft ? 'draft · ' : ''}${r.data.assets.length} assets\n${r.data.url}`),
  },
  gh_release_create: {
    call: (args) => pending(`Create release ${args.tag}`, pick(args, ['repository', 'tag', 'name', 'draft', 'prerelease', 'target'])),
    result: (_args, r) => failure('Release not created', r)
      || text(`Created release ${r.data.tag}`, `${r.data.url}${r.data.draft ? '\n(draft)' : ''}`),
  },
  gh_release_edit: {
    call: (args) => pending(`Edit release ${args.tag || args.releaseId}`, pick(args, ['repository', 'tag', 'releaseId', 'name', 'makeLatest'])),
    result: (_args, r) => failure('Release not edited', r)
      || text(`Updated release ${r.data.tag}`, `name: ${r.data.name}\nlatest: ${r.data.draft ? 'no (draft)' : 'see the repository page'}\n${r.data.url}`),
  },
  gh_release_delete: {
    call: (args) => pending(`Delete release ${args.tag || args.releaseId}`, pick(args, ['repository', 'tag', 'releaseId'])),
    result: (_args, r) => failure('Release not deleted', r) || text(`Deleted release ${r.data.id}`, `tag ${r.data.tag || '(by id)'} — the git tag itself was not touched`),
  },
  gh_tag_list: {
    call: (args) => pending(`List tags of ${repoOf(args)}`, pick(args, ['repository'])),
    result: (_args, r) => failure('Tags not listed', r)
      || text(`${r.data.count} tags`, r.data.tags.map((t) => `${t.name} ${String(t.sha).slice(0, 7)}`).join('\n')),
  },
  gh_tag_create: {
    call: (args) => pending(`Create tag ${args.tag}`, pick(args, ['repository', 'tag', 'sha', 'message'])),
    result: (_args, r) => failure('Tag not created', r)
      || text(`Created tag ${r.data.name}`, `${r.data.annotated ? 'annotated' : 'lightweight'} → ${String(r.data.target).slice(0, 7)}`),
  },
  gh_tag_delete: {
    call: (args) => pending(`Delete tag ${args.tag}`, pick(args, ['repository', 'tag'])),
    result: (_args, r) => failure('Tag not deleted', r) || text(`Deleted tag ${r.data.tag}`, 'the tag is gone from the remote'),
  },
  gh_issue: {
    call: (args) => pending(`${args.action === 'get' || args.action === 'comments' ? 'Read' : 'List'} issues of ${repoOf(args)}`, pick(args, ['repository', 'action', 'number', 'state', 'kind'])),
    result: (_args, r) => {
      const bad = failure('Issues not read', r)
      if (bad) return bad
      const data = r.data
      if (data.comments) return text(`Issue #${data.number}: ${data.comments.length} comments`, data.comments.map((c) => `${c.author}: ${String(c.body).slice(0, 120)}`).join('\n'))
      if (data.number) return text(`Issue #${data.number} (${data.state})`, `${data.title}\n${data.url}`)
      return text(`${data.count} items`, (data.issues || []).map((i) => `#${i.number} [${i.kind}] ${i.title}`).join('\n'))
    },
  },
  issue_open: {
    call: (args) => pending(`Open issue: ${args.title}`, pick(args, ['repository', 'title', 'labels'])),
    result: (_args, r) => failure('Issue not opened', r) || text(`Opened issue #${r.data.number}`, `${r.data.title}\n${r.data.url}`),
  },
  issue_comment: {
    call: (args) => pending(`Comment on #${args.number}`, pick(args, ['repository', 'number'])),
    result: (_args, r) => failure('Comment not posted', r) || text(`Commented on #${r.data.id ? '' : ''}`, `comment id ${r.data.id}`),
  },
  issue_close: {
    call: (args) => pending(`Close #${args.number}`, pick(args, ['repository', 'number', 'stateReason'])),
    result: (_args, r) => failure('Issue not closed', r) || text(`Closed #${r.data.number}`, `state ${r.data.state}${r.data.stateReason ? ` (${r.data.stateReason})` : ''}`),
  },
  gh_search: {
    call: (args) => pending(`Search issues: ${args.query}`, pick(args, ['query'])),
    result: (_args, r) => failure('Search failed', r)
      || text(`${r.data.total} results`, r.data.issues.slice(0, 10).map((i) => `${i.repository ? i.repository + ' ' : ''}#${i.number} ${i.title}`).join('\n')),
  },
  pr_create: {
    call: (args) => pending(`Create pull request: ${args.title}`, pick(args, ['repository', 'title', 'head', 'base', 'draft'])),
    result: (_args, r) => failure('Pull request not created', r)
      || text(`Created pull request #${r.data.number}`, `${r.data.url}\n${r.data.base} ← ${r.data.head}${r.data.draft ? ' (draft)' : ''}`),
  },
  pr_update: {
    call: (args) => pending(`Update pull request #${args.number}`, pick(args, ['repository', 'number', 'title', 'state', 'base'])),
    result: (_args, r) => failure('Pull request not updated', r)
      || text(`Updated pull request #${r.data.number}`, `${r.data.title}\nstate ${r.data.state}\n${r.data.url}`),
  },
  pr_merge: {
    call: (args) => pending(`Merge pull request #${args.number}`, pick(args, ['repository', 'number', 'method', 'deleteBranch'])),
    result: (_args, r) => failure('Pull request not merged', r)
      || text(r.data.merged ? `Merged #${'pull request'}` : 'Merge not performed', `${r.data.message || ''}${r.data.sha ? `\n${String(r.data.sha).slice(0, 7)}` : ''}${r.data.branchDeleted ? `\nhead branch ${r.data.branchDeleted} deleted` : ''}`),
  },
  gh_review: {
    call: (args) => pending(`Review pull request #${args.number}`, pick(args, ['repository', 'number', 'maxDiffChars'])),
    result: (_args, r) => failure('Review failed', r)
      || text(`Pull request #${r.data.pull.number}: ${r.data.pull.title}`, [
        `areas: ${r.data.areas.join(', ') || 'none'}`,
        `files: ${r.data.files.length} · checks: ${r.data.checks ? r.data.checks.rollup : 'unknown'}`,
        r.data.findings.length ? r.data.findings.map((f) => `[${f.level}] ${f.detail}`).join('\n') : 'no findings',
      ].join('\n')),
  },
  review_post: {
    call: (args) => pending(`Post review on #${args.number} (${args.mode || 'summary'})`, pick(args, ['repository', 'number', 'mode'])),
    result: (_args, r) => failure('Review not posted', r) || text(`Review posted (${r.data.mode})`, String(r.data.url || `id ${r.data.id}`)),
  },
  gh_checks: {
    call: (args) => pending(`Read checks of ${args.ref}`, pick(args, ['repository', 'ref'])),
    result: (_args, r) => failure('Checks not read', r)
      || text(`Checks: ${r.data.rollup}`, r.data.checkRuns.map((c) => `${c.name}: ${c.conclusion || c.status}`).join('\n') || 'no check runs'),
  },
  ci_run: {
    call: (args) => pending(`CI review of pull request #${args.number}`, pick(args, ['repository', 'number'])),
    result: (_args, r) => failure('CI review failed', r)
      || text(`CI verdict for #${r.data.number}: ${r.data.verdict}`, r.data.summary),
  },
  gh_mirror_check: {
    call: (args) => pending(`Mirror plan for ${args.ref || 'origin/main'}`, pick(args, ['cwd', 'ref', 'mirror', 'branch'])),
    result: (_args, r) => failure('Mirror plan failed', r)
      || text(`Mirror: ${r.data.willPublishCount} files would be published`, `${r.data.willDropCount} stay behind${r.data.refused ? `\nREFUSED: ${r.data.refused}` : ''}`),
  },
  gh_mirror_publish: {
    call: (args) => pending(`Publish mirror ${args.ref || 'origin/main'}${args.dryRun ? ' (dry run)' : ''}`, pick(args, ['cwd', 'ref', 'mirror', 'branch', 'dryRun'])),
    result: (_args, r) => failure('Mirror not published', r)
      || text(r.data.pushed ? `Mirror published: ${String(r.data.commit).slice(0, 8)}` : 'Mirror dry run', `${r.data.willPublishCount} files, ${r.data.willDropCount} left behind\n${r.data.mirror}`),
  },
  gh_run_list: {
    call: (args) => pending(`List workflow runs of ${repoOf(args)}`, pick(args, ['repository', 'branch', 'workflow', 'status'])),
    result: (_args, r) => failure('Runs not listed', r)
      || text(`${r.data.count} runs`, r.data.runs.map((x) => `#${x.id} ${x.name} ${x.conclusion || x.status} ${x.branch}`).join('\n')),
  },
  gh_run_jobs: {
    call: (args) => pending(`Jobs of run ${args.runId}`, pick(args, ['repository', 'runId'])),
    result: (_args, r) => failure('Jobs not read', r)
      || text(`${r.data.count} jobs`, r.data.jobs.map((j) => `${j.name}: ${j.conclusion || j.status}${j.failedSteps.length ? ` — failed: ${j.failedSteps.map((s) => s.name).join(', ')}` : ''}`).join('\n')),
  },
  gh_variable_list: {
    call: (args) => pending(`List variables of ${repoOf(args)}`, pick(args, ['repository', 'environment'])),
    result: (_args, r) => failure('Variables not listed', r) || text(`${r.data.variables.length} variables`, r.data.variables.map((v) => `${v.name}=${v.value}`).join('\n')),
  },
  gh_secret_list: {
    call: (args) => pending(`List secrets of ${repoOf(args)}`, pick(args, ['repository', 'environment'])),
    result: (_args, r) => failure('Secrets not listed', r) || text(`${r.data.secrets.length} secrets`, r.data.secrets.map((s) => s.name).join('\n')),
  },
  gh_ruleset_list: {
    call: (args) => pending(`List rulesets of ${repoOf(args)}`, pick(args, ['repository'])),
    result: (_args, r) => failure('Rulesets not listed', r) || text(`${r.data.rulesets.length} rulesets`, r.data.rulesets.map((x) => `${x.name} (${x.target}, ${x.enforcement})`).join('\n')),
  },
  gh_branch_protection_get: {
    call: (args) => pending(`Read branch protection of ${args.branch}`, pick(args, ['repository', 'branch'])),
    result: (_args, r) => {
      const bad = failure('Branch protection not read', r)
      if (bad) return bad
      const p = r.data
      return text(`Branch protection: ${p.branch}`, `reviews: ${p.requiredReviews ? p.requiredReviews.approvals : 0}\nchecks: ${p.requiredStatusChecks ? p.requiredStatusChecks.contexts.join(', ') || 'none' : 'none'}\nforce pushes: ${p.allowForcePushes} · deletions: ${p.allowDeletions} · admins: ${p.enforceAdmins}`)
    },
  },
  gh_api: {
    call: (args) => pending(`GitHub API: ${args.method || 'GET'} ${args.path || 'graphql'}`, pick(args, ['method', 'path', 'query'])),
    result: (_args, r) => failure('API call failed', r)
      || text(`${r.data.method} ${r.data.status || ''}`.trim(), r.data.mutating ? 'state-changing call' : 'read-only call'),
  },
}

/** Presentation hooks for one tool, or an empty object when it has none. */
export function presentationFor(toolName) {
  const entry = PRESENTATIONS[toolName]
  if (!entry) return {}
  return {
    presentCall: entry.call,
    presentResult: entry.result,
  }
}

export const PRESENTED_TOOLS = Object.keys(PRESENTATIONS)
