// Registrations for the composed reports: the answers a person asks for in one call.

import {
  repoReport,
  weeklyDigest,
  listNotifications,
  repoHealth,
  compareRepos,
  trendingRepos,
  userRepos,
  listContributors,
  listCommits,
} from './insights.js'

const REPOSITORY = {
  repository: { type: 'string', description: 'Repository as "owner/repo". Omit to use the default from settings or the checkout.' },
}

export function registerInsightTools({ tool, asRepo, client, liveConfig }) {
  const repoParams = (extra = {}) => ({ ...REPOSITORY, ...extra })

  tool(
    'gh_repo_report',
    'One call that says what a repository is: overview, latest release, open issues, recent commits and top contributors. Read-only; the parts share the client cache, so it stays cheap.',
    repoParams({
      commits: { type: 'number', description: 'How many recent commits to include (default 5).' },
      issues: { type: 'number', description: 'How many open issues to include (default 5).' },
      contributors: { type: 'number', description: 'How many contributors to include (default 5).' },
    }),
    async (args) => {
      const { owner, repo } = await asRepo(args, liveConfig())
      return repoReport(await client(), {
        owner, repo, commits: args.commits, issues: args.issues, contributors: args.contributors,
      })
    },
  )

  tool(
    'gh_weekly_digest',
    'What happened in a repository inside a look-back window: releases, new issues, merged or closed pull requests and commits. Read-only.',
    repoParams({
      days: { type: 'number', description: 'Look-back window in days (default 7).' },
      limit: { type: 'number', description: 'How many items per list (default 10).' },
    }),
    async (args) => {
      const { owner, repo } = await asRepo(args, liveConfig())
      return weeklyDigest(await client(), { owner, repo, days: args.days, limit: args.limit })
    },
  )

  tool(
    'gh_notifications',
    'The attention queue for the authenticated account: mentions, review requests, assignments and watched threads, grouped by reason. Needs access with notification read permission. Read-only.',
    {
      all: { type: 'boolean', description: 'Include already-read notifications.' },
      participating: { type: 'boolean', description: 'Only threads the account participates in.' },
      limit: { type: 'number', description: 'How many notifications to return (default 20).' },
    },
    async (args) => listNotifications(await client(), { all: args.all, participating: args.participating, limit: args.limit }),
  )

  tool(
    'gh_repo_health',
    'A transparent maintenance score for a repository: five weighted dimensions with the evidence for each, the risks found and concrete next actions. It is a heuristic over public signals, not a security audit. Read-only.',
    repoParams(),
    async (args) => {
      const { owner, repo } = await asRepo(args, liveConfig())
      return repoHealth(await client(), { owner, repo })
    },
  )

  tool(
    'gh_compare',
    'Two repositories side by side with numeric deltas for stars, forks and open issues. Read-only.',
    {
      first: { type: 'string', description: 'First repository as "owner/repo".' },
      second: { type: 'string', description: 'Second repository as "owner/repo".' },
    },
    async (args) => compareRepos(await client(), { first: args.first, second: args.second }),
  )

  tool(
    'gh_trending',
    'Recently created repositories sorted by stars, optionally filtered by language. Uses the search quota. Read-only.',
    {
      language: { type: 'string', description: 'Language filter, e.g. "TypeScript".' },
      since: { type: 'string', description: 'Created after this date (YYYY-MM-DD); defaults to 30 days ago.' },
      limit: { type: 'number', description: 'How many repositories (default 10).' },
    },
    async (args) => trendingRepos(await client(), { language: args.language, since: args.since, limit: args.limit }),
  )

  tool(
    'gh_contributors',
    'Top contributors of a repository by commit count. Read-only.',
    repoParams({ limit: { type: 'number', description: 'How many contributors (default 10).' } }),
    async (args) => {
      const { owner, repo } = await asRepo(args, liveConfig())
      return listContributors(await client(), { owner, repo, limit: args.limit })
    },
  )

  tool(
    'gh_user_repos',
    "A user's or organization's repositories sorted by stars. Read-only.",
    {
      login: { type: 'string', description: 'GitHub login of the user or organization.' },
      limit: { type: 'number', description: 'How many repositories (default 10).' },
    },
    async (args) => userRepos(await client(), { login: args.login, limit: args.limit }),
  )

  tool(
    'gh_commits',
    'Recent commits of a repository, optionally since a date and on a specific branch. Read-only.',
    repoParams({
      branch: { type: 'string', description: 'Branch or ref; defaults to the default branch.' },
      since: { type: 'string', description: 'Only commits after this ISO timestamp.' },
      limit: { type: 'number', description: 'How many commits (default 10).' },
    }),
    async (args) => {
      const { owner, repo } = await asRepo(args, liveConfig())
      return listCommits(await client(), { owner, repo, branch: args.branch, since: args.since, limit: args.limit })
    },
  )
}
