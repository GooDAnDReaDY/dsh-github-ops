import test from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  startDeviceFlow,
  pollDeviceFlow,
  writeAccessFile,
  readAccessFile,
  clearAccessFile,
  accessFilePath,
  DEFAULT_CLIENT_ID,
} from '../lib/auth-device.js'

/** Fetch double answering the two device-flow endpoints from a queue. */
function deviceFetch({ code = {}, polls = [] } = {}) {
  const calls = []
  const queue = [...polls]
  const impl = async (url, init = {}) => {
    calls.push({ url, body: init.body ? JSON.parse(init.body) : null })
    const isCode = url.includes('/login/device/code')
    const payload = isCode ? code : (queue.shift() || {})
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(payload),
    }
  }
  impl.calls = calls
  return impl
}

test('startDeviceFlow asks for a code and returns what the human needs', async () => {
  const fetchImpl = deviceFetch({
    code: { device_code: 'dev-1', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 },
  })
  const flow = await startDeviceFlow({ fetchImpl })
  assert.equal(flow.deviceCode, 'dev-1')
  assert.equal(flow.userCode, 'ABCD-1234')
  assert.equal(flow.verificationUri, 'https://github.com/login/device')
  assert.equal(flow.intervalSeconds, 5)
  assert.equal(flow.expiresInSeconds, 900)
  const body = fetchImpl.calls[0].body
  assert.equal(body.client_id, DEFAULT_CLIENT_ID)
  assert.match(body.scope, /repo/)
})

test('startDeviceFlow refuses an answer without a code', async () => {
  await assert.rejects(() => startDeviceFlow({ fetchImpl: deviceFetch({ code: {} }) }), /did not return a device code/)
})

test('pollDeviceFlow waits through pending and returns the value once approved', async () => {
  const slept = []
  const fetchImpl = deviceFetch({
    polls: [
      { error: 'authorization_pending' },
      { error: 'authorization_pending' },
      { access_token: 'gho_value', scope: 'repo' },
    ],
  })
  const result = await pollDeviceFlow({
    deviceCode: 'dev-1', fetchImpl, intervalSeconds: 1, maxWaitMs: 60000,
    sleepImpl: async (ms) => { slept.push(ms) },
  })
  assert.equal(result.status, 'authorized')
  assert.equal(result.token, 'gho_value')
  assert.equal(result.scope, 'repo')
  assert.equal(slept.length, 2, 'one wait per pending answer')
})

test('pollDeviceFlow backs off on slow_down and reports expiry and denial', async () => {
  const slept = []
  const slow = await pollDeviceFlow({
    deviceCode: 'dev', fetchImpl: deviceFetch({ polls: [{ error: 'slow_down' }, { access_token: 'x' }] }),
    intervalSeconds: 1, maxWaitMs: 60000, sleepImpl: async (ms) => { slept.push(ms) },
  })
  assert.equal(slow.status, 'authorized')
  assert.deepEqual(slept, [6000], 'slow_down adds five seconds')

  const expired = await pollDeviceFlow({ deviceCode: 'dev', fetchImpl: deviceFetch({ polls: [{ error: 'expired_token' }] }), sleepImpl: async () => {} })
  assert.equal(expired.status, 'expired')
  assert.match(expired.message, /expired/)

  const denied = await pollDeviceFlow({ deviceCode: 'dev', fetchImpl: deviceFetch({ polls: [{ error: 'access_denied' }] }), sleepImpl: async () => {} })
  assert.equal(denied.status, 'denied')
})

test('pollDeviceFlow gives up inside its budget instead of hanging', async () => {
  // always pending: the loop must stop on its own budget, not because GitHub changed answer
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ error: 'authorization_pending' }) })
  const result = await pollDeviceFlow({
    deviceCode: 'dev',
    fetchImpl,
    intervalSeconds: 5,
    maxWaitMs: 1,
    sleepImpl: async () => {},
  })
  assert.equal(result.status, 'pending')
  assert.match(result.message, /again to keep polling/)
})

test('a transport failure while polling is reported, not swallowed', async () => {
  const fetchImpl = async () => { throw new Error('network down') }
  const result = await pollDeviceFlow({ deviceCode: 'dev', fetchImpl, sleepImpl: async () => {} })
  assert.equal(result.status, 'denied')
  assert.match(result.message, /network down/)
})

test('the access file is written 0600, read back, and cleared', async () => {
  const dir = await fs.mkdtemp(join(tmpdir(), 'dsh-gh-ops-'))
  const path = join(dir, 'github-ops-auth.json')
  assert.equal(await readAccessFile(path), null, 'nothing stored yet')

  const saved = await writeAccessFile(path, { token: 'gho_secret_value', login: 'octocat', scope: 'repo' })
  assert.equal(saved.login, 'octocat')

  const stat = await fs.stat(path)
  assert.equal(stat.mode & 0o777, 0o600, 'the file is not group or world readable')

  const back = await readAccessFile(path)
  assert.equal(back.token, 'gho_secret_value')
  assert.equal(back.source, 'device-flow')

  const cleared = await clearAccessFile(path)
  assert.equal(cleared.removed, true)
  assert.equal(await readAccessFile(path), null, 'clearing is idempotent for the reader')
})

test('accessFilePath follows DSH_HOME', () => {
  assert.equal(accessFilePath({ DSH_HOME: '/tmp/dsh-home' }), '/tmp/dsh-home/github-ops-auth.json')
  assert.match(accessFilePath({}), /\.dsh\/github-ops-auth\.json$/)
})

test('a stored file never appears in a tool result by accident', async () => {
  const dir = await fs.mkdtemp(join(tmpdir(), 'dsh-gh-ops-'))
  const path = join(dir, 'auth.json')
  await writeAccessFile(path, { token: 'gho_top_secret', login: 'octocat' })
  const raw = await fs.readFile(path, 'utf8')
  assert.ok(raw.includes('gho_top_secret'), 'the value is on disk for the client to use')
  const saved = await writeAccessFile(join(dir, 'auth2.json'), { token: 'gho_top_secret', login: 'octocat' })
  assert.deepEqual(Object.keys(saved).sort(), ['login', 'path', 'scope'], 'the result carries no value')
})
