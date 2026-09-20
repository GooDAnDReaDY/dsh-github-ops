import test from 'node:test'
import assert from 'node:assert/strict'

import { actionFor, askReason, decide, isUnattended, ALL_ACTIONS, DESTRUCTIVE_ACTIONS, ACTION_BY_TOOL } from '../lib/approval.js'
import { presentationFor, PRESENTED_TOOLS } from '../lib/present.js'

const call = (name, args = {}) => ({ name, arguments: args })

test('a read tool is not a write and never asks', () => {
  for (const name of ['gh_repo', 'gh_release_list', 'gh_tag_list', 'gh_review', 'gh_checks', 'gh_mirror_check', 'gh_run_list']) {
    assert.equal(actionFor(call(name, {})), null, name)
    assert.equal(decide({ exec: call(name, {}) }).kind, 'continue', name)
  }
})

test('gh_api counts as a write only when its method changes state', () => {
  assert.equal(actionFor(call('gh_api', { method: 'GET', path: '/x' })), null)
  assert.equal(actionFor(call('gh_api', { method: 'DELETE', path: '/x' })), 'api-call')
  assert.equal(actionFor(call('gh_api', { method: 'patch', path: '/x' })), 'api-call')
  assert.equal(actionFor(call('gh_api', { graphql: 'query { viewer { login } }' })), null, 'a query is not judged here')
})

test('every write action asks by default, and the reason says what will happen', () => {
  const decision = decide({ exec: call('pr_merge', { repository: 'o/r', number: 12, method: 'squash' }) })
  assert.equal(decision.kind, 'ask')
  assert.equal(decision.action, 'pr-merge')
  assert.match(decision.reason, /MERGE pull request #12 in o\/r \(squash\)/)

  const release = decide({ exec: call('gh_release_create', { repository: 'o/r', tag: 'v1.0.0', draft: true }) })
  assert.match(release.reason, /create GitHub release v1\.0\.0 \(draft\) in o\/r/)
})

test('a destructive action is always asked, even when it is in autoApprove', () => {
  for (const action of DESTRUCTIVE_ACTIONS) {
    const tool = Object.keys(ACTION_BY_TOOL).find((name) => ACTION_BY_TOOL[name] === action)
    const decision = decide({ exec: call(tool, { repository: 'o/r' }), autoApprove: [action], unattended: true })
    assert.equal(decision.kind, 'ask', action)
    assert.match(decision.reason, /cannot be undone/)
  }
})

test('an unattended run may auto-approve a listed, non-destructive action', () => {
  const decision = decide({
    exec: call('gh_release_create', { repository: 'o/r', tag: 'v1.0.0' }),
    autoApprove: ['release-create'],
    unattended: true,
  })
  assert.equal(decision.kind, 'allow')

  const notListed = decide({
    exec: call('gh_release_create', { repository: 'o/r', tag: 'v1.0.0' }),
    autoApprove: [],
    unattended: true,
  })
  assert.equal(notListed.kind, 'ask', 'unattended without an allowlist still asks')

  const attended = decide({
    exec: call('gh_release_create', { repository: 'o/r', tag: 'v1.0.0' }),
    autoApprove: ['release-create'],
    unattended: false,
  })
  assert.equal(attended.kind, 'ask', 'an interactive session always asks')
})

test('an action outside allowedActions is denied, not asked', () => {
  const decision = decide({ exec: call('gh_repo_edit', { repository: 'o/r' }), allowedActions: ['pr-create'] })
  assert.equal(decision.kind, 'deny')
  assert.match(decision.reason, /not in allowedActions/)
})

test('an empty or missing allowedActions means every known action is allowed', () => {
  assert.equal(decide({ exec: call('pr_create', { repository: 'o/r', title: 't', head: 'h' }) }).kind, 'ask')
  assert.equal(decide({ exec: call('pr_create', { repository: 'o/r' }), allowedActions: [] }).kind, 'ask')
  assert.ok(ALL_ACTIONS.length > 15)
})

test('unattended detection is explicit and off by default', () => {
  assert.equal(isUnattended({}), false)
  assert.equal(isUnattended({ DSH_GITHUB_OPS_UNATTENDED: '1' }), true)
  assert.equal(isUnattended({ DSH_GITHUB_OPS_UNATTENDED: 'true' }), false, 'only the documented value counts')
})

test('every write tool has an action and a readable reason', () => {
  for (const name of Object.keys(ACTION_BY_TOOL)) {
    const action = ACTION_BY_TOOL[name]
    const reason = askReason(call(name, { repository: 'o/r', tag: 'v1', number: 1, name: 'N', branch: 'main', runId: 1, title: 'T', head: 'h', path: '/x' }))
    assert.ok(reason && reason.length > 10, `${name} needs a reason`)
    assert.ok(!/perform a GitHub write action/.test(reason), `${name} must describe itself, got: ${reason}`)
    assert.ok(action.includes('-'), action)
  }
})

// ------------------------------------------------------------------ presentation

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
