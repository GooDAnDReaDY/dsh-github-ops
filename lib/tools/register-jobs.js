// Background review tools.
//
// A review that takes a while should not hold a turn. `gh_review_job` starts one and answers
// immediately with a job id; `gh_review_job_status` reports the record. When the host exposes
// a job registry the work runs there (visible and cancellable in the UI); otherwise it runs
// in this plugin, which is why the tool works either way.

import { ciRun } from './pulls.js'

const REPOSITORY = {
  repository: { type: 'string', description: 'Repository as "owner/repo". Omit to use the default from settings or the checkout.' },
}

export function registerJobTools({ tool, asRepo, client, liveConfig, reviewRules, jobs }) {
  const repoParams = (extra = {}) => ({ ...REPOSITORY, ...extra })

  tool(
    'gh_review_job',
    'Start a background review of a pull request and return its job id immediately. Works through the host job registry when one is composed, otherwise inside the plugin. Use gh_review_job_status to read the result.',
    repoParams({
      number: { type: 'number', description: 'Pull request number.' },
      maxDiffChars: { type: 'number', description: 'Cap for the diff text (default 60000).' },
      label: { type: 'string', description: 'Human label for the job.' },
    }),
    async (args) => {
      const { owner, repo } = await asRepo(args, liveConfig())
      const cfg = liveConfig()
      const id = jobs.start({
        repo: `${owner}/${repo}`,
        pr: args.number,
        label: args.label,
        owner: args.owner,
        timeoutMs: Number(cfg.reviewJobTimeoutMs) || 120000,
        maxDiffChars: args.maxDiffChars,
        rules: typeof reviewRules === 'function' ? reviewRules() : undefined,
        client,
        ciRun,
      })
      return { jobId: id, repo: `${owner}/${repo}`, number: args.number, note: 'The review runs in the background; read it with gh_review_job_status.' }
    },
  )

  tool(
    'gh_review_job_status',
    'Read a background review job: running, done with the report, or failed with the reason. Read-only.',
    {
      jobId: { type: 'string', description: 'Job id returned by gh_review_job.' },
      all: { type: 'boolean', description: 'List the recent jobs of this session instead of one.' },
    },
    async (args) => {
      if (args.all) return { jobs: jobs.list() }
      const record = jobs.get(args.jobId)
      if (!record) return { jobId: args.jobId, status: 'unknown', note: 'No such job in this session (records are bounded and kept in memory).' }
      return { jobId: args.jobId, status: record.status, report: record.report, error: record.error }
    },
  )
}
