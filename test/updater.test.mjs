import test from 'node:test'
import assert from 'node:assert/strict'

import { registerPluginUpdater, isNewerVersion, isTrustedUpdateRequest } from '../lib/updater.js'

test('isNewerVersion compares semver and prereleases correctly', () => {
  assert.equal(isNewerVersion('0.2.4', '0.2.5'), true)
  assert.equal(isNewerVersion('0.2.4', '0.3.0'), true)
  assert.equal(isNewerVersion('0.2.4', '1.0.0'), true)
  assert.equal(isNewerVersion('0.2.4', '0.2.4'), false)
  assert.equal(isNewerVersion('0.2.4', '0.2.3'), false)
  assert.equal(isNewerVersion('0.2.4-alpha.1', '0.2.4'), true)
  assert.equal(isNewerVersion('invalid', '0.2.5'), false)
})

test('isTrustedUpdateRequest enforces header and loopback caller', () => {
  assert.equal(isTrustedUpdateRequest(null), false)
  assert.equal(isTrustedUpdateRequest({ headers: {} }), false)

  const remote = {
    headers: { 'x-dsh-plugin-update': '1', host: 'localhost:3080', origin: 'http://localhost:3080' },
    socket: { remoteAddress: '203.0.113.10' },
  }
  assert.equal(isTrustedUpdateRequest(remote), false)

  const trusted = {
    headers: { 'x-dsh-plugin-update': '1', host: 'localhost:3080', origin: 'http://localhost:3080', 'sec-fetch-site': 'same-origin' },
    socket: { remoteAddress: '127.0.0.1' },
  }
  assert.equal(isTrustedUpdateRequest(trusted), true)
})

test('registerPluginUpdater registers endpoint and answers status and method restrictions', async () => {
  let route = null
  const wctx = {
    webServer: {
      register: (opts) => {
        route = opts
        return () => {}
      },
    },
    logger: { warn: () => {} },
  }

  registerPluginUpdater(wctx, {
    endpoint: '/dsh-github-ops/update',
    packageName: '@goodandready/dsh-github-ops',
    manifestUrl: new URL('../package.json', import.meta.url),
  })

  assert.ok(route)
  assert.equal(route.path, '/dsh-github-ops/update')

  // Unsupported method: 405
  let code = null
  const res405 = { writeHead: (s) => { code = s }, end: () => {} }
  await route.handler({ method: 'PUT' }, res405)
  assert.equal(code, 405)

  // Untrusted POST: 403
  let jsonRes = null
  const res403 = {
    writeHead: (s) => { code = s },
    end: (d) => { jsonRes = JSON.parse(d) },
  }
  await route.handler({ method: 'POST', headers: {} }, res403)
  assert.equal(code, 403)
  assert.ok(jsonRes.error)
})
