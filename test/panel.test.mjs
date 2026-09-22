import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { repoTreeView } from '../lib/tools/panel-data.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const client = fs.readFileSync(path.join(here, '..', 'lib', 'client.js'), 'utf8')
const routes = fs.readFileSync(path.join(here, '..', 'lib', 'routes.js'), 'utf8')

function clientDouble(payload) {
  const calls = []
  return {
    calls,
    get: async (p, opts) => { calls.push({ path: p, opts }); return { data: payload } },
  }
}

test('the tree view lists directories first and sorts both groups by name', async () => {
  const clientImpl = clientDouble({
    truncated: false,
    tree: [
      { path: 'zeta.js', type: 'blob', size: 10, sha: 'a' },
      { path: 'src', type: 'tree', sha: 'b' },
      { path: 'alpha.js', type: 'blob', size: 20, sha: 'c' },
      { path: 'lib', type: 'tree', sha: 'd' },
    ],
  })
  const view = await repoTreeView(clientImpl, { owner: 'o', repo: 'r' })
  assert.deepEqual(view.entries.map((e) => e.name), ['lib', 'src', 'alpha.js', 'zeta.js'])
  assert.equal(view.entries[0].type, 'tree')
  assert.equal(view.count, 4)
  assert.equal(view.path, '')
  assert.equal(clientImpl.calls[0].path, '/repos/o/r/git/trees/HEAD')
})

test('a subtree path is passed through and its entries keep the full path', async () => {
  const clientImpl = clientDouble({ tree: [{ path: 'lib/tools/api.js', type: 'blob', size: 5, sha: 'x' }] })
  const view = await repoTreeView(clientImpl, { owner: 'o', repo: 'r', ref: 'main', path: '/lib/tools/' })
  assert.equal(clientImpl.calls[0].path, '/repos/o/r/git/trees/main/lib/tools')
  assert.equal(view.path, '/lib/tools/')
  assert.equal(view.entries[0].name, 'api.js')
  assert.equal(view.entries[0].path, 'lib/tools/api.js')
})

test('the tree view caps its page and reports truncation', async () => {
  const many = Array.from({ length: 300 }, (_, i) => ({ path: `f${i}.js`, type: 'blob', size: 1, sha: `${i}` }))
  const view = await repoTreeView(clientDouble({ truncated: true, tree: many }), { owner: 'o', repo: 'r', limit: 10 })
  assert.equal(view.count, 10)
  assert.equal(view.truncated, true)
})

test('the tree view refuses a call without a repository', async () => {
  await assert.rejects(() => repoTreeView(clientDouble({}), { owner: '', repo: '' }), /owner and repo are required/)
})

test('the panel route is read-only, trusted-caller only, and switches on `what`', () => {
  const start = routes.indexOf('path: PANEL_PATH')
  const end = routes.indexOf('dsh-github-ops: panel route', start)
  const route = routes.slice(start, end)
  assert.match(route, /if \(req\.method !== 'GET'\)/)
  assert.match(route, /if \(!isTrustedRequest\(req\)\)/)
  assert.match(route, /what === 'repos'/)
  assert.match(route, /what === 'tree'/)
  assert.match(route, /what === 'blob'/)
  assert.match(route, /what === 'issues'/)
  assert.match(route, /what === 'pulls'/)
  assert.match(route, /what === 'runs'/)
  assert.match(route, /what === 'inbox'/)
  assert.match(route, /configured: false, guidance/, 'no access is explained, not shown as an empty list')
  for (const verb of ['request(', 'post(', 'patch(', 'put(', 'del(']) {
    assert.ok(!route.includes(`github.${verb}`), `the panel route must not call ${verb}`)
  }
})

test('the panel registers in better-sidebar and in the built-in right sidebar', () => {
  assert.match(client, /betterSidebar\.registerTab\(\{/)
  assert.match(client, /id: 'github-ops:panel'/)
  assert.match(client, /component: \(viewProps\) => React\.createElement\(GitHubPanel/)
  assert.match(client, /sidebarRightTabs\.register\(\{/)
  assert.match(client, /kind: 'github'/)
  assert.match(client, /patterns: \['dsh-resource:\/\/github\/\*\*'\]/)
  assert.match(client, /canOpen: \(address\) =>/)
})

test('the panel reads through the host route and never sends a write', () => {
  const start = client.indexOf('function GitHubPanel(props)')
  const end = client.indexOf('let cssInstalled = false', start)
  const component = client.slice(start, end)
  assert.match(component, /fetch\(`\$\{PANEL_PATH\}\?\$\{query\}`/)
  assert.ok(!/method:\s*'POST'/i.test(component))
  assert.ok(!/gh_release_|pr_merge\(|window\.open\(/.test(component), 'links are anchors, not forced windows')
  assert.match(component, /target: '_blank'/)
})

test('both locales carry the panel strings', () => {
  for (const key of ['panelTitle', 'panelChoose', 'panelIssues', 'panelPulls', 'panelRuns', 'panelInbox', 'panelNoAccess', 'panelEmpty', 'panelLoading']) {
    const count = client.split(`${key}:`).length - 1
    assert.ok(count >= 2, `${key} should exist in both dictionaries, found ${count}`)
  }
})
