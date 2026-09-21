// Composed reports: the answers a person actually asks for.
//
// Each function is a small composition over the plain reads, so the cache in the client
// makes a report cheap and the pieces stay testable. Nothing here is a verdict on quality:
// a health score is a transparent heuristic with its evidence attached, and the digest only
// reports what happened in a window.

import { getRepo, normalizeRepo } from './repos.js'
import { listReleases } from './releases.js'
import { listIssues } from './issues.js'
import { listRuns } from './actions.js'

function ensureRepo({ owner, repo }) {
  if (!owner || !repo) throw new Error('owner and repo are required')
}

function normalizeCommit(data) {
  return {
    sha: data && data.sha,
    shortSha: data && data.sha ? String(data.sha).slice(0, 7) : '',
    message: data && data.commit && data.commit.message ? String(data.commit.message).split('\n')[0] : '',
    author: (data && data.commit && data.commit.author && data.commit.author.name) || (data && data.author && data.author.login) || '',
    date: (data && data.commit && data.commit.author && data.commit.author.date) || '',
  }
}

/** Recent commits of a branch. */
export async function listCommits(client, { owner, repo, branch, limit = 10, since } = {}) {
  ensureRepo({ owner, repo })
  const capped = Math.max(1, Math.min(Number(limit) || 10, 100))
  const query = { per_page: capped }
  if (since) query.since = since
  const { data } = await client.get(`/repos/${owner}/${repo}/commits`, {
    query: branch ? { ...query, sha: branch } : query,
  })
  const commits = (Array.isArray(data) ? data : []).map(normalizeCommit).slice(0, capped)
  return { commits, count: commits.length }
}

/** Top contributors by commit count. */
export async function listContributors(client, { owner, repo, limit = 10 } = {}) {
  ensureRepo({ owner, repo })
  const capped = Math.max(1, Math.min(Number(limit) || 10, 100))
  const { data } = await client.get(`/repos/${owner}/${repo}/contributors`, { query: { per_page: capped } })
  const contributors = (Array.isArray(data) ? data : []).slice(0, capped).map((c) => ({
    login: c.login,
    contributions: c.contributions,
    url: c.html_url,
  }))
  return { contributors, count: contributors.length }
}

/**
 * One call that answers "what is this repository": overview, latest release, open issues,
 * recent commits and top contributors. Composed calls share the client cache, so the whole
 * report costs a handful of requests.
 */
export async function repoReport(client, { owner, repo, commits: commitLimit = 5, issues: issueLimit = 5, contributors: contributorLimit = 5 } = {}) {
  ensureRepo({ owner, repo })
  const overview = await getRepo(client, { owner, repo })
  const [releases, openIssues, commitList, contributorList] = await Promise.all([
    listReleases(client, { owner, repo, limit: 1 }).catch(() => ({ releases: [] })),
    listIssues(client, { owner, repo, state: 'open', limit: issueLimit }).catch(() => ({ issues: [] })),
    listCommits(client, { owner, repo, branch: overview.defaultBranch, limit: commitLimit }).catch(() => ({ commits: [] })),
    listContributors(client, { owner, repo, limit: contributorLimit }).catch(() => ({ contributors: [] })),
  ])
  return {
    repo: overview.fullName,
    description: overview.description,
    stars: overview.stars,
    forks: overview.forks,
    openIssues: overview.openIssues,
    language: overview.language,
    license: overview.license,
    defaultBranch: overview.defaultBranch,
    pushedAt: overview.pushedAt,
    url: overview.url,
    latestRelease: releases.releases[0] || null,
    issues: openIssues.issues,
    commits: commitList.commits,
    contributors: contributorList.contributors,
  }
}

/** What happened in a repository inside a look-back window. */
export async function weeklyDigest(client, { owner, repo, days = 7, limit = 10 } = {}) {
  ensureRepo({ owner, repo })
  const window = Math.max(1, Math.min(Number(days) || 7, 90))
  const capped = Math.max(1, Math.min(Number(limit) || 10, 50))
  const since = new Date(Date.now() - window * 24 * 60 * 60 * 1000).toISOString()

  const [releases, issues, pulls, commits] = await Promise.all([
    listReleases(client, { owner, repo, limit: capped }).catch(() => ({ releases: [] })),
    // pull requests are excluded from "new issues": they are reported separately below
    listIssues(client, { owner, repo, state: 'all', kind: 'issue', limit: capped }).catch(() => ({ issues: [] })),
    listIssues(client, { owner, repo, state: 'all', kind: 'pr', limit: capped }).catch(() => ({ issues: [] })),
    listCommits(client, { owner, repo, limit: capped, since }).catch(() => ({ commits: [] })),
  ])
  const after = (value) => Boolean(value) && value >= since
  return {
    windowDays: window,
    since,
    releases: releases.releases.filter((r) => after(r.publishedAt || r.createdAt)),
    newIssues: issues.issues.filter((i) => after(i.createdAt)),
    mergedPulls: pulls.issues.filter((i) => after(i.closedAt || i.updatedAt)),
    commits: commits.commits,
  }
}

/**
 * The attention queue: mentions, review requests, assignments and threads the token watches.
 * Needs access with notification read permission; a missing scope surfaces as an actionable
 * failure rather than an empty list.
 */
export async function listNotifications(client, { all = false, participating = false, limit = 20 } = {}) {
  const capped = Math.max(1, Math.min(Number(limit) || 20, 100))
  const query = { per_page: capped }
  if (all) query.all = 'true'
  if (participating) query.participating = 'true'
  const { data } = await client.get('/notifications', { query })
  const items = (Array.isArray(data) ? data : []).slice(0, capped).map((n) => ({
    id: n.id,
    reason: n.reason,
    unread: Boolean(n.unread),
    updatedAt: n.updated_at,
    title: n.subject && n.subject.title,
    type: n.subject && n.subject.type,
    number: n.subject && n.subject.url ? Number(String(n.subject.url).split('/').pop()) : null,
    repository: n.repository ? n.repository.full_name : '',
  }))
  const byReason = {}
  for (const item of items) byReason[item.reason] = (byReason[item.reason] || 0) + 1
  return { count: items.length, byReason, notifications: items }
}

/**
 * A transparent maintenance heuristic. Every point of the score carries its evidence, and the
 * result states plainly that it is not a security audit.
 */
export function healthOf({ repo, releases = [], issues = [], pulls = [], commits = [] } = {}) {
  const dimensions = []
  const daysSince = (value) => (value ? Math.floor((Date.now() - Date.parse(value)) / (24 * 60 * 60 * 1000)) : null)

  const pushed = daysSince(repo && repo.pushedAt)
  const activity = pushed === null ? 0 : pushed <= 7 ? 25 : pushed <= 30 ? 18 : pushed <= 90 ? 10 : 3
  dimensions.push({ name: 'activity', score: activity, max: 25, evidence: pushed === null ? 'no push date' : `last push ${pushed} day(s) ago` })

  const releaseScore = releases.length ? 20 : 8
  dimensions.push({ name: 'releases', score: releaseScore, max: 20, evidence: releases.length ? `latest ${releases[0].tag} (${releases[0].publishedAt || 'unpublished'})` : 'no releases published' })

  const openCount = Array.isArray(issues) ? issues.length : 0
  const issueScore = openCount === 0 ? 20 : openCount <= 3 ? 15 : openCount <= 10 ? 9 : 4
  dimensions.push({ name: 'issue-load', score: issueScore, max: 20, evidence: `${openCount} open issue(s) in the last page` })

  const prScore = Array.isArray(pulls) && pulls.length ? 15 : 8
  dimensions.push({ name: 'review-load', score: prScore, max: 15, evidence: Array.isArray(pulls) && pulls.length ? `${pulls.length} recent pull request(s)` : 'no recent pull requests' })

  const commitCount = Array.isArray(commits) ? commits.length : 0
  const commitScore = commitCount >= 5 ? 20 : commitCount > 0 ? 12 : 4
  dimensions.push({ name: 'commits', score: commitScore, max: 20, evidence: `${commitCount} commit(s) in the last page` })

  const score = dimensions.reduce((sum, d) => sum + d.score, 0)
  const risks = []
  if (pushed !== null && pushed > 90) risks.push(`no push for ${pushed} days`)
  if (!releases.length) risks.push('no published release')
  if (!(repo && repo.license)) risks.push('no license declared')
  if (!(repo && repo.description)) risks.push('no description')
  if (openCount > 10) risks.push('large open issue backlog')

  const nextActions = []
  if (!releases.length) nextActions.push('publish the first release')
  if (!(repo && repo.license)) nextActions.push('add a LICENSE')
  if (!(repo && repo.description)) nextActions.push('write a repository description')
  if (pushed !== null && pushed > 90) nextActions.push('push a change or archive the repository')

  return {
    repo: repo && repo.fullName,
    score,
    max: 100,
    dimensions,
    risks,
    nextActions,
    disclaimer: 'A maintenance heuristic over public signals, not a security audit.',
  }
}

/** Repository health for one repository, gathering its own evidence. */
export async function repoHealth(client, { owner, repo } = {}) {
  ensureRepo({ owner, repo })
  const [repository, releases, issues, pulls, commits] = await Promise.all([
    getRepo(client, { owner, repo }),
    listReleases(client, { owner, repo, limit: 3 }).catch(() => ({ releases: [] })),
    listIssues(client, { owner, repo, state: 'open', limit: 30 }).catch(() => ({ issues: [] })),
    listIssues(client, { owner, repo, state: 'open', kind: 'pr', limit: 30 }).catch(() => ({ issues: [] })),
    listCommits(client, { owner, repo, limit: 10 }).catch(() => ({ commits: [] })),
  ])
  return healthOf({ repo: repository, releases: releases.releases, issues: issues.issues, pulls: pulls.issues, commits: commits.commits })
}

/** Two repositories side by side, with numeric deltas. */
export async function compareRepos(client, { first, second } = {}) {
  const a = typeof first === 'string' ? first : ''
  const b = typeof second === 'string' ? second : ''
  if (!a.includes('/') || !b.includes('/')) throw new Error('pass two repositories as "owner/repo"')
  const [left, right] = await Promise.all([a, b].map(async (spec) => {
    const [owner, repo] = spec.split('/')
    return getRepo(client, { owner, repo })
  }))
  const delta = (x, y) => (typeof x === 'number' && typeof y === 'number' ? x - y : null)
  return {
    first: left,
    second: right,
    deltas: {
      stars: delta(left.stars, right.stars),
      forks: delta(left.forks, right.forks),
      openIssues: delta(left.openIssues, right.openIssues),
    },
  }
}

/** Recently created repositories, by stars. Uses the search quota. */
export async function trendingRepos(client, { language, since, limit = 10 } = {}) {
  const capped = Math.max(1, Math.min(Number(limit) || 10, 50))
  const created = since || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const parts = [`created:>${created}`, 'stars:>50']
  if (language) parts.push(`language:${language}`)
  const { data } = await client.get('/search/repositories', {
    query: { q: parts.join(' '), sort: 'stars', order: 'desc', per_page: capped },
  })
  const repos = ((data && data.items) || []).slice(0, capped).map(normalizeRepo)
  return { since: created, count: repos.length, repos }
}

/** A user's repositories by stars. */
export async function userRepos(client, { login, limit = 10 } = {}) {
  if (!login) throw new Error('login is required')
  const capped = Math.max(1, Math.min(Number(limit) || 10, 100))
  const { data } = await client.get(`/users/${encodeURIComponent(login)}/repos`, {
    query: { sort: 'stars', direction: 'desc', per_page: capped },
  })
  const repos = (Array.isArray(data) ? data : []).slice(0, capped).map(normalizeRepo)
  return { login, count: repos.length, repos }
}

// Re-exported so a caller composing its own report needs one import.
export { listRuns }
