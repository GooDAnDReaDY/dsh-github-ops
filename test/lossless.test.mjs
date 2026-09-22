import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { lossless, isLossless } from '../lib/lossless.js'
import { repoTree } from '../lib/tools/write-files.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const host = fs.readFileSync(path.join(here, '..', 'lib', 'index.js'), 'utf8')

test('undefined never survives: dropped from objects, null inside arrays', () => {
  const value = lossless({ a: 1, b: undefined, c: { d: undefined, e: 'x' }, list: [1, undefined, 3] })
  assert.deepEqual(value, { a: 1, c: { e: 'x' }, list: [1, null, 3] })
  assert.ok(!JSON.stringify(value).includes('undefined'))
})

test('numbers without a JSON form become null, and a finite zero stays zero', () => {
  assert.deepEqual(lossless({ a: NaN, b: Infinity, c: -Infinity, d: 0, e: -1.5 }), { a: null, b: null, c: null, d: 0, e: -1.5 })
})

test('exotic values are converted instead of dropped', () => {
  const when = new Date('2026-09-21T18:00:00Z')
  const value = lossless({
    when,
    big: 9007199254740993n,
    map: new Map([['a', 1]]),
    set: new Set(['x', 'y']),
    buffer: Buffer.from('hi'),
  })
  assert.equal(value.when, '2026-09-21T18:00:00.000Z')
  assert.equal(value.big, '9007199254740993')
  assert.deepEqual(value.map, { a: 1 })
  assert.deepEqual(value.set, ['x', 'y'])
  assert.equal(value.buffer, Buffer.from('hi').toString('base64'))
})

test('functions and symbols are dropped, a cycle is named instead of followed', () => {
  const cyclic = { name: 'root' }
  cyclic.self = cyclic
  const value = lossless({ fn: () => 1, sym: Symbol('s'), cyclic })
  assert.deepEqual(Object.keys(value).sort(), ['cyclic'])
  assert.equal(value.cyclic.self, '[circular]')
  assert.doesNotThrow(() => JSON.stringify(value))
})

test('an invalid Date and a too-deep structure do not throw', () => {
  const deep = { level: 1 }
  let cursor = deep
  for (let i = 0; i < 60; i += 1) {
    cursor.next = { level: i }
    cursor = cursor.next
  }
  const value = lossless({ bad: new Date('nonsense'), deep })
  assert.equal(value.bad, null)
  assert.ok(JSON.stringify(value).includes('too deep'))
})

test('isLossless agrees with the rule the harness applies', () => {
  assert.equal(isLossless({ a: 1, b: 'x', c: [1, 2] }), true)
  assert.equal(isLossless(lossless({ a: undefined, b: NaN })), true)
  assert.equal(isLossless(undefined), false)
})

test('the wrapper sanitises every tool result in one place', () => {
  assert.match(host, /import \{ lossless \} from '\.\/lossless\.js'/, 'the sanitiser is imported')
  assert.match(host, /return \{ ok: true, data: lossless\(value\) \}/, 'a successful result is sanitised')
  assert.match(host, /lossless\(out\)|const out = lossless\(/, 'a failed result is sanitised too')
})

test('gh_repo_tree no longer produces an undefined size', async () => {
  const client = {
    get: async () => ({
      data: {
        truncated: false,
        tree: [
          { path: 'lib', type: 'tree', sha: 't1' },
          { path: 'lib/a.js', type: 'blob', size: 12, sha: 'b1' },
        ],
      },
    }),
  }
  const tree = await repoTree(client, { owner: 'o', repo: 'r' })
  const asJson = JSON.stringify(tree)
  assert.ok(!asJson.includes('undefined'), 'no undefined anywhere in the payload')
  assert.equal(tree.entries[0].path, 'lib')
  assert.ok(!('size' in tree.entries[0]), 'a directory carries no size at all')
  assert.equal(tree.entries[1].size, 12)
  // and the same payload survives the sanitiser untouched
  assert.equal(JSON.stringify(lossless(tree)), asJson)
})
