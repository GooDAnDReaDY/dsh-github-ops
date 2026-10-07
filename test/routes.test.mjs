import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'

import { registerRoutes, STATUS_PATH, SCM_PATH, PANEL_PATH, MIRROR_PATH } from '../lib/routes.js'

function createHarness() {
  const routes = new Map()
  const wctx = {
    webServer: {
      register: (opts) => {
        routes.set(opts.path, opts.handler)
      },
    },
    effect: (fn) => fn(),
  }
  const ctx = {
    inject: (deps, fn) => {
      if (deps.includes('webServer')) fn(wctx)
    },
    logger: { warn: () => {} },
  }
  return { ctx, routes }
}

function mockResponse() {
  let status = null
  let headers = null
  let body = ''
  return {
    writeHead: (s, h) => { status = s; headers = h },
    end: (d) => { body = d || '' },
    result: () => ({ status, headers, json: body ? JSON.parse(body) : null }),
  }
}

test('registerRoutes binds dependencies and handles 405 on unsupported methods', async () => {
  const { ctx, routes } = createHarness()
  registerRoutes(ctx, {
    resolveToken: async () => ({ value: 'test-token', source: 'test' }),
    client: async () => ({
      get: async (path) => {
        if (path === '/user') return { data: { login: 'octocat', name: 'Mona' }, rateLimit: { limit: 5000, remaining: 4999 } }
        return { data: {} }
      },
      lastScopes: () => 'repo, user',
    }),
    liveConfig: () => ({ interceptLinks: false }),
    describeError: (e) => String(e),
    makeGitRunner: () => () => ({ code: 0, stdout: 'main' }),
    cacheStats: () => ({ size: 5, ttlMs: 60000 }),
  })

  assert.ok(routes.has(STATUS_PATH))
  assert.ok(routes.has(SCM_PATH))
  assert.ok(routes.has(PANEL_PATH))
  assert.ok(routes.has(MIRROR_PATH))

  const res = mockResponse()
  await routes.get(STATUS_PATH)({ method: 'POST' }, res)
  assert.equal(res.result().status, 405)
})

test('STATUS_PATH answers statusPayload for trusted request without throwing', async () => {
  const { ctx, routes } = createHarness()
  registerRoutes(ctx, {
    resolveToken: async () => ({ value: 'test-token', source: 'test' }),
    client: async () => ({
      get: async () => ({ data: { login: 'octocat', name: 'Mona' }, rateLimit: { limit: 5000, remaining: 4999, resetAt: '2026-01-01' } }),
      lastScopes: () => 'repo',
    }),
    liveConfig: () => ({ interceptLinks: true }),
    describeError: (e) => String(e),
    cacheStats: () => ({ size: 3, ttlMs: 1000 }),
  })

  const res = mockResponse()
  await routes.get(STATUS_PATH)({
    method: 'GET',
    url: STATUS_PATH,
    socket: { remoteAddress: '127.0.0.1' },
    headers: {},
  }, res)

  const payload = res.result().json
  assert.equal(res.result().status, 200)
  assert.equal(payload.configured, true)
  assert.equal(payload.login, 'octocat')
  assert.equal(payload.source, 'test')
  assert.equal(payload.scopes, 'repo')
  assert.equal(payload.cache?.size, 3)
})

test('SCM_PATH reads cwd parameter from url without ReferenceError', async () => {
  const { ctx, routes } = createHarness()
  registerRoutes(ctx, {
    makeGitRunner: () => async (args) => {
      if (args.includes('status')) return { code: 0, stdout: '' }
      if (args.includes('--show-current')) return { code: 0, stdout: 'main' }
      if (args.includes('branch')) return { code: 0, stdout: 'main\t*' }
      return { code: 0, stdout: '' }
    },
  })

  const res = mockResponse()
  await routes.get(SCM_PATH)({
    method: 'GET',
    url: `${SCM_PATH}?cwd=/tmp`,
    socket: { remoteAddress: '127.0.0.1' },
    headers: {},
  }, res)

  assert.equal(res.result().status, 200)
  assert.equal(res.result().json.cwd, '/tmp')
})

test('SCM write route passes timeoutMs to git runner', async () => {
  const { ctx, routes } = createHarness()
  const calls = []
  registerRoutes(ctx, {
    makeGitRunner: () => async (args, opts) => {
      calls.push({ args, opts })
      return { code: 0, stdout: '', stderr: '' }
    },
  })

  const res = mockResponse()
  const req = Readable.from([Buffer.from(JSON.stringify({ action: 'push', args: {} }))])
  req.method = 'POST'
  req.url = SCM_PATH
  req.socket = { remoteAddress: '127.0.0.1' }
  req.headers = { host: 'localhost:3080' }

  await routes.get(SCM_PATH)(req, res)

  assert.equal(res.result().status, 200)
  assert.equal(calls[0].opts.timeoutMs, 120000)
})

test('SCM write route rejects cross-site requests with 403', async () => {
  const { ctx, routes } = createHarness()
  registerRoutes(ctx, {
    makeGitRunner: () => async () => ({ code: 0, stdout: '', stderr: '' }),
  })

  const res = mockResponse()
  const req = Readable.from([Buffer.from(JSON.stringify({ action: 'push', args: {} }))])
  req.method = 'POST'
  req.url = SCM_PATH
  req.socket = { remoteAddress: '127.0.0.1' }
  req.headers = { host: 'localhost:3080', 'sec-fetch-site': 'cross-site' }

  await routes.get(SCM_PATH)(req, res)
  assert.equal(res.result().status, 403)
})

test('SCM_PATH returns diff for stash parameter', async () => {
  const { ctx, routes } = createHarness()
  const calls = []
  registerRoutes(ctx, {
    makeGitRunner: () => async (args) => {
      calls.push(args)
      if (args[0] === 'stash' && args[1] === 'show') {
        return { code: 0, stdout: 'diff --git a/foo.txt b/foo.txt\n+stash content' }
      }
      return { code: 0, stdout: '' }
    },
  })

  const res = mockResponse()
  await routes.get(SCM_PATH)({
    method: 'GET',
    url: `${SCM_PATH}?stash=stash@{0}`,
    socket: { remoteAddress: '127.0.0.1' },
    headers: {},
  }, res)

  assert.equal(res.result().status, 200)
  assert.equal(res.result().json.stash, 'stash@{0}')
  assert.match(res.result().json.diff, /diff --git/)
  assert.deepEqual(calls[0], ['stash', 'show', '-p', 'stash@{0}'])

  const badRes = mockResponse()
  await routes.get(SCM_PATH)({
    method: 'GET',
    url: `${SCM_PATH}?stash=bad_ref`,
    socket: { remoteAddress: '127.0.0.1' },
    headers: {},
  }, badRes)
  assert.equal(badRes.result().status, 400)
})

test('SCM_PATH survives cordis context throwing on undeclared cwd access', async () => {
  const { ctx, routes } = createHarness()
  // Mock cordis throwing on ctx.cwd
  Object.defineProperty(ctx, 'cwd', {
    get() {
      throw new Error('cannot get property "cwd" without inject')
    },
    configurable: true,
  })

  registerRoutes(ctx, {
    makeGitRunner: () => async () => ({ code: 1, stdout: '', stderr: 'not a git repo' }),
  })

  const res = mockResponse()
  await routes.get(SCM_PATH)({
    method: 'GET',
    url: SCM_PATH,
    socket: { remoteAddress: '127.0.0.1' },
    headers: {},
  }, res)

  assert.equal(res.result().status, 200)
  assert.equal(res.result().json.isRepository, false)
})
