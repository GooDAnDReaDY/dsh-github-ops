import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildAction,
  validateBranch,
  validatePath,
  validateMessage,
  validateStashRef,
  validateCwd,
  ACTIONS,
  OPERATION_VERBS,
} from '../lib/scm-write.js'

test('every action builds argv arrays and never a shell string', () => {
  for (const action of ACTIONS) {
    const args = {
      stage: {},
      unstage: { path: 'a.js' },
      discard: { path: 'a.js', confirm: true },
      commit: { message: 'm' },
      push: {},
      sync: {},
      branchCreate: { branch: 'feat/x' },
      branchCheckout: { branch: 'main' },
      branchDelete: { branch: 'feat/x', confirm: true },
      stashPush: { message: 'wip' },
      stashApply: { ref: 'stash@{0}' },
      stashPop: { ref: 'stash@{0}' },
      stashDrop: { ref: 'stash@{0}', confirm: true },
      continue: { verb: 'merge' },
      abort: { verb: 'rebase', confirm: true },
    }[action]
    const built = buildAction(action, args)
    assert.equal(built.action, action)
    assert.equal(built.mutating, true)
    assert.ok(Array.isArray(built.steps) && built.steps.length > 0, `${action} needs steps`)
    for (const step of built.steps) {
      assert.ok(Array.isArray(step), `${action}: a step must be an argv array`)
      assert.ok(step.length > 0)
      for (const part of step) assert.equal(typeof part, 'string')
      assert.ok(!step.some((p) => /[|;&><`$]/.test(p)), `${action}: no shell metacharacters in argv`)
    }
  }
})

test('the destructive actions refuse to run without a confirmation', () => {
  for (const [action, args] of [
    ['discard', { path: 'a.js' }],
    ['branchDelete', { branch: 'feat/x' }],
    ['stashDrop', { ref: 'stash@{0}' }],
    ['abort', { verb: 'merge' }],
  ]) {
    assert.throws(() => buildAction(action, args), /without confirm: true/, `${action} must refuse`)
    const withConfirm = buildAction(action, { ...args, confirm: true })
    assert.equal(withConfirm.destructive, true)
  }
})

test('commit builds one step, and commit with push builds both', () => {
  const commit = buildAction('commit', { message: 'feat: x' })
  assert.deepEqual(commit.steps, [['commit', '-m', 'feat: x']])
  const amended = buildAction('commit', { message: 'feat: x', amend: true })
  assert.deepEqual(amended.steps, [['commit', '--amend', '-m', 'feat: x']])
  const pushed = buildAction('commit', { message: 'feat: x', push: true })
  assert.deepEqual(pushed.steps, [['commit', '-m', 'feat: x'], ['push']])
})

test('stage without a path reaches everything, with a path only that file', () => {
  assert.deepEqual(buildAction('stage', {}).steps, [['add', '-A']])
  assert.deepEqual(buildAction('stage', { path: 'lib/a.js' }).steps, [['add', '--', 'lib/a.js']])
  assert.deepEqual(buildAction('unstage', {}).steps, [['reset', 'HEAD']])
})

test('branch names that could be read as options or escape the repository are refused', () => {
  assert.equal(validateBranch('feat/x-1'), 'feat/x-1')
  for (const bad of ['-x', 'feat..x', 'feat x', 'feat;rm -rf', 'feat$(x)', '', 'a'.repeat(200), 'feat\nx']) {
    assert.throws(() => validateBranch(bad), /unsafe branch name/, `must refuse ${JSON.stringify(bad)}`)
  }
})

test('paths cannot be absolute or climb out of the repository', () => {
  assert.equal(validatePath('lib/a.js'), 'lib/a.js')
  for (const bad of ['/etc/passwd', '../secrets', '-flag', 'a\u0000b', '']) {
    assert.throws(() => validatePath(bad), /unsafe path/, `must refuse ${JSON.stringify(bad)}`)
  }
})

test('messages and stash references are validated', () => {
  assert.equal(validateMessage('  feat: x  '), 'feat: x')
  assert.throws(() => validateMessage(''), /needs a message/)
  assert.throws(() => validateMessage('a'.repeat(5001)), /longer than 5000/)
  assert.equal(validateStashRef('stash@{12}'), 'stash@{12}')
  for (const bad of ['stash@{x}', 'HEAD', '', 'stash@{0}; rm -rf /']) {
    assert.throws(() => validateStashRef(bad), /unsafe stash reference/, `must refuse ${JSON.stringify(bad)}`)
  }
})

test('unknown actions and unknown operation verbs are refused', () => {
  assert.throws(() => buildAction('rm-rf', {}), /unknown action/)
  assert.throws(() => buildAction('', {}), /unknown action/)
  assert.throws(() => buildAction('continue', { verb: 'nonsense' }), /unknown operation/)
  assert.throws(() => buildAction('abort', { verb: 'nonsense', confirm: true }), /unknown operation/)
  for (const verb of OPERATION_VERBS) {
    assert.deepEqual(buildAction('continue', { verb }).steps, [[verb, '--continue']])
  }
})

test('a summary is always there, so the route can report what it ran', () => {
  assert.match(buildAction('push', {}).summary, /push/)
  assert.match(buildAction('branchCreate', { branch: 'feat/x' }).summary, /feat\/x/)
  assert.match(buildAction('discard', { path: 'a.js', confirm: true }).summary, /a\.js/)
})

test('sync is a rebase pull followed by a push, never a bare pull', () => {
  assert.deepEqual(buildAction('sync', {}).steps, [['pull', '--rebase', '--autostash'], ['push']])
})

test('the optional repository path is absolute, traversal-free and bounded', () => {
  assert.equal(validateCwd(''), '')
  assert.equal(validateCwd('   '), '')
  assert.equal(validateCwd('/srv/repo'), '/srv/repo')
  for (const bad of ['srv/repo', '../repo', '/srv/../etc', '/srv\u0000repo', '/' + 'a'.repeat(600)]) {
    assert.throws(() => validateCwd(bad), /repository path/, `must refuse ${JSON.stringify(bad).slice(0, 30)}`)
  }
})
