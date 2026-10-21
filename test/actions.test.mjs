import test from 'node:test'
import assert from 'node:assert/strict'

import {
  parseFoldedLog,
  diagnoseRun,
} from '../lib/tools/actions.js'
import { registerRoutes, PANEL_PATH } from '../lib/routes.js'

function clientDouble(routes) {
  const calls = []
  return {
    calls,
    get: async (path, opts) => {
      calls.push({ method: 'GET', path, opts })
      for (const [pattern, handler] of routes) {
        if (typeof pattern === 'string' ? path.startsWith(pattern) : pattern.test(path)) {
          if (typeof handler === 'function') return handler(path, opts)
          return { data: handler }
        }
      }
      return { data: null }
    },
    getRaw: async (path) => {
      calls.push({ method: 'GET_RAW', path })
      for (const [pattern, handler] of routes) {
        if (typeof pattern === 'string' ? path.startsWith(pattern) : pattern.test(path)) {
          if (typeof handler === 'function') return handler(path)
          return handler
        }
      }
      return ''
    },
  }
}

test('parseFoldedLog parses GitHub Actions log groups, strips ANSI and redacts secrets', () => {
  const rawLog = [
    '2026-10-21T10:00:00.0000000Z ##[group]Run actions/checkout@v4',
    '2026-10-21T10:00:01.0000000Z Syncing repository with token ghp_11112222333344445555666677778888',
    '2026-10-21T10:00:02.0000000Z \u001b[32mSuccessfully checked out commit abcdef1\u001b[0m',
    '2026-10-21T10:00:03.0000000Z ##[endgroup]',
    '2026-10-21T10:00:04.0000000Z ##[group]Run npm test',
    '2026-10-21T10:00:05.0000000Z \u001b[31;1mnpm ERR! Test failed with exit code 1\u001b[0m',
    '2026-10-21T10:00:06.0000000Z ##[error]Process completed with exit code 1.',
    '2026-10-21T10:00:07.0000000Z Authorization: Bearer gho_99998888777766665555444433332222',
    '2026-10-21T10:00:08.0000000Z ##[endgroup]',
  ].join('\n')

  const parsed = parseFoldedLog(rawLog)
  assert.equal(parsed.steps.length, 2)

  // Step 1: Checkout
  const step1 = parsed.steps[0]
  assert.equal(step1.name, 'Run actions/checkout@v4')
  assert.equal(step1.hasError, false)
  assert.ok(!step1.lines[0].includes('ghp_11112222333344445555666677778888'))
  assert.ok(step1.lines[0].includes('[REDACTED_TOKEN]'))
  assert.ok(!step1.lines[1].includes('\u001b'))
  assert.equal(step1.lines[1], 'Successfully checked out commit abcdef1')

  // Step 2: Test (failed)
  const step2 = parsed.steps[1]
  assert.equal(step2.name, 'Run npm test')
  assert.equal(step2.hasError, true)
  assert.ok(!step2.lines[0].includes('\u001b'))
  assert.equal(step2.lines[0], 'npm ERR! Test failed with exit code 1')
  assert.ok(step2.errorHighlights.length >= 2)
  assert.ok(!step2.lines[2].includes('gho_99998888777766665555444433332222'))
  assert.ok(step2.lines[2].includes('[REDACTED_TOKEN]'))

  // failedStep reference
  assert.ok(parsed.failedStep)
  assert.equal(parsed.failedStep.name, 'Run npm test')
  assert.equal(parsed.failedStep.hasError, true)
})

test('diagnoseRun fetches failing job logs and compiles structured failure summary', async () => {
  const rawLog = [
    '##[group]Setup Node.js',
    'Node v20.10.0',
    '##[endgroup]',
    '##[group]Run test suite',
    'FAIL test/foo.test.js',
    'Error: assertion failed: expected 1 to equal 2',
    '##[error]Process exited with 1',
    '##[endgroup]',
  ].join('\n')

  const client = clientDouble([
    ['/repos/owner/repo/actions/runs/123/jobs', {
      jobs: [
        {
          id: 501,
          name: 'lint',
          status: 'completed',
          conclusion: 'success',
          steps: [{ number: 1, name: 'Lint', conclusion: 'success' }],
        },
        {
          id: 502,
          name: 'test',
          status: 'completed',
          conclusion: 'failure',
          steps: [{ number: 2, name: 'Run test suite', conclusion: 'failure' }],
          failedSteps: [{ number: 2, name: 'Run test suite', conclusion: 'failure' }],
        },
      ],
    }],
    ['/repos/owner/repo/actions/jobs/502/logs', rawLog],
  ])

  const res = await diagnoseRun(client, { owner: 'owner', repo: 'repo', runId: 123 })
  assert.equal(res.runId, 123)
  assert.equal(res.jobId, 502)
  assert.equal(res.jobName, 'test')
  assert.equal(res.steps.length, 2)
  assert.equal(res.failedStep.name, 'Run test suite')
  assert.ok(res.summary.includes('Failed in job "test" at step "Run test suite"'))
  assert.ok(res.summary.includes('assertion failed'))
})

test('diagnoseRun handles log fetch failure gracefully', async () => {
  const client = clientDouble([
    ['/repos/owner/repo/actions/runs/123/jobs', {
      jobs: [
        { id: 999, name: 'build', status: 'completed', conclusion: 'failure' },
      ],
    }],
    ['/repos/owner/repo/actions/jobs/999/logs', () => {
      const err = new Error('Logs expired')
      err.status = 410
      throw err
    }],
  ])

  const res = await diagnoseRun(client, { owner: 'owner', repo: 'repo', runId: 123 })
  assert.equal(res.jobId, 999)
  assert.ok(res.error.includes('Could not retrieve logs'))
  assert.ok(res.summary.includes('Failed to fetch logs'))
})

test('PANEL_PATH what=diagnose_run serves diagnosis data', async () => {
  const routes = new Map()
  const wctx = {
    webServer: { register: (opts) => routes.set(opts.path, opts.handler) },
    effect: (fn) => fn(),
  }
  const ctx = {
    inject: (deps, fn) => { if (deps.includes('webServer')) fn(wctx) },
    logger: { warn: () => {} },
  }

  const client = clientDouble([
    ['/repos/owner/repo/actions/runs/77/jobs', {
      jobs: [{ id: 88, name: 'build', status: 'completed', conclusion: 'failure' }],
    }],
    ['/repos/owner/repo/actions/jobs/88/logs', '##[group]Compile\n##[error]SyntaxError\n##[endgroup]'],
  ])

  registerRoutes(ctx, {
    resolveToken: async () => ({ value: 'ghp_token', source: 'test' }),
    client: async () => client,
    liveConfig: () => ({ owner: 'owner', repo: 'repo' }),
  })

  let status = null
  let body = ''
  const res = {
    writeHead: (s) => { status = s },
    end: (d) => { body = d || '' },
  }

  await routes.get(PANEL_PATH)({
    method: 'GET',
    url: `${PANEL_PATH}?what=diagnose_run&repo=owner/repo&runId=77`,
    socket: { remoteAddress: '127.0.0.1' },
    headers: {},
  }, res)

  assert.equal(status, 200)
  const json = JSON.parse(body)
  assert.equal(json.configured, true)
  assert.equal(json.runId, 77)
  assert.equal(json.jobId, 88)
  assert.equal(json.failedStep.name, 'Compile')
})