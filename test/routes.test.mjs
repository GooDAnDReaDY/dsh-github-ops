import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'

import { registerRoutes, STATUS_PATH, SCM_PATH, PANEL_PATH, MIRROR_PATH, MATRIX_PATH, GRAPH_PATH, EVENTS_PATH } from '../lib/routes.js'

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


test('MATRIX_PATH and PANEL_PATH what=matrix answer matrix data for trusted caller', async () => {
  const { ctx, routes } = createHarness()
  const fakeClient = {
    get: async (path) => {
      if (path.startsWith('/orgs/myorg/repos')) {
        return { data: [{ name: 'proj1', full_name: 'myorg/proj1', owner: { login: 'myorg' } }] }
      }
      if (path.includes('releases/latest')) {
        return { data: { tag_name: 'v1.0.0', published_at: '2026-01-01' } }
      }
      return { data: [] }
    },
  }
  registerRoutes(ctx, {
    resolveToken: async () => ({ value: 'ghp_fake', source: 'test' }),
    client: async () => fakeClient,
    liveConfig: () => ({ owner: 'myorg' }),
  })

  // Test MATRIX_PATH
  const res1 = mockResponse()
  await routes.get(MATRIX_PATH)({
    method: 'GET',
    url: `${MATRIX_PATH}?org=myorg`,
    socket: { remoteAddress: '127.0.0.1' },
    headers: {},
  }, res1)
  assert.equal(res1.result().status, 200)
  assert.equal(res1.result().json.ok, true)
  assert.equal(res1.result().json.org, 'myorg')
  assert.equal(res1.result().json.totalRepos, 1)

  // Test PANEL_PATH?what=matrix
  const res2 = mockResponse()
  await routes.get(PANEL_PATH)({
    method: 'GET',
    url: `${PANEL_PATH}?what=matrix&org=myorg`,
    socket: { remoteAddress: '127.0.0.1' },
    headers: {},
  }, res2)
  assert.equal(res2.result().status, 200)
  assert.equal(res2.result().json.configured, true)
  assert.equal(res2.result().json.org, 'myorg')
})


test('SCM_PATH detects file conflicts on GET and resolves them via resolveConflict POST', async () => {
  const fs = await import('node:fs/promises')
  const os = await import('node:os')
  const path = await import('node:path')

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-scm-route-'))
  const conflictFile = path.join(tmpDir, 'conflict.txt')
  await fs.writeFile(conflictFile, 'h\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> inc\nf', 'utf8')

  const { ctx, routes } = createHarness()
  const executed = []
  registerRoutes(ctx, {
    makeGitRunner: () => async (argv, opts) => {
      executed.push({ argv, opts })
      return { code: 0, stdout: 'diff output', stderr: '' }
    },
  })

  // 1. GET with file parameter detects conflicts
  const getRes = mockResponse()
  await routes.get(SCM_PATH)({
    method: 'GET',
    url: `${SCM_PATH}?file=conflict.txt&cwd=${encodeURIComponent(tmpDir)}`,
    socket: { remoteAddress: '127.0.0.1' },
    headers: {},
  }, getRes)

  assert.equal(getRes.result().status, 200)
  assert.equal(getRes.result().json.hasConflicts, true)
  assert.equal(getRes.result().json.conflicts.length, 1)
  assert.equal(getRes.result().json.conflicts[0].ours, 'ours')

  // 2. POST resolveConflict resolves file and runs git add
  const postReq = Readable.from([Buffer.from(JSON.stringify({
    action: 'resolveConflict',
    path: 'conflict.txt',
    choice: 'theirs',
    cwd: tmpDir,
  }))])
  postReq.method = 'POST'
  postReq.url = `${SCM_PATH}?cwd=${encodeURIComponent(tmpDir)}`
  postReq.socket = { remoteAddress: '127.0.0.1' }
  postReq.headers = { 'sec-fetch-site': 'same-origin' }

  const postRes = mockResponse()
  await routes.get(SCM_PATH)(postReq, postRes)

  assert.equal(postRes.result().status, 200)
  assert.equal(postRes.result().json.ok, true)
  assert.equal(postRes.result().json.action, 'resolveConflict')

  // File on disk was resolved
  const resolvedContent = await fs.readFile(conflictFile, 'utf8')
  assert.equal(resolvedContent, 'h\ntheirs\nf')

  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
})

test('GRAPH_PATH returns git commit graph data for trusted caller', async () => {
  const { ctx, routes } = createHarness()
  registerRoutes(ctx, {
    makeGitRunner: () => async (args) => {
      if (args.includes('--graph')) {
        return {
          code: 0,
          stdout: '* 1234567| (HEAD -> main)|test commit|alice|2026-10-07\n',
          stderr: '',
        }
      }
      return { code: 0, stdout: '' }
    },
  })

  const res = mockResponse()
  await routes.get(GRAPH_PATH)({
    method: 'GET',
    url: `${GRAPH_PATH}?limit=10`,
    socket: { remoteAddress: '127.0.0.1' },
    headers: {},
  }, res)

  assert.equal(res.result().status, 200)
  assert.equal(res.result().json.ok, true)
  assert.equal(res.result().json.limit, 10)
  assert.equal(res.result().json.entries.length, 1)
  assert.equal(res.result().json.entries[0].hash, '1234567')
  assert.equal(res.result().json.entries[0].subject, 'test commit')
})

test('SCM_PATH GET returns hunks for file diff and POST stage_patch passes input to git', async () => {
  const { ctx, routes } = createHarness()
  let capturedInput = null
  let capturedArgv = null
  registerRoutes(ctx, {
    makeGitRunner: () => async (argv, opts) => {
      if (argv.includes('diff')) {
        return {
          code: 0,
          stdout: `diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1,2 +1,2 @@\n-old\n+new\n`,
          stderr: '',
        }
      }
      if (argv.includes('apply')) {
        capturedArgv = argv
        capturedInput = opts?.input
        return { code: 0, stdout: '', stderr: '' }
      }
      return { code: 0, stdout: '', stderr: '' }
    },
  })

  // 1. GET file diff returns hunks
  const getRes = mockResponse()
  await routes.get(SCM_PATH)({
    method: 'GET',
    url: `${SCM_PATH}?file=a.txt`,
    socket: { remoteAddress: '127.0.0.1' },
    headers: {},
  }, getRes)

  assert.equal(getRes.result().status, 200)
  assert.equal(getRes.result().json.hunks.length, 1)
  assert.match(getRes.result().json.hunks[0].patch, /\+new/)

  // 2. POST stage_patch passes patch string to git stdin
  const patchContent = getRes.result().json.hunks[0].patch
  const postReq = Readable.from([Buffer.from(JSON.stringify({
    action: 'stage_patch',
    args: { patch: patchContent },
  }))])
  postReq.method = 'POST'
  postReq.url = SCM_PATH
  postReq.socket = { remoteAddress: '127.0.0.1' }
  postReq.headers = { 'sec-fetch-site': 'same-origin' }

  const postRes = mockResponse()
  await routes.get(SCM_PATH)(postReq, postRes)

  assert.equal(postRes.result().status, 200)
  assert.equal(postRes.result().json.ok, true)
  assert.deepEqual(capturedArgv, ['apply', '--cached', '-'])
  assert.equal(capturedInput, patchContent)
})
