import test from 'node:test'
import assert from 'node:assert/strict'

import { matrixStatus, clearMatrixCache } from '../lib/tools/matrix.js'

function clientDouble(routes) {
  const calls = []
  const pick = (path) => {
    for (const [pattern, value] of routes) {
      if (path.startsWith(pattern)) return typeof value === 'function' ? value(path) : value
    }
    const err = new Error(`not found: ${path}`)
    err.status = 404
    throw err
  }
  return {
    calls,
    get: async (path, opts) => { calls.push({ method: 'GET', path, opts }); return { data: pick(path) } },
  }
}

test('matrixStatus queries org repos and gathers release, CI and npm info', async () => {
  clearMatrixCache()
  const repos = [
    {
      name: 'pkg-a',
      full_name: 'goodandready/pkg-a',
      private: false,
      description: 'Package A',
      stargazers_count: 5,
      open_issues_count: 2,
      default_branch: 'main',
      pushed_at: '2026-01-01T00:00:00Z',
      html_url: 'https://github.com/goodandready/pkg-a',
      owner: { login: 'goodandready' },
    },
    {
      name: 'pkg-b',
      full_name: 'goodandready/pkg-b',
      private: true,
      description: 'Package B',
      stargazers_count: 0,
      open_issues_count: 0,
      default_branch: 'main',
      pushed_at: '2026-01-02T00:00:00Z',
      html_url: 'https://github.com/goodandready/pkg-b',
      owner: { login: 'goodandready' },
    },
  ]

  const client = clientDouble([
    ['/orgs/goodandready/repos', repos],
    ['/repos/goodandready/pkg-a/releases/latest', { tag_name: 'v1.0.0', name: 'v1.0.0', published_at: '2026-01-01', prerelease: false, html_url: 'https://github.com/goodandready/pkg-a/releases/v1.0.0' }],
    ['/repos/goodandready/pkg-a/actions/runs', { workflow_runs: [{ id: 101, name: 'CI', status: 'completed', conclusion: 'success', html_url: 'https://ci/101', created_at: '2026-01-01' }] }],
    ['/repos/goodandready/pkg-a/contents/package.json', { content: Buffer.from(JSON.stringify({ name: '@goodandready/pkg-a', version: '1.0.0' })).toString('base64') }],
    ['/repos/goodandready/pkg-b/tags', [{ name: 'v0.1.0' }]],
    ['/repos/goodandready/pkg-b/actions/runs', { workflow_runs: [{ id: 102, name: 'Build', status: 'completed', conclusion: 'failure', html_url: 'https://ci/102', created_at: '2026-01-02' }] }],
  ])

  const fakeFetch = async (url) => {
    if (url.includes('@goodandready%2Fpkg-a')) {
      return { ok: true, json: async () => ({ 'dist-tags': { latest: '1.0.0' } }) }
    }
    return { ok: false, status: 404 }
  }

  const result = await matrixStatus(client, { org: 'goodandready', limit: 10 }, { fetchFn: fakeFetch })

  assert.equal(result.org, 'goodandready')
  assert.equal(result.totalRepos, 2)
  assert.equal(result.cached, false)
  assert.equal(result.matrix.length, 2)

  const a = result.matrix.find((r) => r.name === 'pkg-a')
  assert.ok(a)
  assert.equal(a.release?.tag, 'v1.0.0')
  assert.equal(a.ci?.conclusion, 'success')
  assert.equal(a.npm?.version, '1.0.0')
  assert.equal(a.status, 'healthy')

  const b = result.matrix.find((r) => r.name === 'pkg-b')
  assert.ok(b)
  assert.equal(b.release?.tag, 'v0.1.0')
  assert.equal(b.ci?.conclusion, 'failure')
  assert.equal(b.npm, null)
  assert.equal(b.status, 'failing')

  // Second call within TTL hits cache
  const cachedResult = await matrixStatus(client, { org: 'goodandready', limit: 10 }, { fetchFn: fakeFetch })
  assert.equal(cachedResult.cached, true)
  assert.equal(cachedResult.totalRepos, 2)
})

test('matrixStatus falls back to user repos when org returns 404', async () => {
  clearMatrixCache()
  const userRepos = [
    {
      name: 'my-project',
      full_name: 'octocat/my-project',
      private: false,
      stargazers_count: 10,
      open_issues_count: 1,
      default_branch: 'main',
      pushed_at: '2026-01-01',
      html_url: 'https://github.com/octocat/my-project',
      owner: { login: 'octocat' },
    },
  ]

  const client = clientDouble([
    ['/users/octocat/repos', userRepos],
  ])

  const result = await matrixStatus(client, { org: 'octocat', includeNpm: false, includeCi: false, includeReleases: false }, { fetchFn: async () => ({ ok: false }) })
  assert.equal(result.org, 'octocat')
  assert.equal(result.totalRepos, 1)
  assert.equal(result.matrix[0].name, 'my-project')
  assert.equal(result.matrix[0].status, 'active')
})

test('matrixStatus infers org from authenticated user when omitted', async () => {
  clearMatrixCache()
  const client = clientDouble([
    ['/user', { login: 'self-user' }],
    ['/orgs/self-user/repos', []],
    ['/users/self-user/repos', []],
  ])

  const result = await matrixStatus(client, {}, { fetchFn: async () => ({ ok: false }) })
  assert.equal(result.org, 'self-user')
  assert.equal(result.totalRepos, 0)
})
