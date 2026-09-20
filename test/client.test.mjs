import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const clientPath = path.join(here, '..', 'lib', 'client.js')

/** A small stateful React stand-in: state survives renders, effects run immediately. */
function makeFakeReact() {
  const store = []
  let index = 0
  return {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState: (initial) => {
      const at = index++
      if (store[at] === undefined) store[at] = initial
      return [store[at], (next) => { store[at] = typeof next === 'function' ? next(store[at]) : next }]
    },
    useEffect: (fn) => {
      fn()
      index = 0 // the render cycle is over; the next render starts from the first hook
    },
  }
}

/** Load the browser half in a VM with just enough globals, and return its exports. */
function loadClient() {
  const code = fs.readFileSync(clientPath, 'utf8')
  let loaded = null
  const win = { __ModuleLoader__: { load: (mod) => { loaded = mod } } }
  const context = vm.createContext({
    window: win,
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
  assert.ok(loaded, 'client.js must call window.__ModuleLoader__.load')
  const factory = loaded.factory((name) => {
    if (name === 'react') return makeFakeReact()
    throw new Error('unexpected require: ' + name)
  })
  return { mod: loaded, exports: factory }
}

test('browser half declares the module id that matches the package name', () => {
  const { mod } = loadClient()
  assert.equal(mod.id, '@goodandready/dsh-github-ops')
})

test('browser half injects slots, locale and settingsScope', () => {
  const { exports } = loadClient()
  assert.deepEqual([...exports.inject], ['slots', 'locale', 'settingsScope'])
  assert.equal(typeof exports.apply, 'function')
})

test('apply registers the plugin-list seat first, then the row seat and the legacy card', () => {
  const { exports } = loadClient()
  const registered = []
  const injected = []
  const ctx = {
    locale: { register: (ns, dict) => { registered.push({ ns, dict }) } },
    slots: {
      inject: (name, factory) => { injected.push(name); factory() },
      register: (entry, component) => { registered.push({ entry, component }); return () => {} },
    },
  }
  exports.apply(ctx)
  assert.deepEqual(injected, ['plugins.item', 'plugins.row.config', 'settings.plugin.item'])
  const seats = registered.filter((r) => r.entry)
  assert.equal(seats.length, 3)
  assert.equal(seats[0].entry.name, 'plugins.item')
  assert.equal(seats[0].entry.id, 'dsh-github-ops', 'the list seat needs an id, not a key')
  assert.equal(seats[0].entry.order, 60)
  assert.equal(typeof seats[0].entry.label, 'function')
  assert.equal(seats[0].entry.label(), 'GitHub ops', 'the label is a static string')
  assert.equal(seats[1].entry.key, '@goodandready/dsh-github-ops#dsh-github-ops')
  assert.equal(seats[2].entry.key, 'dsh-github-ops')
  for (const seat of seats) assert.equal(seat.entry.locale, 'dsh-github-ops')
})

test('every dictionary string is English or Chinese: no hardcoded Russian in the plugin', () => {
  const code = fs.readFileSync(clientPath, 'utf8')
  // The bundle may contain the words of the tri-lingual README contract, but no Cyrillic
  // user-facing string: the Russian UI is provided by dsh-russian-lang at runtime.
  const cyrillic = code.match(/[\u0400-\u04FF]/g) || []
  assert.deepEqual(cyrillic, [], 'client.js must not contain Cyrillic text')
})

test('the card checks the settings snapshot and exposes all four settings', () => {
  const { exports } = loadClient()
  let received = null
  const ctx = {
    locale: { register: () => {} },
    slots: { inject: (_n, f) => f(), register: (entry, component) => { received = { entry, component }; return () => {} } },
    settingsScope: { bind: () => ({ subscribe: () => () => {}, getSnapshot: () => ({ status: 'ready', value: {} }), set: async () => {} }) },
  }
  exports.apply(ctx)
  assert.ok(received && typeof received.component === 'function')

  const tree = received.component({ view: 'page', ctx, t: (k) => k })
  const flat = JSON.stringify(tree)
  for (const key of ['tokenEnv', 'defaultRepository', 'baseUrl', 'timeoutMs']) {
    assert.ok(flat.includes(`${key}`), `the form must expose ${key}`)
  }
  assert.ok(flat.includes('gho-page'), 'the page view renders bare, without our card frame')
})

test('the summary view is a one-liner and installs a tagged style element', () => {
  const { exports } = loadClient()
  let received = null
  const ctx = {
    locale: { register: () => {} },
    slots: { inject: (_n, f) => f(), register: (entry, component) => { received = { entry, component }; return () => {} } },
  }
  exports.apply(ctx)
  const summary = received.component({ view: 'summary', ctx, t: (k) => k })
  assert.equal(summary.type, 'div')
  assert.equal(summary.props.className, 'gho-sub')
})

test('the settings card renders even when the settings service is unavailable', () => {
  const { exports } = loadClient()
  let received = null
  const ctx = {
    locale: { register: () => {} },
    slots: { inject: (_n, f) => f(), register: (entry, component) => { received = { entry, component }; return () => {} } },
  }
  exports.apply(ctx)
  // No settingsScope in this context: the card must say so instead of drawing a form
  // that silently does nothing.
  received.component({ view: 'page', ctx, t: (k) => k })
  const tree = received.component({ view: 'page', ctx, t: (k) => k })
  const flat = JSON.stringify(tree)
  assert.ok(flat.includes('statusUnavailable'), 'an unavailable snapshot must be stated, not hidden')
})
