// Workflow-run and repository-settings tool registrations.
//
// Reads are free; writes follow the plugin's model — an explicit confirm flag for the
// destructive ones, and a clear refusal where one confirmation cannot make the call safe.

import {
  listRuns,
  getRun,
  listRunJobs,
  rerunRun,
  cancelRun,
  getRunLogsUrl,
} from './actions.js'
import {
  listVariables,
  setVariable,
  deleteVariable,
  listSecrets,
  setSecret,
  deleteSecret,
  listRulesets,
  getRuleset,
  applyRuleset,
  deleteRuleset,
  getBranchProtection,
  setBranchProtection,
  deleteBranchProtection,
} from './repo-settings.js'

const REPOSITORY = {
  repository: { type: 'string', description: 'Repository as "owner/repo". Omit to use the default from settings.' },
}

export function registerOpsTools({ tool, asRepo, client, liveConfig }) {
  const repoParams = (extra = {}) => ({ ...REPOSITORY, ...extra })
  const withRepo = (args, run) => {
    const { owner, repo } = asRepo(args, liveConfig())
    return run({ owner, repo })
  }

  // ------------------------------------------------------------- workflow runs

  tool(
    'gh_run_list',
    'List GitHub Actions workflow runs of a repository, newest first, optionally filtered by branch, workflow file or status. Read-only.',
    repoParams({
      branch: { type: 'string', description: 'Filter by head branch.' },
      workflow: { type: 'string', description: 'Workflow file name or id, e.g. "ci.yml".' },
      status: { type: 'string', description: 'Filter by status or conclusion, e.g. completed, failure, in_progress.' },
      limit: { type: 'number', description: 'How many runs to return (max 100, default 20).' },
    }),
    async (args) => withRepo(args, async ({ owner, repo }) => listRuns(await client(), {
      owner, repo, branch: args.branch, workflow: args.workflow, status: args.status, limit: args.limit,
    })),
  )

  tool(
    'gh_run_view',
    'Read one GitHub Actions run: workflow, event, branch, status, conclusion and URL. Read-only.',
    repoParams({ runId: { type: 'number', description: 'Run id from gh_run_list.' } }),
    async (args) => withRepo(args, async ({ owner, repo }) => getRun(await client(), { owner, repo, runId: args.runId })),
  )

  tool(
    'gh_run_jobs',
    'List the jobs of a run with their steps and the steps that failed. Read-only, and usually enough to understand a failure without downloading logs.',
    repoParams({ runId: { type: 'number', description: 'Run id.' } }),
    async (args) => withRepo(args, async ({ owner, repo }) => listRunJobs(await client(), { owner, repo, runId: args.runId })),
  )

  tool(
    'gh_run_rerun',
    'Re-run a workflow run, or only its failed jobs (failedOnly: true).',
    repoParams({
      runId: { type: 'number', description: 'Run id.' },
      failedOnly: { type: 'boolean', description: 'Re-run only the failed jobs.' },
    }),
    async (args) => withRepo(args, async ({ owner, repo }) => rerunRun(await client(), {
      owner, repo, runId: args.runId, failedOnly: args.failedOnly,
    })),
  )

  tool(
    'gh_run_cancel',
    'Cancel an in-progress workflow run. Requires confirm: true.',
    repoParams({
      runId: { type: 'number', description: 'Run id.' },
      confirm: { type: 'boolean', description: 'Must be true to actually cancel.' },
    }),
    async (args) => {
      if (args.confirm !== true) throw new Error('refusing to cancel a run without confirm: true')
      return withRepo(args, async ({ owner, repo }) => cancelRun(await client(), { owner, repo, runId: args.runId }))
    },
  )

  tool(
    'gh_run_logs',
    'Return the download URL of a run logs archive. GitHub answers with a redirect to a zip, so the archive is not pulled into the conversation: the URL needs the same token and is short-lived.',
    repoParams({ runId: { type: 'number', description: 'Run id.' } }),
    async (args) => withRepo(args, async ({ owner, repo }) => getRunLogsUrl(await client(), { owner, repo, runId: args.runId })),
  )

  // ---------------------------------------------------------------- variables

  tool(
    'gh_variable_list',
    'List Actions variables of a repository (or of one environment). Values are shown; they are not secret material.',
    repoParams({ environment: { type: 'string', description: 'Environment name, when the variable lives there.' } }),
    async (args) => withRepo(args, async ({ owner, repo }) => listVariables(await client(), {
      owner, repo, environment: args.environment,
    })),
  )

  tool(
    'gh_variable_set',
    'Create or update an Actions variable (the tool decides between create and update).',
    repoParams({
      name: { type: 'string', description: 'Variable name.' },
      value: { type: 'string', description: 'Variable value (not secret).' },
      environment: { type: 'string', description: 'Environment name, when the variable lives there.' },
    }),
    async (args) => withRepo(args, async ({ owner, repo }) => setVariable(await client(), {
      owner, repo, name: args.name, value: args.value, environment: args.environment,
    })),
  )

  tool(
    'gh_variable_delete',
    'Delete an Actions variable. Requires confirm: true.',
    repoParams({
      name: { type: 'string', description: 'Variable name.' },
      environment: { type: 'string', description: 'Environment name, when the variable lives there.' },
      confirm: { type: 'boolean', description: 'Must be true to actually delete.' },
    }),
    async (args) => {
      if (args.confirm !== true) throw new Error('refusing to delete a variable without confirm: true')
      return withRepo(args, async ({ owner, repo }) => deleteVariable(await client(), {
        owner, repo, name: args.name, environment: args.environment,
      }))
    },
  )

  // ------------------------------------------------------------------ secrets

  tool(
    'gh_secret_list',
    'List Actions secrets of a repository (or of one environment): names and update times. GitHub never returns the values.',
    repoParams({ environment: { type: 'string', description: 'Environment name, when the secret lives there.' } }),
    async (args) => withRepo(args, async ({ owner, repo }) => listSecrets(await client(), {
      owner, repo, environment: args.environment,
    })),
  )

  tool(
    'gh_secret_set',
    'Create or update an Actions secret. The value is encrypted with GitHub sealed-box encryption, which needs the optional "tweetnacl" package; without it the tool explains what to install instead of writing a broken value.',
    repoParams({
      name: { type: 'string', description: 'Secret name.' },
      value: { type: 'string', description: 'Secret value; it is never echoed back.' },
      environment: { type: 'string', description: 'Environment name, when the secret lives there.' },
    }),
    async (args) => withRepo(args, async ({ owner, repo }) => setSecret(await client(), {
      owner, repo, name: args.name, value: args.value, environment: args.environment,
    })),
  )

  tool(
    'gh_secret_delete',
    'Delete an Actions secret. Requires confirm: true.',
    repoParams({
      name: { type: 'string', description: 'Secret name.' },
      environment: { type: 'string', description: 'Environment name, when the secret lives there.' },
      confirm: { type: 'boolean', description: 'Must be true to actually delete.' },
    }),
    async (args) => {
      if (args.confirm !== true) throw new Error('refusing to delete a secret without confirm: true')
      return withRepo(args, async ({ owner, repo }) => deleteSecret(await client(), {
        owner, repo, name: args.name, environment: args.environment,
      }))
    },
  )

  // ------------------------------------------------------------------ rulesets

  tool(
    'gh_ruleset_list',
    'List repository rulesets with their target and enforcement level. Read-only.',
    repoParams(),
    async (args) => withRepo(args, async ({ owner, repo }) => listRulesets(await client(), { owner, repo })),
  )

  tool(
    'gh_ruleset_view',
    'Read one ruleset in full: conditions, rules and enforcement. Read-only.',
    repoParams({ rulesetId: { type: 'number', description: 'Ruleset id from gh_ruleset_list.' } }),
    async (args) => withRepo(args, async ({ owner, repo }) => getRuleset(await client(), { owner, repo, rulesetId: args.rulesetId })),
  )

  tool(
    'gh_ruleset_apply',
    'Create a ruleset, or update it when rulesetId is given. Defaults target the default branch with active enforcement.',
    repoParams({
      rulesetId: { type: 'number', description: 'Update this ruleset instead of creating one.' },
      name: { type: 'string', description: 'Ruleset name (required when creating).' },
      target: { type: 'string', description: 'branch (default) or tag.' },
      enforcement: { type: 'string', description: 'active (default), evaluate or disabled.' },
      conditions: { type: 'object', additionalProperties: true, description: 'Ruleset conditions, e.g. { ref_name: { include: ["refs/heads/main"], exclude: [] } }.' },
      rules: { type: 'array', items: { type: 'object', additionalProperties: true }, description: 'Ruleset rules, e.g. [{ type: "deletion" }].' },
    }),
    async (args) => withRepo(args, async ({ owner, repo }) => applyRuleset(await client(), {
      owner, repo,
      rulesetId: args.rulesetId,
      name: args.name,
      target: args.target,
      enforcement: args.enforcement,
      conditions: args.conditions,
      rules: args.rules,
    })),
  )

  tool(
    'gh_ruleset_delete',
    'Delete a ruleset. Requires confirm: true.',
    repoParams({
      rulesetId: { type: 'number', description: 'Ruleset id.' },
      confirm: { type: 'boolean', description: 'Must be true to actually delete.' },
    }),
    async (args) => {
      if (args.confirm !== true) throw new Error('refusing to delete a ruleset without confirm: true')
      return withRepo(args, async ({ owner, repo }) => deleteRuleset(await client(), { owner, repo, rulesetId: args.rulesetId }))
    },
  )

  // -------------------------------------------------------- branch protection

  tool(
    'gh_branch_protection_get',
    'Read classic branch protection of a branch: required reviews, status checks, admin enforcement and force-push/deletion flags. Read-only.',
    repoParams({ branch: { type: 'string', description: 'Branch name, e.g. main.' } }),
    async (args) => withRepo(args, async ({ owner, repo }) => getBranchProtection(await client(), {
      owner, repo, branch: args.branch,
    })),
  )

  tool(
    'gh_branch_protection_set',
    'Apply classic branch protection: required approving reviews, strict status checks with contexts, admin enforcement, force-push and deletion flags. This replaces the whole protection object for the branch.',
    repoParams({
      branch: { type: 'string', description: 'Branch name.' },
      approvals: { type: 'number', description: 'Required approving reviews (0 disables the review requirement).' },
      dismissStale: { type: 'boolean', description: 'Dismiss stale approvals on new commits (default true).' },
      strict: { type: 'boolean', description: 'Require branches to be up to date (default true).' },
      contexts: { type: 'array', items: { type: 'string' }, description: 'Required status check contexts.' },
      enforceAdmins: { type: 'boolean', description: 'Apply the rules to admins too.' },
      allowForcePushes: { type: 'boolean', description: 'Allow force pushes.' },
      allowDeletions: { type: 'boolean', description: 'Allow branch deletion.' },
    }),
    async (args) => withRepo(args, async ({ owner, repo }) => setBranchProtection(await client(), {
      owner, repo,
      branch: args.branch,
      approvals: args.approvals,
      dismissStale: args.dismissStale,
      strict: args.strict,
      contexts: args.contexts,
      enforceAdmins: args.enforceAdmins,
      allowForcePushes: args.allowForcePushes,
      allowDeletions: args.allowDeletions,
    })),
  )

  tool(
    'gh_branch_protection_delete',
    'Remove classic branch protection from a branch. Requires confirm: true.',
    repoParams({
      branch: { type: 'string', description: 'Branch name.' },
      confirm: { type: 'boolean', description: 'Must be true to actually remove protection.' },
    }),
    async (args) => {
      if (args.confirm !== true) throw new Error('refusing to remove branch protection without confirm: true')
      return withRepo(args, async ({ owner, repo }) => deleteBranchProtection(await client(), { owner, repo, branch: args.branch }))
    },
  )
}
