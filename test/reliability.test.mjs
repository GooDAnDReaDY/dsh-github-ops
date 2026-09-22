import test from 'node:test'
import assert from 'node:assert/strict'

import { createGitHubClient, describeError, hintFor, GitHubError } from '../lib/github.js'
import { listReleases } from '../lib/tools/releases.js'
import { listIssues } from '../lib/tools/issues.js'
import { listRuns } from '../lib/tools/actions.js'
import { searchRepos } from '../lib/tools/repos.js'

/** Fake fetch with per-URL call counting. */
function countingFetch(responses = []) {
  const calls = []
  const impl = async (url, init = {}) => {
    calls.push(url)
    const next = responses.shift() || { status: 200, body: {} }
    if (next.throw) throw next.throw
    const headers = new Map(Object.entries(next.headers || {}))
    return {
      ok: (next.status || 200) < 400,
      status: next.status || 200,
      headers: { get: (k) => (headers.has(k.toLowerCase()) ? headers.get(k.toLowerCase()) : null) },
      text: async () => JSON.stringify(next.body ?? {}),
    }
  }
  impl.calls = calls
  return impl
}

// ------------------------------------------------------------------ TTL cache

test('a repeated read is served from the cache, a write is not', async () => {
  const fetchImpl = countingFetch([{ status: 200, body: { n: 1 } }])
  const client = createGitHubClient({ token: 't', fetchImpl, cacheTtlMs: 60000 })
  const first = await client.get('/repos/o/r')
  const second = await client.get('/repos/o/r')
  assert.equal(second.data.n, 1)
  assert.equal(second.cached, true)
  assert.equal(fetchImpl.calls.length, 1, 'the second read did not hit the network')

  // a different query is a different cache key
  await client.get('/repos/o/r', { query: { page: 2 } })
  assert.equal(fetchImpl.calls.length, 2)

  // writes are never cached and never served from the cache
  await client.post('/repos/o/r/issues', { title: 'x' })
  await client.post('/repos/o/r/issues', { title: 'x' })
  assert.equal(fetchImpl.calls.length, 4)
})

test('the cache can be switched off, cleared, and reports its size', async () => {
  const fetchImpl = countingFetch([{ status: 200, body: {} }, { status: 200, body: {} }, { status: 200, body: {} }])
  const client = createGitHubClient({ token: 't', fetchImpl, cacheTtlMs: 0 })
  await client.get('/a')
  await client.get('/a')
  assert.equal(fetchImpl.calls.length, 2, 'ttl 0 disables the cache')
  assert.deepEqual(client.cacheStats(), { size: 0, ttlMs: 0 })

  const cached = createGitHubClient({ token: 't', fetchImpl, cacheTtlMs: 60000 })
  await cached.get('/a')
  assert.equal(cached.cacheStats().size, 1)
  cached.cacheClear()
  assert.equal(cached.cacheStats().size, 0)
})

test('an expired entry is refetched', async () => {
  const fetchImpl = countingFetch([{ status: 200, body: { v: 1 } }, { status: 200, body: { v: 2 } }])
  const client = createGitHubClient({ token: 't', fetchImpl, cacheTtlMs: 1 })
  await client.get('/x')
  await new Promise((resolve) => setTimeout(resolve, 5))
  const again = await client.get('/x')
  assert.equal(again.data.v, 2)
  assert.equal(fetchImpl.calls.length, 2)
})

// ------------------------------------------------------------------- signal

// Deterministic on purpose: the signal is aborted before the call, so there is no timer
// race and no retry backoff to wait through.
function abortingFetch() {
  return async (url, init) => {
    if (init.signal && init.signal.aborted) {
      const err = new Error('aborted')
      err.name = 'AbortError'
      throw err
    }
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => '{}' }
  }
}

test("the caller's signal aborts the request and is reported as a cancellation", async () => {
  const controller = new AbortController()
  controller.abort()
  const client = createGitHubClient({ token: 't', fetchImpl: abortingFetch(), maxRetries: 0 })
  await assert.rejects(
    () => client.get('/x', { signal: controller.signal }),
    (err) => {
      assert.equal(err.code, 'cancelled')
      assert.match(err.message, /cancelled by the caller/)
      assert.match(describeError(err), /the turn was cancelled/)
      return true
    },
  )
})

test('the client asks the provider for the signal, so a shared client still cancels', async () => {
  const controller = new AbortController()
  controller.abort()
  let asked = 0
  const client = createGitHubClient({
    token: 't',
    fetchImpl: abortingFetch(),
    maxRetries: 0,
    signalProvider: () => {
      asked += 1
      return controller.signal
    },
  })
  await assert.rejects(() => client.get('/x'), (err) => err.code === 'cancelled')
  assert.ok(asked > 0, 'the provider was consulted')
})

test('a timeout without a caller cancellation is still a timeout', async () => {
  const fetchImpl = (url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => {
      const err = new Error('aborted')
      err.name = 'AbortError'
      reject(err)
    })
  })
  const client = createGitHubClient({ token: 't', fetchImpl, timeoutMs: 10, maxRetries: 0 })
  await assert.rejects(() => client.get('/x'), (err) => err.code === 'timeout' && /timed out/.test(err.message))
})

// -------------------------------------------------------------- local limits

function listClient(items, key) {
  return {
    calls: [],
    get: async (path, opts) => { this?.calls; return { data: { [key]: items, total_count: items.length } } },
    paginate: async () => items,
  }
}

test('a list is cut locally even when the server ignores the page size', async () => {
  const many = Array.from({ length: 100 }, (_, i) => ({
    id: i, tag_name: `v${i}`, name: `v${i}`, draft: false, prerelease: false, assets: [],
  }))
  const client = { get: async () => ({ data: many }) }
  const releases = await listReleases(client, { owner: 'o', repo: 'r', limit: 5 })
  assert.equal(releases.count, 5)
  assert.equal(releases.releases.length, 5)

  const issueItems = Array.from({ length: 100 }, (_, i) => ({ number: i, title: `t${i}`, user: { login: 'u' } }))
  const issueClient = { get: async () => ({ data: issueItems }) }
  const issues = await listIssues(issueClient, { owner: 'o', repo: 'r', limit: 3 })
  assert.equal(issues.count, 3)

  const runItems = Array.from({ length: 100 }, (_, i) => ({ id: i, name: 'ci', workflow_runs: [] }))
  const runClient = { get: async () => ({ data: { workflow_runs: runItems, total_count: 100 } }) }
  const runs = await listRuns(runClient, { owner: 'o', repo: 'r', limit: 4 })
  assert.equal(runs.count, 4)

  const repoItems = Array.from({ length: 100 }, (_, i) => ({ full_name: `o/r${i}` }))
  const repoClient = { get: async () => ({ data: { items: repoItems, total_count: 100 } }) }
  const repos = await searchRepos(repoClient, { query: 'x', limit: 2 })
  assert.equal(repos.repos.length, 2)
})

// ----------------------------------------------------------------- hints

test('a failure says what to do next', () => {
  const at = (status) => new GitHubError('boom', { status })
  assert.match(hintFor(at(401)), /credential, the environment variable or `gh auth status`/)
  assert.match(hintFor(at(403)), /lacks the scope/)
  assert.match(hintFor(at(404)), /draft release/)
  assert.match(hintFor(at(422)), /required fields/)
  assert.match(hintFor(at(409)), /state changed/)
  assert.match(hintFor({ code: 'timeout' }), /timed out/)
  assert.match(hintFor({ code: 'network' }), /network failed/)
  assert.match(hintFor({ code: 'cancelled' }), /turn was cancelled/)
  assert.equal(hintFor(null), '')

  const limited = new GitHubError('API rate limit exceeded', {
    status: 403, code: 'rate_limited', rateLimit: { remaining: 0, resetAt: '2026-09-20T20:00:00Z' },
  })
  const described = describeError(limited)
  assert.match(described, /rate limit is spent and resets at 2026-09-20T20:00:00Z/)
})

// ------------------------------------------------------------- redaction

test('the access value never reaches an error, a hint or a rendered result', async () => {
  const secret = 'ghp_ThisIsTheFakeTokenValue1234567890'
  const fetchImpl = countingFetch([{ status: 401, body: { message: 'Bad credentials' } }])
  const client = createGitHubClient({ token: secret, fetchImpl, cacheTtlMs: 0 })
  let failure = null
  try {
    await client.get('/user')
  } catch (err) {
    failure = err
  }
  assert.ok(failure, 'the call failed as expected')
  const rendered = `${failure.message} ${describeError(failure)} ${JSON.stringify(failure.details || {})} ${JSON.stringify(failure.rateLimit || {})}`
  assert.ok(!rendered.includes(secret), 'the value is not in the failure')
  assert.ok(!rendered.includes('ThisIsTheFake'), 'no fragment of the value is there either')
})
