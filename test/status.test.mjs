import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { isTrustedRequest, statusPayload, sendJson } from '../lib/status.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const routes = fs.readFileSync(path.join(here, '..', 'lib', 'routes.js'), 'utf8')
const clientSource = fs.readFileSync(path.join(here, '..', 'lib', 'client.js'), 'utf8')

const request = ({ address = '127.0.0.1', headers = {} } = {}) => ({
  method: 'GET',
  socket: { remoteAddress: address },
  headers,
})

test('only a local or same-origin caller may read the status', () => {
  assert.equal(isTrustedRequest(request()), true)
  assert.equal(isTrustedRequest(request({ address: '::1' })), true)
  assert.equal(isTrustedRequest(request({ address: '::ffff:127.0.0.1' })), true)

  assert.equal(isTrustedRequest(request({ address: '192.168.1.50' })), false, 'a remote address without an origin is refused')
  assert.equal(
    isTrustedRequest(request({ address: '192.168.1.50', headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' } })),
    true,
    'a same-origin caller is allowed',
  )
  assert.equal(
    isTrustedRequest(request({ address: '192.168.1.50', headers: { host: '127.0.0.1:3080', origin: 'http://evil.example' } })),
    false,
    'a foreign origin is refused',
  )
  assert.equal(isTrustedRequest(request({ address: '192.168.1.50', headers: { origin: 'not a url' } })), false)
  assert.equal(isTrustedRequest(null), false)
})

test('the payload carries what the card shows and never a value', () => {
  const payload = statusPayload({
    access: { value: 'ghp_secret_value', source: 'gh' },
    identity: { login: 'octocat', name: 'The Octocat' },
    rateLimit: { limit: 5000, remaining: 4999, resetAt: '2026-09-21T15:00:00Z' },
    scopes: 'repo, workflow',
    cache: { size: 3, ttlMs: 60000 },
  })
  assert.equal(payload.configured, true)
  assert.equal(payload.source, 'gh')
  assert.equal(payload.login, 'octocat')
  assert.equal(payload.scopes, 'repo, workflow')
  assert.equal(payload.rateLimit.remaining, 4999)
  assert.deepEqual(payload.cache, { size: 3, ttlMs: 60000 })
  assert.ok(!JSON.stringify(payload).includes('ghp_secret_value'), 'the access value is not in the payload')
})

test('an unconfigured payload explains itself instead of showing an empty account', () => {
  const payload = statusPayload({ access: { value: '', source: '', guidance: 'Configure one of: …' } })
  assert.equal(payload.configured, false)
  assert.equal(payload.login, '')
  assert.equal(payload.rateLimit, null)
  assert.match(payload.guidance, /Configure one of/)
})

test('a failed identity call keeps the error, truncated', () => {
  const payload = statusPayload({ access: { value: 'x', source: 'credentials' }, error: 'x'.repeat(500) })
  assert.equal(payload.configured, true)
  assert.equal(payload.error.length, 200)
})

test('sendJson writes JSON, forbids caching and survives a dead client', () => {
  const written = []
  const res = { writeHead: (code, headers) => written.push({ code, headers }), end: (body) => written.push({ body }) }
  sendJson(res, 200, { ok: true })
  assert.equal(written[0].code, 200)
  assert.equal(written[0].headers['Cache-Control'], 'no-store')
  assert.equal(written[1].body, '{"ok":true}')

  const broken = { writeHead: () => { throw new Error('client gone') } }
  assert.doesNotThrow(() => sendJson(broken, 200, {}))
})

test('the host registers the route behind the trust check, and the card reads it', () => {
  assert.match(routes, /path: STATUS_PATH/)
  assert.match(routes, /if \(!isTrustedRequest\(req\)\) return sendJson\(res, 403/)
  assert.match(routes, /req\.method !== 'GET'/)
  assert.match(routes, /statusPayload\(\{/)
  assert.match(clientSource, /const STATUS_PATH = '\/dsh-github-ops\/status'/)
  assert.match(clientSource, /fetch\(STATUS_PATH, \{ headers: \{ accept: 'application\/json' \} \}\)/)
  assert.match(clientSource, /className: 'gho-status'/)
})
