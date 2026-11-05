import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { statusPayload } from '../lib/status.js'
import { scmPayload } from '../lib/scm.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const clientPath = path.join(here, '..', 'lib', 'client.js')
const hostPath = path.join(here, '..', 'lib', 'index.js')
const hostSource = fs.readFileSync(hostPath, 'utf8')

function makeStatefulReact() {
  const store = []
  let index = 0
  return {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState: (initial) => {
      const at = index++
      if (store[at] === undefined) store[at] = initial
      return [store[at], (next) => { store[at] = typeof next === 'function' ? next(store[at]) : next }]
    },
    useCallback: (fn) => fn,
    useEffect: (fn) => {
      fn()
      index = 0
    },
    resetIndex: () => { index = 0 },
  }
}

function loadClientWithFetch(customFetch) {
  const code = fs.readFileSync(clientPath, 'utf8')
  let loaded = null
  const win = { __ModuleLoader__: { load: (mod) => { loaded = mod } } }
  let reactInstance = null
  const context = vm.createContext({
    window: win,
    fetch: customFetch || (async () => ({ ok: true, status: 200, json: async () => ({}) })),
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    document: {
      querySelector: () => null,
      createElement: () => ({ dataset: {}, style: {}, textContent: '', appendChild: () => {} }),
      head: { appendChild: () => {} },
    },
  })
  vm.runInContext(code, context)
  const factory = loaded.factory((name) => {
    if (name === 'react') {
      reactInstance = makeStatefulReact()
      return reactInstance
    }
    throw new Error('unexpected require: ' + name)
  })
  return { mod: loaded, exports: factory, getReact: () => reactInstance }
}

test('Config schema declares showPrBar with default true', () => {
  assert.match(hostSource, /showPrBar:\s*Schema\.boolean\(\)\.volatile\(\)\.default\(true\)/)
  assert.match(hostSource, /Show pull request status and quick actions bar above the conversation composer dock/)
})

test('statusPayload and scmPayload transmit showPrBar accurately', () => {
  const statusDefault = statusPayload({ access: { value: 'token', source: 'gh' } })
  assert.equal(statusDefault.showPrBar, true)

  const statusDisabled = statusPayload({ access: { value: 'token', source: 'gh' }, showPrBar: false })
  assert.equal(statusDisabled.showPrBar, false)

  const scmDefault = scmPayload({ branch: 'feat', upstream: 'origin/main', ahead: 2 })
  assert.equal(scmDefault.showPrBar, true)

  const scmDisabled = scmPayload({ branch: 'feat', upstream: 'origin/main', ahead: 2, showPrBar: false })
  assert.equal(scmDisabled.showPrBar, false)
})

test('GitHubOpsCard exposes showPrBar checkbox and saves value to configForms', async () => {
  const { exports } = loadClientWithFetch()
  const savedEntries = {}
  const configScope = {
    getSnapshot: () => ({ status: 'ready', value: { showPrBar: true }, writable: true }),
    subscribe: () => () => {},
    set: async (key, val) => { savedEntries[key] = val },
  }
  const ctx = {
    locale: { register: () => {} },
    slots: { inject: (_n, f) => f(), register: () => () => {} },
    configForms: { get: () => configScope },
  }
  exports.apply(ctx)

  const card = exports.GitHubOpsCard({ view: 'page', ctx, t: (k) => k })
  const jsonTree = JSON.stringify(card)
  assert.ok(jsonTree.includes('showPrBar'), 'card must render showPrBar field')
  assert.ok(jsonTree.includes('gho-check-label'), 'card must use check label for boolean toggle')
})

test('PullRequestBar renders when showPrBar is true and commits are ahead', async () => {
  const scmResponse = {
    isRepository: true,
    branch: 'feat/something',
    upstream: 'origin/main',
    ahead: 3,
    showPrBar: true,
  }
  const { exports, getReact } = loadClientWithFetch(async () => ({
    ok: true,
    status: 200,
    json: async () => scmResponse,
  }))

  const ctx = {
    configForms: {
      get: () => ({
        getSnapshot: () => ({ status: 'ready', value: { showPrBar: true } }),
        subscribe: () => () => {},
      }),
    },
  }

  // First mount triggers fetch
  exports.PullRequestBar({ t: (k) => k, ctx })
  // Wait for fetch promise tick
  await new Promise((r) => setTimeout(r, 20))
  // Second render with populated state
  getReact().resetIndex()
  const el = exports.PullRequestBar({ t: (k) => k, ctx })

  assert.ok(el !== null, 'PullRequestBar should render when ahead > 0 and showPrBar is true')
  const str = JSON.stringify(el)
  assert.ok(str.includes('gho-prbar'))
  assert.ok(str.includes('feat/something'))
})

test('PullRequestBar returns null when showPrBar is false in config snapshot', async () => {
  const scmResponse = {
    isRepository: true,
    branch: 'feat/something',
    upstream: 'origin/main',
    ahead: 3,
    showPrBar: true,
  }
  const { exports, getReact } = loadClientWithFetch(async () => ({
    ok: true,
    status: 200,
    json: async () => scmResponse,
  }))

  const ctx = {
    configForms: {
      get: () => ({
        getSnapshot: () => ({ status: 'ready', value: { showPrBar: false } }),
        subscribe: () => () => {},
      }),
    },
  }

  // First mount
  exports.PullRequestBar({ t: (k) => k, ctx })
  await new Promise((r) => setTimeout(r, 20))
  getReact().resetIndex()
  const el = exports.PullRequestBar({ t: (k) => k, ctx })
  assert.equal(el, null, 'PullRequestBar must return null when showPrBar is false in config')
})

test('PullRequestBar respects showPrBar false from server payload when configForms is absent', async () => {
  const scmResponse = {
    isRepository: true,
    branch: 'feat/something',
    upstream: 'origin/main',
    ahead: 3,
    showPrBar: false,
  }
  const { exports, getReact } = loadClientWithFetch(async () => ({
    ok: true,
    status: 200,
    json: async () => scmResponse,
  }))

  const ctx = {} // no configForms
  exports.PullRequestBar({ t: (k) => k, ctx })
  await new Promise((r) => setTimeout(r, 20))
  getReact().resetIndex()
  const el = exports.PullRequestBar({ t: (k) => k, ctx })
  assert.equal(el, null, 'PullRequestBar must return null when showPrBar is false from scm payload')
})

test('SourceControlView provides alternative access to PR actions (Create, Review, Merge)', async () => {
  const scmResponse = {
    isRepository: true,
    branch: 'feat/work',
    upstream: 'origin/main',
    ahead: 2,
    behind: 0,
    cwd: '/workspace/demo',
    files: { staged: [], changes: [], untracked: [], unmerged: [], total: 0 },
    branches: [{ name: 'feat/work', current: true }],
  }
  const { exports, getReact } = loadClientWithFetch(async () => ({
    ok: true,
    status: 200,
    json: async () => scmResponse,
  }))

  // Initial render (starts loading)
  exports.SourceControlView({ t: (k) => k })
  await new Promise((r) => setTimeout(r, 20))
  getReact().resetIndex()
  const el = exports.SourceControlView({ t: (k) => k })

  const str = JSON.stringify(el)
  assert.ok(str.includes('gho-scm'), 'SourceControlView must render')
  assert.ok(str.includes('prBarCreate'), 'SourceControlView must provide alternative Create PR action')
  assert.ok(str.includes('prBarReview'), 'SourceControlView must provide alternative Review PR action')
  assert.ok(str.includes('prBarMerge'), 'SourceControlView must provide alternative Merge PR action')
})
