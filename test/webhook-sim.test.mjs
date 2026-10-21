import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildCanonicalWebhookPayload,
  simulateWebhook,
} from '../lib/tools/webhook-sim.js'

test('buildCanonicalWebhookPayload generates valid structure for various events', () => {
  for (const ev of ['issues', 'pull_request', 'workflow_run', 'release', 'deployment', 'deployment_status', 'push']) {
    const { deliveryId, timestamp, payload } = buildCanonicalWebhookPayload({
      event: ev,
      action: 'opened',
      owner: 'goodandready',
      repo: 'dsh-github-ops',
    })
    assert.ok(deliveryId, `deliveryId must exist for ${ev}`)
    assert.ok(timestamp, `timestamp must exist for ${ev}`)
    assert.equal(payload.repository.full_name, 'goodandready/dsh-github-ops')
    assert.ok(payload.sender.login)
  }
})

test('simulateWebhook broadcasts to eventManager and delivers to targetUrl', async () => {
  const broadcastCalls = []
  const mockEventManager = {
    clientCount: 2,
    broadcast: (event, data) => {
      broadcastCalls.push({ event, data })
    },
  }

  let fetchCalled = false
  let capturedHeaders = null
  let capturedBody = null
  const mockFetch = async (url, opts) => {
    fetchCalled = true
    capturedHeaders = opts.headers
    capturedBody = JSON.parse(opts.body)
    return { ok: true, status: 200 }
  }

  const res = await simulateWebhook({
    event: 'pull_request',
    action: 'opened',
    owner: 'goodandready',
    repo: 'dsh-github-ops',
    broadcast: true,
    targetUrl: 'http://127.0.0.1:3000/webhook',
    eventManager: mockEventManager,
    fetchFn: mockFetch,
  })

  assert.equal(res.simulated, true)
  assert.equal(res.event, 'pull_request')
  assert.equal(res.action, 'opened')
  assert.equal(res.broadcasted, true)
  assert.equal(res.broadcastClients, 2)
  assert.equal(res.delivered, true)
  assert.equal(res.targetStatus, 200)

  // Verify broadcast calls
  assert.equal(broadcastCalls.length, 2)
  assert.equal(broadcastCalls[0].event, 'webhook')
  assert.equal(broadcastCalls[1].event, 'pull_request')

  // Verify fetch headers
  assert.equal(capturedHeaders['X-GitHub-Event'], 'pull_request')
  assert.ok(capturedHeaders['X-GitHub-Delivery'])
  assert.equal(capturedBody.repository.full_name, 'goodandready/dsh-github-ops')
})
