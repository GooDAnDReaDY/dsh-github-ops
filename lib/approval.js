// Who approves a GitHub write, and why.
//
// Every state-changing tool maps to a named action. The action must be in `allowedActions`
// (otherwise it is denied outright), a destructive action is always asked even in an
// unattended run, and anything else asks the human with a sentence that says what is about
// to happen — not just "perform a GitHub write".
//
// `decide()` is pure: the policy is a function of the call and the settings, so it is fully
// testable and the listener stays trivial.

/** Tool → action name. A tool absent from this map is not a write. */
export const ACTION_BY_TOOL = {
  gh_release_create: 'release-create',
  gh_release_edit: 'release-edit',
  gh_release_delete: 'release-delete',
  gh_tag_create: 'tag-create',
  gh_tag_delete: 'tag-delete',
  gh_repo_create: 'repo-create',
  gh_repo_edit: 'repo-edit',
  issue_open: 'issue-open',
  issue_comment: 'issue-comment',
  issue_close: 'issue-close',
  pr_create: 'pr-create',
  pr_update: 'pr-update',
  pr_merge: 'pr-merge',
  review_post: 'review-post',
  gh_variable_set: 'variable-set',
  gh_variable_delete: 'variable-delete',
  gh_secret_set: 'secret-set',
  gh_secret_delete: 'secret-delete',
  gh_ruleset_apply: 'ruleset-apply',
  gh_ruleset_delete: 'ruleset-delete',
  gh_branch_protection_set: 'branch-protection-set',
  gh_branch_protection_delete: 'branch-protection-delete',
  gh_run_rerun: 'run-rerun',
  gh_run_cancel: 'run-cancel',
  gh_mirror_publish: 'mirror-publish',
}

/** Actions a single confirmation cannot make safe: always asked, never auto-approved. */
export const DESTRUCTIVE_ACTIONS = new Set([
  'release-delete', 'tag-delete', 'variable-delete', 'secret-delete',
  'ruleset-delete', 'branch-protection-delete', 'run-cancel',
])

export const ALL_ACTIONS = Object.freeze([...new Set(Object.values(ACTION_BY_TOOL))])

const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE'])

/** Which action a call is, or null when it changes nothing. */
export function actionFor(exec) {
  const name = exec && exec.name
  if (!name) return null
  if (name === 'gh_api') {
    const args = (exec && exec.arguments) || {}
    if (args.graphql) return null // a query may still mutate; the GraphQL text cannot be judged here
    const method = String(args.method || 'GET').toUpperCase()
    return MUTATING_METHODS.has(method) ? 'api-call' : null
  }
  return ACTION_BY_TOOL[name] || null
}

/** A sentence a human can decide on. */
export function askReason(exec) {
  const args = (exec && exec.arguments) || {}
  const repo = args.repository || 'the default repository'
  const name = exec && exec.name
  switch (name) {
    case 'gh_release_create':
      return `create GitHub release ${args.tag}${args.draft ? ' (draft)' : ''} in ${repo}`
    case 'gh_release_edit':
      return `edit GitHub release ${args.tag || args.releaseId} in ${repo}${args.makeLatest ? ' and mark it latest' : ''}`
    case 'gh_release_delete':
      return `delete GitHub release ${args.tag || args.releaseId} in ${repo} (the git tag stays)`
    case 'gh_tag_create':
      return `create tag ${args.tag} in ${repo}`
    case 'gh_tag_delete':
      return `delete tag ${args.tag} in ${repo}`
    case 'gh_repo_create':
      return `create repository ${args.name}${args.org ? ` in ${args.org}` : ''}${args.private === false ? ' as PUBLIC' : ' (private)'}`
    case 'gh_repo_edit':
      return `change settings of ${repo}${args.private !== undefined ? ` (visibility: ${args.private ? 'private' : 'PUBLIC'})` : ''}`
    case 'issue_open':
      return `open issue "${args.title}" in ${repo}`
    case 'issue_comment':
      return `comment on #${args.number} in ${repo}`
    case 'issue_close':
      return `close #${args.number} in ${repo}`
    case 'pr_create':
      return `open pull request "${args.title}" (${args.head} → ${args.base || 'main'}) in ${repo}`
    case 'pr_update':
      return `update pull request #${args.number} in ${repo}`
    case 'pr_merge':
      return `MERGE pull request #${args.number} in ${repo} (${args.method || 'merge'})`
    case 'review_post':
      return `post a review on #${args.number} in ${repo}`
    case 'gh_variable_set':
      return `set variable ${args.name} in ${repo}`
    case 'gh_variable_delete':
      return `delete variable ${args.name} in ${repo}`
    case 'gh_secret_set':
      return `set secret ${args.name} in ${repo}`
    case 'gh_secret_delete':
      return `delete secret ${args.name} in ${repo}`
    case 'gh_ruleset_apply':
      return `apply ruleset ${args.name || args.rulesetId} to ${repo}`
    case 'gh_ruleset_delete':
      return `delete ruleset ${args.rulesetId} from ${repo}`
    case 'gh_branch_protection_set':
      return `replace branch protection on ${args.branch} in ${repo}`
    case 'gh_branch_protection_delete':
      return `remove branch protection from ${args.branch} in ${repo}`
    case 'gh_run_rerun':
      return `re-run workflow run ${args.runId} in ${repo}`
    case 'gh_run_cancel':
      return `cancel workflow run ${args.runId} in ${repo}`
    case 'gh_mirror_publish':
      return `publish a sanitized tree to the mirror of ${args.cwd || 'the checkout'} (${args.mirror || 'github'}/${args.branch || 'main'})`
    case 'gh_api':
      return `call the GitHub API: ${String(args.method || 'GET').toUpperCase()} ${args.path}`
    default:
      return `perform a GitHub write action (${name})`
  }
}

/** Whether an unattended run may proceed without a human. */
export function isUnattended(env = process.env) {
  return String((env && env.DSH_GITHUB_OPS_UNATTENDED) || '') === '1'
}

/** How the plugin treats a write. */
export const APPROVAL_MODES = ['auto', 'ask', 'off']

/**
 * The policy, as a pure function.
 *
 * - `auto` (default): an agreed, non-destructive write goes through without a prompt, so a
 *   session whose host has approvals disabled is not blocked by a question it cannot answer.
 *   A destructive action still asks — and where prompts are unavailable that means it is
 *   refused, which is the intent: deleting a release, a tag, a secret, a ruleset or branch
 *   protection is never automatic.
 * - `ask`: every write asks.
 * - `off`: the plugin has no opinion; the host's own approval contour decides everything.
 *
 * `allowedActions` is the fence in every mode: an action outside it is denied outright.
 *
 * @returns {{kind: 'allow'|'ask'|'deny'|'continue', reason?: string, action?: string|null}}
 */
export function decide({ exec, allowedActions, autoApprove, unattended = false, mode = 'auto' } = {}) {
  const action = actionFor(exec)
  if (!action) return { kind: 'continue', action: null }
  if (mode === 'off') return { kind: 'continue', action }

  const allowed = Array.isArray(allowedActions) && allowedActions.length ? allowedActions : ALL_ACTIONS
  if (!allowed.includes(action)) {
    return { kind: 'deny', action, reason: `dsh-github-ops: action "${action}" is not in allowedActions` }
  }

  const destructive = DESTRUCTIVE_ACTIONS.has(action)
  if (destructive) {
    return {
      kind: 'ask',
      action,
      reason: `dsh-github-ops: ${askReason(exec)}. This cannot be undone here, so it is never automatic.`,
    }
  }

  if (mode === 'auto') return { kind: 'allow', action }
  if (unattended && Array.isArray(autoApprove) && autoApprove.includes(action)) return { kind: 'allow', action }
  return { kind: 'ask', action, reason: `dsh-github-ops: ${askReason(exec)}.` }
}

/**
 * Register the gate. Registration is an effect: disposing the plugin removes the listener.
 */
export function registerApprovalGate(ctx, getConfig) {
  const first = (typeof getConfig === 'function' ? getConfig() : getConfig) || {}
  if (first.approvalMode === 'off') return () => {}
  return ctx.on('tools/pre-execute', async (exec, next) => {
    const cfg = (typeof getConfig === 'function' ? getConfig() : getConfig) || {}
    const decision = decide({
      exec,
      allowedActions: cfg.allowedActions,
      autoApprove: cfg.autoApprove,
      mode: cfg.approvalMode || 'auto',
      unattended: cfg.unattended !== undefined ? cfg.unattended : isUnattended(),
    })
    if (decision.kind === 'continue') return next()
    if (decision.kind === 'allow') return { kind: 'allow' }
    if (decision.kind === 'deny') return { kind: 'deny', reason: decision.reason }
    return { kind: 'ask', reason: decision.reason }
  })
}
