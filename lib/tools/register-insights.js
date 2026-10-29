import { listSecurityAlerts, getDependabotAlert } from './security.js'
import { findRepos, exploreTopic } from './explore.js'
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
    'Recently created repositories sorted by stars, optionally filtered by language, topic, and time window (daily, weekly, monthly). Uses the search quota. Read-only.',
    {
      language: { type: 'string', description: 'Language filter, e.g. "TypeScript".' },
      topic: { type: 'string', description: 'GitHub topic filter, e.g. "agent".' },
      window: { type: 'string', description: 'Time window: "daily", "weekly", or "monthly".' },
      since: { type: 'string', description: 'Created after this date (YYYY-MM-DD); defaults to 30 days ago.' },
      minStars: { type: 'number', description: 'Minimum stars (default 50).' },
      limit: { type: 'number', description: 'How many repositories (default 10).' },
    },
    async (args) => trendingRepos(await client(), {
      language: args.language,
      topic: args.topic,
      window: args.window,
      since: args.since,
      minStars: args.minStars,
      limit: args.limit,
    }),
  )

  tool(
    'gh_find_repos',
    'Smart repository search with default exclusions of forks and archived repos, star thresholds, and deduplication. Read-only.',
    {
      query: { type: 'string', description: 'Search keywords or topic.' },
      minStars: { type: 'number', description: 'Minimum stars threshold (default 10).' },
      includeForks: { type: 'boolean', description: 'Include forked repositories (default false).' },
      includeArchived: { type: 'boolean', description: 'Include archived repositories (default false).' },
      language: { type: 'string', description: 'Filter by programming language, e.g. "TypeScript".' },
      topic: { type: 'string', description: 'Filter by GitHub topic, e.g. "agent".' },
      scope: { type: 'string', description: 'Search scope: "all" or "readme" (default "all").' },
      sort: { type: 'string', description: 'Sort field: "stars", "forks", "updated" (default "stars").' },
      order: { type: 'string', description: 'Sort order: "desc" or "asc" (default "desc").' },
      limit: { type: 'number', description: 'Number of repositories to return (default 20, max 100).' },
    },
    async (args) => findRepos(await client(), {
      query: args.query,
      minStars: args.minStars,
      includeForks: args.includeForks,
      includeArchived: args.includeArchived,
      language: args.language,
      topic: args.topic,
      scope: args.scope,
      sort: args.sort,
      order: args.order,
      limit: args.limit,
    }),
  )

  tool(
    'gh_explore',
    'Multi-axis exploration of GitHub repositories across 2 to 4 semantic topics. Searches in parallel, calculates cross-axis relevance scores, penalizes awesome-lists, writes full detailed report to temporary disk file, and returns a compact summary (<= 3 KB). Read-only.',
    {
      axes: {
        type: 'array',
        description: '2 to 4 exploration axes. Can be array of "name|query" strings or objects with name and query.',
        items: { type: 'object', additionalProperties: true, description: 'Axis definition with name and query.' },
      },
      minStars: { type: 'number', description: 'Minimum star threshold per axis (default 10).' },
      limitPerAxis: { type: 'number', description: 'Max repositories to fetch per axis (default 20, max 50).' },
      writeReport: { type: 'boolean', description: 'Save full structured report to temporary file on disk (default true).' },
      reportPath: { type: 'string', description: 'Custom path for full JSON report (defaults to os tmpdir).' },
    },
    async (args) => exploreTopic(await client(), {
      axes: args.axes,
      minStars: args.minStars,
      limitPerAxis: args.limitPerAxis,
      writeReport: args.writeReport,
      reportPath: args.reportPath,
    }),
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

  tool(
    'gh_security_alerts',
    'Summary of Dependabot, Secret Scanning, and CodeQL alerts for a repository. Gracefully degrades if alerts are disabled or token lacks security scope. Read-only.',
    repoParams({
      state: { type: 'string', description: 'Filter by state (open, fixed, dismissed, all; default "open").' },
      severity: { type: 'string', description: 'Filter by severity (critical, high, medium, low).' },
      limit: { type: 'number', description: 'Max alerts per category (default 30, max 100).' },
    }),
    async (args) => {
      const { owner, repo } = await asRepo(args, liveConfig())
      return listSecurityAlerts(await client(), {
        owner, repo, state: args.state, severity: args.severity, limit: args.limit,
      })
    },
  )

  tool(
    'gh_dependabot_alert_view',
    'Read details of a Dependabot alert: vulnerable package, advisory summary, CVSS score, and recommended safe version. Read-only.',
    repoParams({
      alertNumber: { type: 'number', description: 'The Dependabot alert number.' },
    }),
    async (args) => {
      const { owner, repo } = await asRepo(args, liveConfig())
      const num = args.alertNumber ?? args.alert_number
      return getDependabotAlert(await client(), { owner, repo, alertNumber: num })
    },
  )
}
