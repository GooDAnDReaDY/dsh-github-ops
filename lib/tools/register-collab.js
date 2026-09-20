// Collaboration tool registrations: issues, pull requests, reviews and checks.
//
// Reads are free; every write goes through the caller's confirmation contour in the
// description, and destructive variants demand an explicit flag.

import {
  listIssues,
  getIssue,
  createIssue,
  commentIssue,
  closeIssue,
  searchIssues,
} from './issues.js'
import {
  createPull,
  updatePull,
  mergePull,
  reviewPull,
  postReview,
  getChecks,
  ciRun,
} from './pulls.js'

const REPOSITORY = {
  repository: { type: 'string', description: 'Repository as "owner/repo". Omit to use the default from settings.' },
}

export function registerCollabTools({ tool, asRepo, client, liveConfig }) {
  const repoParams = (extra = {}) => ({ ...REPOSITORY, ...extra })

  // ---------------------------------------------------------------------- issues

  tool(
    'gh_issue',
    'List or read GitHub issues. Pull requests are returned with kind: "pr". Use action "list" (default), "get" for one issue, or "comments" for one issue\'s comments. Read-only.',
    repoParams({
      action: { type: 'string', description: 'list (default), get, or comments.' },
      number: { type: 'number', description: 'Issue number; required for get and comments.' },
      state: { type: 'string', description: 'open (default), closed or all.' },
      labels: { type: 'array', items: { type: 'string' }, description: 'Filter by labels.' },
      kind: { type: 'string', description: 'all (default), issue or pr.' },
      limit: { type: 'number', description: 'How many issues to list (max 100, default 30).' },
    }),
    async (args) => {
      const { owner, repo } = asRepo(args, liveConfig())
      const action = args.action || 'list'
      if (action === 'get' || action === 'comments') {
        const issue = await getIssue(await client(), {
          owner, repo, number: args.number, includeComments: action === 'comments',
        })
        return action === 'comments' ? { number: issue.number, comments: issue.commentList || [] } : issue
      }
      const result = await listIssues(await client(), {
        owner, repo, state: args.state, labels: args.labels, limit: args.limit, kind: args.kind,
      })
      return { issues: result.issues, count: result.count }
    },
  )

  tool(
    'issue_open',
    'Create a GitHub issue with a title, body, labels and assignees.',
    repoParams({
      title: { type: 'string', description: 'Issue title.' },
      body: { type: 'string', description: 'Issue body in markdown.' },
      labels: { type: 'array', items: { type: 'string' }, description: 'Labels to apply.' },
      assignees: { type: 'array', items: { type: 'string' }, description: 'Logins to assign.' },
    }),
    async (args) => {
      const { owner, repo } = asRepo(args, liveConfig())
      return createIssue(await client(), {
        owner, repo, title: args.title, body: args.body, labels: args.labels, assignees: args.assignees,
      })
    },
  )

  tool(
    'issue_comment',
    'Comment on a GitHub issue or pull request.',
    repoParams({
      number: { type: 'number', description: 'Issue or pull request number.' },
      body: { type: 'string', description: 'Comment body in markdown.' },
    }),
    async (args) => {
      const { owner, repo } = asRepo(args, liveConfig())
      return commentIssue(await client(), { owner, repo, number: args.number, body: args.body })
    },
  )

  tool(
    'issue_close',
    'Close a GitHub issue, optionally recording a state reason (completed or not_planned).',
    repoParams({
      number: { type: 'number', description: 'Issue number.' },
      stateReason: { type: 'string', description: 'completed or not_planned.' },
    }),
    async (args) => {
      const { owner, repo } = asRepo(args, liveConfig())
      return closeIssue(await client(), { owner, repo, number: args.number, stateReason: args.stateReason })
    },
  )

  tool(
    'gh_search',
    'Search GitHub issues and pull requests with GitHub search syntax (e.g. "repo:owner/name is:open label:bug"). Uses the separate search quota. Read-only.',
    {
      query: { type: 'string', description: 'Search query in GitHub search syntax.' },
      limit: { type: 'number', description: 'How many results to return (max 100, default 20).' },
    },
    async (args) => searchIssues(await client(), { query: args.query, limit: args.limit }),
  )

  // ----------------------------------------------------------------- pull requests

  tool(
    'pr_create',
    'Create a GitHub pull request from a head branch into a base branch.',
    repoParams({
      title: { type: 'string', description: 'Pull request title.' },
      head: { type: 'string', description: 'Source branch.' },
      base: { type: 'string', description: 'Target branch (default main).' },
      body: { type: 'string', description: 'Description in markdown.' },
      draft: { type: 'boolean', description: 'Create as a draft.' },
    }),
    async (args) => {
      const { owner, repo } = asRepo(args, liveConfig())
      return createPull(await client(), {
        owner, repo, title: args.title, head: args.head, base: args.base, body: args.body, draft: args.draft,
      })
    },
  )

  tool(
    'pr_update',
    'Update a GitHub pull request: title, body, state (open/closed) or base branch.',
    repoParams({
      number: { type: 'number', description: 'Pull request number.' },
      title: { type: 'string', description: 'New title.' },
      body: { type: 'string', description: 'New body.' },
      state: { type: 'string', description: 'open or closed.' },
      base: { type: 'string', description: 'New target branch.' },
    }),
    async (args) => {
      const { owner, repo } = asRepo(args, liveConfig())
      return updatePull(await client(), {
        owner, repo, number: args.number, title: args.title, body: args.body, state: args.state, base: args.base,
      })
    },
  )

  tool(
    'pr_merge',
    'Merge a GitHub pull request. method is merge (default), squash or rebase; deleteBranch removes the head branch afterwards. This is the irreversible step of a review cycle — confirm the review finished first.',
    repoParams({
      number: { type: 'number', description: 'Pull request number.' },
      method: { type: 'string', description: 'merge (default), squash or rebase.' },
      commitTitle: { type: 'string', description: 'Merge/squash commit title.' },
      commitMessage: { type: 'string', description: 'Merge/squash commit message.' },
      deleteBranch: { type: 'boolean', description: 'Delete the head branch after merging.' },
    }),
    async (args) => {
      const { owner, repo } = asRepo(args, liveConfig())
      return mergePull(await client(), {
        owner, repo,
        number: args.number,
        method: args.method,
        commitTitle: args.commitTitle,
        commitMessage: args.commitMessage,
        deleteBranch: args.deleteBranch,
      })
    },
  )

  tool(
    'gh_review',
    'Read a pull request as one review pack: metadata, changed files with areas, a capped unified diff, comments, the CI rollup and deterministic findings (secrets, migrations, CI config, missing tests, large diff). Read-only.',
    repoParams({
      number: { type: 'number', description: 'Pull request number.' },
      maxDiffChars: { type: 'number', description: 'Cap for the returned diff text (default 60000).' },
    }),
    async (args) => {
      const { owner, repo } = asRepo(args, liveConfig())
      return reviewPull(await client(), { owner, repo, number: args.number, maxDiffChars: args.maxDiffChars })
    },
  )

  tool(
    'review_post',
    'Publish a review on a pull request: mode "summary" posts one issue-level comment (default), mode "inline" posts a review with line-anchored comments.',
    repoParams({
      number: { type: 'number', description: 'Pull request number.' },
      body: { type: 'string', description: 'Review body in markdown.' },
      mode: { type: 'string', description: 'summary (default) or inline.' },
      inline: {
        type: 'array',
        description: 'Inline comments for mode inline: [{ path, line, body }].',
        items: { type: 'object' },
      },
    }),
    async (args) => {
      const { owner, repo } = asRepo(args, liveConfig())
      return postReview(await client(), {
        owner, repo, number: args.number, body: args.body, mode: args.mode, inline: args.inline,
      })
    },
  )

  tool(
    'gh_checks',
    'Read the CI state of a commit: check runs, legacy commit statuses and one rollup verdict (success, failure, pending or unknown). Read-only.',
    repoParams({
      ref: { type: 'string', description: 'Commit SHA, branch or tag.' },
    }),
    async (args) => {
      const { owner, repo } = asRepo(args, liveConfig())
      return getChecks(await client(), { owner, repo, ref: args.ref })
    },
  )

  tool(
    'ci_run',
    'Run a one-shot CI review of a pull request: the review pack plus a deterministic verdict (success or needs-changes). success means no rule found something needing attention — it is not a statement that the change is correct.',
    repoParams({
      number: { type: 'number', description: 'Pull request number.' },
      maxDiffChars: { type: 'number', description: 'Cap for the diff text (default 60000).' },
    }),
    async (args) => {
      const { owner, repo } = asRepo(args, liveConfig())
      return ciRun(await client(), { owner, repo, number: args.number, maxDiffChars: args.maxDiffChars })
    },
  )
}
