// Signing in without a terminal.
//
// GitHub's device flow: ask for a code, show it to the human, poll until they approve. The
// polling loop takes its clock and its transport as parameters, so it is testable without
// waiting a minute or touching the network.
//
// The granted value is written to this plugin's own file with mode 0600 (the DSH credentials
// service is the preferred home, but it is not writable by a plugin). The value is never
// logged, never echoed in an error, and never returned in a tool result.

import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** GitHub CLI's public OAuth application id: the one the gh CLI itself signs in with. */
export const DEFAULT_CLIENT_ID = '178c6fc778ccc68e1d6a'
export const DEFAULT_SCOPE = 'repo workflow gist read:org'

export const DEVICE_CODE_URL = 'https://github.com/login/device/code'
export const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token'

/** Where a device-flow sign-in is stored. `$DSH_HOME` wins, then `~/.dsh`. */
export function accessFilePath(env = process.env) {
  const home = env.DSH_HOME && env.DSH_HOME.trim() ? env.DSH_HOME.trim() : join(homedir(), '.dsh')
  return join(home, 'github-ops-auth.json')
}

async function postJson(fetchImpl, url, body, accept = 'application/json') {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { accept, 'content-type': 'application/json', 'user-agent': 'dsh-github-ops' },
    body: JSON.stringify(body),
  })
  const text = typeof response.text === 'function' ? await response.text() : ''
  let payload = {}
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      const params = new URLSearchParams(text)
      payload = Object.fromEntries(params.entries())
    }
  }
  if (!response.ok) {
    const message = payload.error_description || payload.error || `HTTP ${response.status}`
    const err = new Error(String(message))
    err.status = response.status
    throw err
  }
  return payload
}

/** Ask GitHub for a user code. Nothing is stored yet. */
export async function startDeviceFlow({ clientId = DEFAULT_CLIENT_ID, scope = DEFAULT_SCOPE, fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('no fetch implementation available')
  const payload = await postJson(fetchImpl, DEVICE_CODE_URL, { client_id: clientId, scope })
  if (!payload.device_code || !payload.user_code) {
    throw new Error('GitHub did not return a device code')
  }
  return {
    deviceCode: payload.device_code,
    userCode: payload.user_code,
    verificationUri: payload.verification_uri || payload.verification_uri_complete || 'https://github.com/login/device',
    expiresInSeconds: Number(payload.expires_in) || 900,
    intervalSeconds: Number(payload.interval) || 5,
    scope,
  }
}

/**
 * Poll until the human approves, the code expires, or the wait budget runs out.
 *
 * @returns {{status: 'authorized', token: string, scope: string} | {status: 'pending'|'expired'|'denied', message: string}}
 */
export async function pollDeviceFlow({
  clientId = DEFAULT_CLIENT_ID,
  deviceCode,
  clientSecret,
  fetchImpl = globalThis.fetch,
  sleepImpl,
  intervalSeconds = 5,
  maxWaitMs = 120000,
} = {}) {
  if (!deviceCode) throw new Error('deviceCode is required')
  const sleep = typeof sleepImpl === 'function'
    ? sleepImpl
    : (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  let interval = Math.max(1, Number(intervalSeconds) || 5)
  const deadline = Date.now() + Math.max(1000, Number(maxWaitMs) || 120000)

  while (Date.now() < deadline) {
    const body = { client_id: clientId, device_code: deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }
    if (clientSecret) body.client_secret = clientSecret
    let payload
    try {
      payload = await postJson(fetchImpl, ACCESS_TOKEN_URL, body)
    } catch (err) {
      // the endpoint answers 200 with an error field; a transport failure is a real failure
      return { status: 'denied', message: String((err && err.message) || err) }
    }
    if (payload.access_token) {
      return { status: 'authorized', token: String(payload.access_token), scope: String(payload.scope || '') }
    }
    const error = String(payload.error || '')
    if (error === 'authorization_pending') {
      await sleep(interval * 1000)
      continue
    }
    if (error === 'slow_down') {
      interval += 5
      await sleep(interval * 1000)
      continue
    }
    if (error === 'expired_token') return { status: 'expired', message: 'the code expired: start the sign-in again' }
    if (error === 'access_denied') return { status: 'denied', message: 'the sign-in was denied' }
    return { status: 'denied', message: payload.error_description || error || 'unexpected answer from GitHub' }
  }
  return { status: 'pending', message: 'still waiting for approval: ask again to keep polling' }
}

/** Store a granted value. Written 0600 and never returned to the caller. */
export async function writeAccessFile(path, { token, login = '', scope = '', source = 'device-flow' } = {}) {
  if (!token) throw new Error('token is required')
  await fs.mkdir(dirname(path), { recursive: true })
  const record = { token, login, scope, source, savedAt: new Date().toISOString() }
  await fs.writeFile(path, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 })
  await fs.chmod(path, 0o600).catch(() => {})
  return { path, login, scope }
}

/** Read the stored sign-in, or null when there is none. */
export async function readAccessFile(path) {
  try {
    const text = await fs.readFile(path, 'utf8')
    const parsed = JSON.parse(text)
    return parsed && parsed.token ? parsed : null
  } catch {
    return null
  }
}

/** Forget the stored sign-in. */
export async function clearAccessFile(path) {
  try {
    await fs.rm(path, { force: true })
    return { removed: true, path }
  } catch (err) {
    return { removed: false, path, error: String((err && err.message) || err) }
  }
}
