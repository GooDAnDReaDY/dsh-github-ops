import test from 'node:test'
import assert from 'node:assert/strict'

import {
  parseStatusLine,
  parseStatus,
  parseBranches,
  parseStashes,
  parseCount,
  scmPayload,
  mergeStateFrom,
} from '../lib/scm.js'

test('parseStatusLine understands plain, renamed and quoted paths', () => {
  assert.deepEqual(parseStatusLine('M  lib/a.js'), { index: 'M', worktree: ' ', path: 'lib/a.js', renamedFrom: '' })
  assert.deepEqual(parseStatusLine(' M lib/a.js'), { index: ' ', worktree: 'M', path: 'lib/a.js', renamedFrom: '' })
  assert.deepEqual(parseStatusLine('R  lib/new.js -> lib/old.js'), { index: 'R', worktree: ' ', path: 'lib/old.js', renamedFrom: 'lib/new.js' })
  assert.deepEqual(parseStatusLine('?? "a b.txt"'), { index: '?', worktree: '?', path: 'a b.txt', renamedFrom: '' })
  assert.equal(parseStatusLine(''), null)
})

test('parseStatus groups staged, changed, untracked and unmerged files', () => {
  const status = parseStatus([
    'M  lib/staged.js',
    ' M lib/changed.js',
    'A  lib/added.js',
    '?? lib/new.js',
    'UU lib/conflict.js',
    'D  lib/deleted.js',
  ].join('\n'))
  assert.deepEqual(status.staged.map((f) => f.path), ['lib/staged.js', 'lib/added.js', 'lib/deleted.js'])
  assert.deepEqual(status.changes.map((f) => f.path), ['lib/changed.js'])
  assert.deepEqual(status.untracked.map((f) => f.path), ['lib/new.js'])
  assert.deepEqual(status.unmerged.map((f) => f.path), ['lib/conflict.js'])
  assert.equal(status.total, 6)
  assert.equal(status.staged[0].staged, true)
  assert.equal(status.changes[0].staged, false)
})

test('a file both staged and modified appears in both groups', () => {
  const status = parseStatus('MM lib/both.js')
  assert.deepEqual(status.staged.map((f) => f.path), ['lib/both.js'])
  assert.deepEqual(status.changes.map((f) => f.path), ['lib/both.js'])
})

test('parseStatus on an empty listing is empty, not broken', () => {
  assert.deepEqual(parseStatus(''), { staged: [], changes: [], untracked: [], unmerged: [], total: 0 })
  assert.deepEqual(parseStatus(null).total, 0)
})

test('parseBranches reads the formatted and the plain listing', () => {
  assert.deepEqual(
    parseBranches('main\t*\nfeat/x\t\norigin/main\t'),
    [{ name: 'main', current: true }, { name: 'feat/x', current: false }, { name: 'origin/main', current: false }],
  )
  assert.deepEqual(parseBranches('* main\n  feat/x'), [{ name: 'main', current: true }, { name: 'feat/x', current: false }])
})

test('parseStashes reads both formats and parseCount refuses nonsense', () => {
  assert.deepEqual(
    parseStashes('stash@{0}\tWIP on main: 1234 message\nstash@{1}\tOn feat: other'),
    [{ ref: 'stash@{0}', message: 'WIP on main: 1234 message' }, { ref: 'stash@{1}', message: 'On feat: other' }],
  )
  assert.deepEqual(
    parseStashes('stash@{0}: WIP on main: 1234 message'),
    [{ ref: 'stash@{0}', message: 'WIP on main: 1234 message' }],
  )
  assert.equal(parseCount('7\n'), 7)
  assert.equal(parseCount(''), 0)
  assert.equal(parseCount('not a number'), 0)
  assert.equal(parseCount('-3'), 0)
})

test('mergeStateFrom names what is in progress', () => {
  assert.deepEqual(mergeStateFrom({ mergeHead: true }), { inProgress: true, kind: 'merge' })
  assert.deepEqual(mergeStateFrom({ rebaseDir: true }), { inProgress: true, kind: 'rebase' })
  assert.deepEqual(mergeStateFrom({ cherryPickHead: true }), { inProgress: true, kind: 'cherry-pick' })
  assert.deepEqual(mergeStateFrom({ revertHead: true }), { inProgress: true, kind: 'revert' })
  assert.deepEqual(mergeStateFrom({}), { inProgress: false, kind: '' })
})

test('the payload is renderable even for a directory that is not a repository', () => {
  const outside = scmPayload({ cwd: '/tmp', error: 'not a git repository' })
  assert.equal(outside.isRepository, false)
  assert.equal(outside.error, 'not a git repository')
  assert.equal(outside.files.total, 0)
  assert.deepEqual(outside.branches, [])

  const inside = scmPayload({
    cwd: '/repo', branch: 'main', upstream: 'origin/main', ahead: 2, behind: 1,
    status: parseStatus('M  a.js'), branches: [{ name: 'main', current: true }], tags: ['v1'],
    stashes: [], merge: mergeStateFrom({}),
  })
  assert.equal(inside.isRepository, true)
  assert.equal(inside.ahead, 2)
  assert.equal(inside.behind, 1)
  assert.equal(inside.files.total, 1)
})

test('a repository without an upstream reports null ahead/behind, not zero', () => {
  const payload = scmPayload({ branch: 'feat/x', ahead: undefined, behind: undefined })
  assert.equal(payload.ahead, null)
  assert.equal(payload.behind, null)
  assert.equal(payload.upstream, '')
})
