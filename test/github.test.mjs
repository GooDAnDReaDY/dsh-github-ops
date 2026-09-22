import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createGitHubClient,
  parseRepoSpec,
  describeError,
  GitHubError,
  DEFAULT_BASE_URL,
  retryDelayMs,
  SAFE_RETRY_METHODS,
  RETRYABLE_STATUS,
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

// ----------------------------------------------------------------- retries

function scriptedFetch(steps) {
  const calls = []
  let index = 0
  const impl = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET' })
    const step = steps[Math.min(index, steps.length - 1)]
    index += 1
    if (step.throw) throw step.throw
    const headers = new Map(Object.entries(step.headers || {}))
    return {
      ok: (step.status || 200) < 400,
      status: step.status || 200,
      headers: { get: (k) => (headers.has(k.toLowerCase()) ? headers.get(k.toLowerCase()) : null) },
      text: async () => JSON.stringify(step.body ?? {}),
    }
  }
  impl.calls = calls
  return impl
}

test('a read is retried on a 5xx and succeeds on the next attempt', async () => {
  const fetchImpl = scriptedFetch([{ status: 503, body: { message: 'Server Error' } }, { status: 200, body: { ok: true } }])
  const slept = []
  const client = createGitHubClient({ token: 't', fetchImpl, sleepImpl: async (ms) => { slept.push(ms) } })
  const { data, attempts } = await client.get('/repos/o/r')
  assert.deepEqual(data, { ok: true })
  assert.equal(attempts, 2)
  assert.equal(fetchImpl.calls.length, 2)
  assert.equal(slept.length, 1)
  assert.ok(slept[0] > 0, 'the second attempt waits')
})

test('a write is never retried: a failed write has an unknown outcome', async () => {
  const fetchImpl = scriptedFetch([{ status: 503, body: { message: 'Server Error' } }])
  const slept = []
  const client = createGitHubClient({ token: 't', fetchImpl, sleepImpl: async (ms) => { slept.push(ms) } })
  await assert.rejects(
    () => client.post('/repos/o/r/issues', { title: 'x' }),
    (err) => {
      assert.equal(err.status, 503)
      assert.equal(err.attempts, 1)
      return true
    },
  )
  assert.equal(fetchImpl.calls.length, 1, 'no second POST')
  assert.deepEqual(slept, [])
})

test('a 429 waits for Retry-After and then retries a read', async () => {
  const fetchImpl = scriptedFetch([
    { status: 429, headers: { 'retry-after': '2' }, body: { message: 'Slow down' } },
    { status: 200, body: { ok: true } },
  ])
  const slept = []
  const client = createGitHubClient({ token: 't', fetchImpl, sleepImpl: async (ms) => { slept.push(ms) } })
  const { attempts } = await client.get('/repos/o/r')
  assert.equal(attempts, 2)
  assert.deepEqual(slept, [2000])
})

test('a network failure is retried for a read and reported for a write', async () => {
  const flaky = scriptedFetch([{ throw: new Error('socket hang up') }, { status: 200, body: { ok: true } }])
  const client = createGitHubClient({ token: 't', fetchImpl: flaky, sleepImpl: async () => {} })
  const { attempts } = await client.get('/repos/o/r')
  assert.equal(attempts, 2)

  const broken = scriptedFetch([{ throw: new Error('socket hang up') }])
  const writer = createGitHubClient({ token: 't', fetchImpl: broken, sleepImpl: async () => {} })
  await assert.rejects(() => writer.patch('/repos/o/r', {}), (err) => err.code === 'network' && err.attempts === 1)
})

test('retries stop at maxRetries and the failure says how many attempts were made', async () => {
  const fetchImpl = scriptedFetch([{ status: 502, body: { message: 'Bad Gateway' } }])
  const client = createGitHubClient({ token: 't', fetchImpl, maxRetries: 2, sleepImpl: async () => {} })
  await assert.rejects(
    () => client.get('/repos/o/r'),
    (err) => {
      assert.equal(err.attempts, 3)
      assert.match(describeError(err), /3 attempts/)
      return true
    },
  )
  assert.equal(fetchImpl.calls.length, 3)
})

test('a 404 is not retried: it is an answer, not a hiccup', async () => {
  const fetchImpl = scriptedFetch([{ status: 404, body: { message: 'Not Found' } }])
  const client = createGitHubClient({ token: 't', fetchImpl, sleepImpl: async () => { throw new Error('must not sleep') } })
  await assert.rejects(() => client.get('/repos/o/missing'), (err) => err.status === 404)
  assert.equal(fetchImpl.calls.length, 1)
})

test('retryDelayMs prefers Retry-After, then the limit reset, then backoff, and always caps', () => {
  const headersOf = (map) => ({ get: (k) => map[k.toLowerCase()] ?? null })
  assert.equal(retryDelayMs({ headers: headersOf({ 'retry-after': '3' }) }), 3000)
  assert.equal(retryDelayMs({ headers: headersOf({ 'retry-after': '999' }), maxDelayMs: 10000 }), 10000)
  const future = new Date(Date.now() + 4000).toUTCString()
  const dated = retryDelayMs({ headers: headersOf({ 'retry-after': future }), maxDelayMs: 10000 })
  assert.ok(dated > 3000 && dated <= 10000, `HTTP-date honoured, got ${dated}`)
  const reset = Math.floor((Date.now() + 3000) / 1000)
  const limit = retryDelayMs({ headers: headersOf({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) }), maxDelayMs: 10000 })
  assert.ok(limit > 1000 && limit <= 10000, `limit reset honoured, got ${limit}`)
  assert.equal(retryDelayMs({ attempt: 1, baseMs: 500 }), 500)
  assert.equal(retryDelayMs({ attempt: 4, baseMs: 500 }), 4000)
  assert.equal(retryDelayMs({ attempt: 9, baseMs: 500, maxDelayMs: 10000 }), 10000)
})

test('SAFE_RETRY_METHODS covers reads only', () => {
  assert.ok(SAFE_RETRY_METHODS.has('GET'))
  assert.ok(SAFE_RETRY_METHODS.has('HEAD'))
  assert.ok(!SAFE_RETRY_METHODS.has('POST'))
  assert.ok(!SAFE_RETRY_METHODS.has('DELETE'))
  assert.ok(RETRYABLE_STATUS.has(429) && RETRYABLE_STATUS.has(503))
  assert.ok(!RETRYABLE_STATUS.has(404))
})
