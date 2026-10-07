import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { SseEventManager } from '../lib/events.js'

function createMockResponse() {
  const chunks = []
  const res = new EventEmitter()
  res.written = chunks
  res.write = (chunk) => {
    chunks.push(String(chunk))
    return true
  }
  res.end = () => {
    res.emit('finish')
  }
  return res
}

function createMockRequest() {
  return new EventEmitter()
}

test('SseEventManager manages client lifecycle and greeting', () => {
  const manager = new SseEventManager()
  assert.equal(manager.clientCount, 0)

  const res1 = createMockResponse()
  const req1 = createMockRequest()

  manager.addClient(res1, req1)
  assert.equal(manager.clientCount, 1)

  // Verify initial greeting
  const joined = res1.written.join('')
  assert.match(joined, /: connected/)
  assert.match(joined, /"type":"connected"/)

  // Broadcast event
  manager.broadcast('test_event', { hello: 'world' })
  assert.match(res1.written.join(''), /event: test_event/)
  assert.match(res1.written.join(''), /"hello":"world"/)

  // Add second client
  const res2 = createMockResponse()
  const req2 = createMockRequest()
  manager.addClient(res2, req2)
  assert.equal(manager.clientCount, 2)

  // Disconnect client 1
  req1.emit('close')
  assert.equal(manager.clientCount, 1)

  // Disconnect client 2
  req2.emit('close')
  assert.equal(manager.clientCount, 0)
  assert.equal(manager.timer, null) // Timer cleared to conserve rate-limits

  manager.destroy()
})

test('SseEventManager detects CI run transitions and emits ci_status', async () => {
  let runsState = [
    { id: 101, name: 'Build', status: 'in_progress', conclusion: null, html_url: 'http://ci/101' },
  ]
  const mockGithub = {
    get: async (path) => {
      if (path.includes('/actions/runs')) {
        return { data: { workflow_runs: runsState } }
      }
      return { data: [] }
    },
  }

  const manager = new SseEventManager({
    client: async () => mockGithub,
    liveConfig: () => ({ owner: 'org', repo: 'app' }),
    activeIntervalMs: 100,
    baseIntervalMs: 200,
  })

  const res = createMockResponse()
  const req = createMockRequest()
  manager.addClient(res, req)

  // Initial poll: records current state
  await manager.poll()
  assert.equal(manager.hasActiveWork, true) // in_progress run detected

  // State changes to completed success
  runsState = [
    { id: 101, name: 'Build', status: 'completed', conclusion: 'success', html_url: 'http://ci/101' },
  ]
  await manager.poll()

  const allWritten = res.written.join('')
  assert.match(allWritten, /event: ci_status/)
  assert.match(allWritten, /"conclusion":"success"/)
  assert.match(allWritten, /"status":"completed"/)

  manager.destroy()
  assert.equal(manager.clientCount, 0)
})

test('SseEventManager detects PR changes and emits pr_status', async () => {
  let pullsState = [
    { number: 42, title: 'Initial PR', state: 'open', updated_at: '2026-10-01T00:00:00Z', user: { login: 'alice' }, pull_request: {} },
  ]
  const mockGithub = {
    get: async (path) => {
      if (path.includes('/actions/runs')) return { data: { workflow_runs: [] } }
      if (path.includes('/issues')) return { data: pullsState }
      return { data: [] }
    },
  }

  const manager = new SseEventManager({
    client: async () => mockGithub,
    liveConfig: () => ({ owner: 'org', repo: 'app' }),
  })

  const res = createMockResponse()
  const req = createMockRequest()
  manager.addClient(res, req)

  await manager.poll()

  // PR is updated
  pullsState = [
    { number: 42, title: 'Updated PR', state: 'open', updated_at: '2026-10-01T12:00:00Z', user: { login: 'alice' }, pull_request: {} },
  ]
  await manager.poll()

  const allWritten = res.written.join('')
  assert.match(allWritten, /event: pr_status/)
  assert.match(allWritten, /"number":42/)
  assert.match(allWritten, /"title":"Updated PR"/)

  manager.destroy()
})
