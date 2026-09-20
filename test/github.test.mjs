import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createGitHubClient,
  parseRepoSpec,
  describeError,
  GitHubError,
  DEFAULT_BASE_URL,
} from '../lib/github.js'

/** Fake fetch: records calls, answers from a queue of canned responses. */
function fakeFetch(responses) {
  const calls = []
  const queue = [...responses]
  const impl = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', headers: init.headers || {}, body: init.body })
    const next = queue.shift() || { status: 200, body: {} }
    const headers = new Map(Object.entries(next.headers || {}))
    return {
      ok: (next.status || 200) < 400,
      status: next.status || 200,
      headers: { get: (k) => (headers.has(k.toLowerCase()) ? headers.get(k.toLowerCase()) : null) },
      text: async () => (typeof next.body === 'string' ? next.body : JSON.stringify(next.body ?? {})),
    }
  }
  impl.calls = calls
  return impl
}

test('GET builds the URL with query parameters and sends auth + api version', async () => {
  const fetchImpl = fakeFetch([{ status: 200, body: [{ id: 1 }] }])
  const client = createGitHubClient({ token: 'test-token', fetchImpl })
  const { data } = await client.get('/repos/o/r/releases', { query: { per_page: 5, page: 2, empty: '' } })

  assert.deepEqual(data, [{ id: 1 }])
  const call = fetchImpl.calls[0]
  assert.equal(call.method, 'GET')
  assert.ok(call.url.startsWith(`${DEFAULT_BASE_URL}/repos/o/r/releases?`))
  assert.ok(call.url.includes('per_page=5'))
  assert.ok(call.url.includes('page=2'))
  assert.ok(!call.url.includes('empty='), 'empty query values are dropped')
  assert.equal(call.headers.authorization, 'Bearer test-token')
  assert.equal(call.headers['x-github-api-version'], '2022-11-28')
})

test('a 404 becomes a GitHubError carrying status and code', async () => {
  const fetchImpl = fakeFetch([{ status: 404, body: { message: 'Not Found' } }])
  const client = createGitHubClient({ token: 't', fetchImpl })
  await assert.rejects(
    () => client.get('/repos/o/missing'),
    (err) => {
      assert.ok(err instanceof GitHubError)
      assert.equal(err.status, 404)
      assert.equal(err.code, 'http_error')
      assert.equal(err.message, 'Not Found')
      return true
    },
  )
})

test('an exhausted rate limit is reported with the reset time', async () => {
  const reset = Math.floor(Date.now() / 1000) + 60
  const fetchImpl = fakeFetch([{
    status: 403,
    headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-limit': '5000', 'x-ratelimit-reset': String(reset) },
    body: { message: 'API rate limit exceeded' },
  }])
  const client = createGitHubClient({ token: 't', fetchImpl })
  await assert.rejects(
    () => client.get('/repos/o/r'),
    (err) => {
      assert.equal(err.code, 'rate_limited')
      assert.equal(err.rateLimit.remaining, 0)
      assert.ok(err.rateLimit.resetAt)
      assert.match(describeError(err), /rate limit exhausted/)
      return true
    },
  )
})

test('a transport failure is reported as a network error, a timeout as timeout', async () => {
  const boom = createGitHubClient({ token: 't', fetchImpl: async () => { throw new Error('socket hang up') } })
  await assert.rejects(() => boom.get('/x'), (err) => err.code === 'network' && /socket hang up/.test(err.message))

  const hang = createGitHubClient({
    token: 't',
    timeoutMs: 5,
    fetchImpl: (url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        const err = new Error('aborted')
        err.name = 'AbortError'
        reject(err)
      })
    }),
  })
  await assert.rejects(() => hang.get('/x'), (err) => err.code === 'timeout' && /timed out/.test(err.message))
})

test('non-JSON bodies do not crash the client', async () => {
  const fetchImpl = fakeFetch([{ status: 200, body: 'not json at all' }])
  const client = createGitHubClient({ token: 't', fetchImpl })
  const { data } = await client.get('/x')
  assert.deepEqual(data, { raw: 'not json at all' })
})

test('pagination walks pages until a short page and honours maxItems', async () => {
  const page = (n) => Array.from({ length: n }, (_, i) => ({ id: i }))
  const fetchImpl = fakeFetch([
    { status: 200, body: page(100) },
    { status: 200, body: page(100) },
    { status: 200, body: page(5) },
  ])
  const client = createGitHubClient({ token: 't', fetchImpl })
  const items = await client.paginate('/repos/o/r/git/refs/tags', { pageSize: 100, maxItems: 500 })
  assert.equal(items.length, 205)
  assert.equal(fetchImpl.calls.length, 3)
})

test('graphql surfaces errors as a GitHubError and returns data otherwise', async () => {
  const bad = fakeFetch([{ status: 200, body: { errors: [{ message: 'Field does not exist' }] } }])
  const client = createGitHubClient({ token: 't', fetchImpl: bad })
  await assert.rejects(() => client.graphql('query { x }'), (err) => err.code === 'graphql_error')

  const good = fakeFetch([{ status: 200, body: { data: { viewer: { login: 'octocat' } } } }])
  const okClient = createGitHubClient({ token: 't', fetchImpl: good })
  assert.deepEqual(await okClient.graphql('query { viewer { login } }'), { viewer: { login: 'octocat' } })
})

test('parseRepoSpec accepts owner/repo, with or without a PR number', () => {
  assert.deepEqual(parseRepoSpec('GooDAnDReaDY/dsh-gitea'), { owner: 'GooDAnDReaDY', repo: 'dsh-gitea', number: null })
  assert.deepEqual(parseRepoSpec('o/r#123'), { owner: 'o', repo: 'r', number: 123 })
  assert.equal(parseRepoSpec('no-slash'), null)
  assert.equal(parseRepoSpec('a/b/c'), null)
  assert.equal(parseRepoSpec(''), null)
  assert.equal(parseRepoSpec(undefined), null)
})

test('createGitHubClient refuses to be constructed without a transport', () => {
  assert.throws(() => createGitHubClient({ token: 't', fetchImpl: null }), /no fetch implementation/)
})
