import test from 'node:test'
import assert from 'node:assert/strict'

import {
  repoReport,
  weeklyDigest,
  listNotifications,
  repoHealth,
  healthOf,
  compareRepos,
  trendingRepos,
  userRepos,
  listCommits,
  listContributors,
} from '../lib/tools/insights.js'

/** Client double keyed by a path fragment. */
function clientDouble(routes) {
  const calls = []
  const pick = (path) => {
    for (const [fragment, value] of routes) {
      if (path.includes(fragment)) return value
    }
    return []
  }
  return {
    calls,
    get: async (path, opts) => {
      calls.push({ path, opts })
      return { data: pick(path) }
    },
  }
}

const repo = {
  full_name: 'o/r', description: 'demo', private: false, default_branch: 'main',
  stargazers_count: 10, forks_count: 2, open_issues_count: 3, language: 'TypeScript',
  license: { spdx_id: 'MIT' }, html_url: 'https://github.com/o/r', pushed_at: new Date().toISOString(),
  topics: [],
}

const release = { id: 1, tag_name: 'v1.0.0', name: 'v1.0.0', draft: false, prerelease: false, published_at: new Date().toISOString(), created_at: new Date().toISOString(), assets: [] }
const issue = { number: 1, title: 'bug', state: 'open', user: { login: 'u' }, created_at: new Date().toISOString(), labels: [], assignees: [] }
const pull = { number: 2, title: 'feat', state: 'open', user: { login: 'u' }, created_at: new Date().toISOString(), closed_at: new Date().toISOString(), labels: [], assignees: [], pull_request: { url: 'x' } }
const commit = { sha: 'abcdef1234567890', commit: { message: 'fix: thing\n\nbody', author: { name: 'Ann', date: new Date().toISOString() } } }

test('repoReport composes overview, release, issues, commits and contributors', async () => {
  const client = clientDouble([
    ['/releases', [release]],
    ['/contributors', [{ login: 'ann', contributions: 12, html_url: 'u' }]],
    ['/commits', [commit]],
    ['/issues', [issue]],
    ['/repos/o/r', repo],
  ])
  const report = await repoReport(client, { owner: 'o', repo: 'r' })
  assert.equal(report.repo, 'o/r')
  assert.equal(report.latestRelease.tag, 'v1.0.0')
  assert.equal(report.issues.length, 1)
  assert.equal(report.commits[0].shortSha, 'abcdef1')
  assert.equal(report.commits[0].message, 'fix: thing')
  assert.equal(report.contributors[0].login, 'ann')
})

test('a failing sub-call degrades the report instead of failing it', async () => {
  const client = {
    get: async (path) => {
      if (path.includes('/contributors') || path.includes('/commits')) throw new Error('boom')
      if (path.includes('/releases')) return { data: [] }
      if (path.includes('/issues')) return { data: [] }
      return { data: repo }
    },
  }
  const report = await repoReport(client, { owner: 'o', repo: 'r' })
  assert.equal(report.repo, 'o/r')
  assert.deepEqual(report.commits, [])
  assert.deepEqual(report.contributors, [])
  assert.equal(report.latestRelease, null)
})

test('weeklyDigest filters by the window and splits issues from pulls', async () => {
  const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString()
  const fresh = new Date().toISOString()
  const client = {
    get: async (path, opts) => {
      if (path.includes('/releases')) return { data: [{ ...release, published_at: fresh }, { ...release, id: 2, tag_name: 'v0.9.0', published_at: old }] }
      if (path.includes('/commits')) return { data: [commit] }
      if (path.includes('/issues')) {
        // the kind filter travels as a query parameter, so the double has to look at it
        const kind = opts && opts.query && opts.query.kind
        if (kind === 'pr') return { data: [pull] }
        if (kind === 'issue') return { data: [{ ...issue, created_at: fresh }, { ...issue, number: 9, created_at: old }] }
        return { data: [{ ...issue, created_at: fresh }, { ...issue, number: 9, created_at: old }, pull] }
      }
      return { data: [] }
    },
  }
  const digest = await weeklyDigest(client, { owner: 'o', repo: 'r', days: 7 })
  assert.equal(digest.windowDays, 7)
  assert.equal(digest.releases.length, 1, 'the old release is outside the window')
  assert.equal(digest.newIssues.length, 1, 'the old issue is outside the window')
  assert.equal(digest.mergedPulls.length, 1)
  assert.equal(digest.commits.length, 1)
})

test('notifications are grouped by reason and keep the issue number', async () => {
  const client = clientDouble([
    ['/notifications', [
      { id: '1', reason: 'mention', unread: true, updated_at: 'now', subject: { title: 'look', type: 'Issue', url: 'https://api.github.com/repos/o/r/issues/7' }, repository: { full_name: 'o/r' } },
      { id: '2', reason: 'mention', unread: true, updated_at: 'now', subject: { title: 'again', type: 'PullRequest', url: 'https://api.github.com/repos/o/r/pulls/8' }, repository: { full_name: 'o/r' } },
      { id: '3', reason: 'review_requested', unread: false, updated_at: 'now', subject: { title: 'review', type: 'PullRequest', url: 'https://api.github.com/repos/o/r/pulls/9' }, repository: { full_name: 'o/r' } },
    ]],
  ])
  const result = await listNotifications(client, { limit: 10 })
  assert.equal(result.count, 3)
  assert.deepEqual(result.byReason, { mention: 2, review_requested: 1 })
  assert.equal(result.notifications[0].number, 7)
  assert.equal(result.notifications[2].number, 9)
})

test('healthOf is transparent: every dimension carries its evidence', () => {
  const healthy = healthOf({
    repo: { fullName: 'o/r', pushedAt: new Date().toISOString(), license: 'MIT', description: 'x' },
    releases: [release], issues: [], pulls: [pull], commits: [commit, commit, commit, commit, commit],
  })
  assert.equal(healthy.score, 100)
  assert.equal(healthy.dimensions.length, 5)
  for (const dimension of healthy.dimensions) {
    assert.ok(dimension.evidence && dimension.evidence.length > 3, `${dimension.name} needs evidence`)
    assert.ok(dimension.score <= dimension.max)
  }
  assert.deepEqual(healthy.risks, [])
  assert.match(healthy.disclaimer, /not a security audit/)

  const stale = healthOf({
    repo: { fullName: 'o/r', pushedAt: new Date(Date.now() - 200 * 24 * 3600 * 1000).toISOString() },
    releases: [], issues: Array.from({ length: 12 }, () => issue), pulls: [], commits: [],
  })
  assert.ok(stale.score < 50, `stale score was ${stale.score}`)
  assert.ok(stale.risks.some((r) => /no push for/.test(r)))
  assert.ok(stale.risks.includes('no license declared'))
  assert.ok(stale.nextActions.length >= 3)
})

test('repoHealth gathers its own evidence', async () => {
  const client = clientDouble([
    ['/releases', [release]],
    ['/issues', [issue, pull]],
    ['/commits', [commit]],
    ['/repos/o/r', repo],
  ])
  const health = await repoHealth(client, { owner: 'o', repo: 'r' })
  assert.equal(health.repo, 'o/r')
  assert.ok(health.score > 0)
})

test('compareRepos reports numeric deltas and refuses malformed input', async () => {
  const client = {
    get: async (path) => ({ data: path.includes('/a/a') ? { ...repo, full_name: 'a/a', stargazers_count: 100 } : { ...repo, full_name: 'b/b', stargazers_count: 40 } }),
  }
  const compared = await compareRepos(client, { first: 'a/a', second: 'b/b' })
  assert.equal(compared.deltas.stars, 60)
  await assert.rejects(() => compareRepos(client, { first: 'nope', second: 'b/b' }), /two repositories/)
})

test('trending builds a search query and maps results', async () => {
  const client = clientDouble([['/search/repositories', { items: [repo], total_count: 1 }]])
  const trending = await trendingRepos(client, { language: 'TypeScript', limit: 5 })
  const query = client.calls[0].opts.query
  assert.match(query.q, /created:>/)
  assert.match(query.q, /language:TypeScript/)
  assert.equal(query.sort, 'stars')
  assert.equal(trending.count, 1)
})

test('userRepos requires a login and sorts by stars', async () => {
  const client = clientDouble([['/users/ann/repos', [repo]]])
  const result = await userRepos(client, { login: 'ann' })
  assert.equal(result.login, 'ann')
  assert.equal(client.calls[0].opts.query.sort, 'stars')
  await assert.rejects(() => userRepos(client, {}), /login is required/)
})

test('listCommits and listContributors cut the page locally', async () => {
  const many = Array.from({ length: 50 }, (_, i) => ({ ...commit, sha: `sha${i}` }))
  const client = clientDouble([['/commits', many], ['/contributors', many.map((_, i) => ({ login: `u${i}`, contributions: i, html_url: 'u' }))]])
  const commits = await listCommits(client, { owner: 'o', repo: 'r', limit: 3 })
  assert.equal(commits.count, 3)
  const contributors = await listContributors(client, { owner: 'o', repo: 'r', limit: 2 })
  assert.equal(contributors.count, 2)
})
