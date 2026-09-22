import test from 'node:test'
import assert from 'node:assert/strict'

import { presentationFor, PRESENTED_TOOLS } from '../lib/present.js'

const call = (name, args = {}) => ({ name, arguments: args })

test('presented tools cover the busy ones and produce a card', () => {
  assert.ok(PRESENTED_TOOLS.length >= 20)
  const pending = presentationFor('pr_create').presentCall({ title: 'T', head: 'feat/x', base: 'main' })
  assert.equal(pending.card, 'generic')
  assert.match(pending.title, /Create pull request: T/)
  assert.equal(pending.rawInput.head, 'feat/x')
})

test('a completed card shows the useful facts and a failure says so', () => {
  const presentation = presentationFor('pr_create')
  const done = presentation.presentResult({}, { ok: true, data: { number: 7, url: 'u', base: 'main', head: 'feat/x', draft: false } })
  assert.match(done.title, /Created pull request #7/)
  assert.match(done.content[0].text, /main ← feat\/x/)

  const failed = presentation.presentResult({}, { ok: false, error: 'HTTP 422' })
  assert.match(failed.title, /not created/)
  assert.match(failed.content[0].text, /HTTP 422/)
})

test('lists render one line per item, and a tool without a presentation is left alone', () => {
  const list = presentationFor('gh_release_list').presentResult({}, {
    ok: true,
    data: { count: 2, releases: [{ tag: 'v1', name: 'one', draft: false, prerelease: false }, { tag: 'v2', name: 'two', draft: true, prerelease: false }] },
  })
  assert.match(list.content[0].text, /v1 — one/)
  assert.match(list.content[0].text, /v2 \(draft\) — two/)

  assert.deepEqual(presentationFor('gh_variable_set'), {}, 'a write tool without a card is fine')
  const unknown = presentationFor('gh_something_new')
  assert.deepEqual(Object.keys(unknown), [])
})

test('a reviewed pull request card summarises areas, checks and findings', () => {
  const card = presentationFor('gh_review').presentResult({}, {
    ok: true,
    data: {
      pull: { number: 3, title: 'feat: x' },
      areas: ['lib', 'test'],
      files: [{}, {}],
      checks: { rollup: 'success' },
      findings: [{ level: 'attention', detail: 'source changed without tests' }],
    },
  })
  assert.match(card.title, /#3: feat: x/)
  assert.match(card.content[0].text, /areas: lib, test/)
  assert.match(card.content[0].text, /\[attention\] source changed without tests/)
})
