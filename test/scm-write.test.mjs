import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildAction,
  resolveConflictFile,
  validateBranch,
  validatePath,
  validateMessage,
  validateStashRef,
  validateCwd,
  validatePatch,
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
      stashShow: { ref: 'stash@{0}' },
      worktreeAdd: { path: '/tmp/wt' },
      worktreeRemove: { path: '/tmp/wt', confirm: true },
      continue: { verb: 'merge' },
      abort: { verb: 'rebase', confirm: true },
      resolveConflict: { path: 'a.js', choice: 'ours' },
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
  assert.equal(validateStashRef('0'), 'stash@{0}')
  assert.equal(validateStashRef('12'), 'stash@{12}')
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
  for (const sysRoot of ['/etc', '/etc/passwd', '/proc', '/sys', '/root', '/dev']) { assert.throws(() => validateCwd(sysRoot), /system directory/, `must refuse system path ${sysRoot}`) }
  for (const bad of ['srv/repo', '../repo', '/srv/../etc', '/srv\u0000repo', '/' + 'a'.repeat(600)]) {
    assert.throws(() => validateCwd(bad), /repository path/, `must refuse ${JSON.stringify(bad).slice(0, 30)}`)
  }
})

test('worktreeAdd generates valid worktree add step', () => {
  const res1 = buildAction('worktreeAdd', { path: '/srv/repo-wt' })
  assert.deepEqual(res1.steps, [['worktree', 'add', '/srv/repo-wt']])

  const res2 = buildAction('worktreeAdd', { path: '/srv/repo-wt', branch: 'feat/x' })
  assert.deepEqual(res2.steps, [['worktree', 'add', '/srv/repo-wt', 'feat/x']])

  const res3 = buildAction('worktreeAdd', { path: '/srv/repo-wt', newBranch: 'feat/new' })
  assert.deepEqual(res3.steps, [['worktree', 'add', '-b', 'feat/new', '/srv/repo-wt']])

  assert.throws(() => buildAction('worktreeAdd', { path: '' }), /worktree path is required/)
  assert.throws(() => buildAction('worktreeAdd', { path: 'relative/path' }), /must be absolute/)
})

test('worktreeRemove requires confirmation and produces worktree remove step', () => {
  assert.throws(() => buildAction('worktreeRemove', { path: '/srv/repo-wt' }), /without confirm: true/)
  const res = buildAction('worktreeRemove', { path: '/srv/repo-wt', confirm: true })
  assert.deepEqual(res.steps, [['worktree', 'remove', '/srv/repo-wt']])
  assert.equal(res.destructive, true)
  assert.equal(res.needsConfirm, true)

  const resForce = buildAction('worktreeRemove', { path: '/srv/repo-wt', confirm: true, force: true })
  assert.deepEqual(resForce.steps, [['worktree', 'remove', '--force', '/srv/repo-wt']])
})


test('validateCwd rejects symlinks pointing to disallowed system paths', async () => {
  const fs = await import('node:fs/promises')
  const os = await import('node:os')
  const path = await import('node:path')
  const symlinkPath = path.join(os.tmpdir(), `test-symlink-etc-${Date.now()}`)
  try {
    await fs.symlink('/etc', symlinkPath)
    assert.throws(() => validateCwd(symlinkPath), /access to system directory "\/etc" is not allowed/)
  } finally {
    await fs.unlink(symlinkPath).catch(() => {})
  }
})

test('stashShow, stashApply, stashPop and stashDrop build valid stash steps', () => {
  assert.deepEqual(buildAction('stashShow', { ref: 'stash@{0}' }).steps, [['stash', 'show', '-p', 'stash@{0}']])
  assert.deepEqual(buildAction('stash_show', { ref: '0' }).steps, [['stash', 'show', '-p', 'stash@{0}']])
  assert.deepEqual(buildAction('stashApply', { ref: '0' }).steps, [['stash', 'apply', 'stash@{0}']])
  assert.deepEqual(buildAction('stash_apply', { ref: 'stash@{1}' }).steps, [['stash', 'apply', 'stash@{1}']])
  assert.deepEqual(buildAction('stashPop', { ref: 'stash@{0}' }).steps, [['stash', 'pop', 'stash@{0}']])
  assert.deepEqual(buildAction('stash_pop', { ref: '0' }).steps, [['stash', 'pop', 'stash@{0}']])
  assert.deepEqual(buildAction('stashDrop', { ref: 'stash@{0}', confirm: true }).steps, [['stash', 'drop', 'stash@{0}']])
  assert.deepEqual(buildAction('stash_drop', { ref: '0', confirm: true }).steps, [['stash', 'drop', 'stash@{0}']])
  assert.throws(() => buildAction('stash_drop', { ref: '0' }), /without confirm: true/)
})


test('resolveConflict builds add step and resolveConflictFile resolves file on disk', async () => {
  const fs = await import('node:fs/promises')
  const os = await import('node:os')
  const path = await import('node:path')

  const built = buildAction('resolveConflict', { path: 'file.txt', choice: 'ours' })
  assert.equal(built.action, 'resolveConflict')
  assert.deepEqual(built.steps, [['add', '--', 'file.txt']])

  // Bad choice throws
  assert.throws(() => buildAction('resolveConflict', { path: 'file.txt', choice: 'invalid' }), /invalid conflict resolution choice/)

  // Test resolveConflictFile
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-scm-conflict-'))
  try {
    const filePath = path.join(tmpDir, 'conflict.js')
    await fs.writeFile(filePath, 'header\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> incoming\nfooter', 'utf8')

    const res = resolveConflictFile({ cwd: tmpDir, path: 'conflict.js', choice: 'theirs' })
    assert.equal(res.resolved, true)
    assert.equal(res.choice, 'theirs')

    const after = await fs.readFile(filePath, 'utf8')
    assert.equal(after, 'header\ntheirs\nfooter')

    // File without conflicts throws
    assert.throws(() => resolveConflictFile({ cwd: tmpDir, path: 'conflict.js', choice: 'ours' }), /no merge conflict markers found/)
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
})

test('validatePatch and stage_patch / unstage_patch actions validate input and build git apply steps', () => {
  const patch = `diff --git a/a.js b/a.js
--- a/a.js
+++ b/a.js
@@ -1,2 +1,2 @@
-old
+new
`
  assert.equal(validatePatch(patch), patch)
  assert.throws(() => validatePatch(''), /patch cannot be empty/)
  assert.throws(() => validatePatch('plain text without diff markers'), /missing diff hunk markers/)
  assert.throws(() => validatePatch('a\u0000b'), /patch with a NUL byte/)

  // stage_patch
  const stageRes = buildAction('stage_patch', { patch })
  assert.equal(stageRes.action, 'stage_patch')
  assert.deepEqual(stageRes.steps, [['apply', '--cached', '-']])
  assert.equal(stageRes.input, patch)
  assert.equal(stageRes.destructive, false)

  // stagePatch alias
  const stageAlias = buildAction('stagePatch', { patch })
  assert.equal(stageAlias.action, 'stage_patch')
  assert.deepEqual(stageAlias.steps, [['apply', '--cached', '-']])
  assert.equal(stageAlias.input, patch)

  // unstage_patch
  const unstageRes = buildAction('unstage_patch', { patch })
  assert.equal(unstageRes.action, 'unstage_patch')
  assert.deepEqual(unstageRes.steps, [['apply', '--cached', '--reverse', '-']])
  assert.equal(unstageRes.input, patch)
  assert.equal(unstageRes.destructive, false)

  // unstagePatch alias
  const unstageAlias = buildAction('unstagePatch', { patch })
  assert.equal(unstageAlias.action, 'unstage_patch')
  assert.deepEqual(unstageAlias.steps, [['apply', '--cached', '--reverse', '-']])
  assert.equal(unstageAlias.input, patch)
})
