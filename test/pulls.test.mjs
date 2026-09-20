import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createPull,
  updatePull,
  mergePull,
  reviewPull,
  postReview,
  getChecks,
  ciRun,
  areasFor,
} from '../lib/tools/pulls.js'

function clientDouble(routes) {
  const calls = []
  const pick = (path) => {
    for (const [pattern, value] of routes) {
      if (path.startsWith(pattern)) return typeof value === 'function' ? value(path) : value
    }
    return {}
  }
  return {
    calls,
    get: async (path, opts) => { calls.push({ method: 'GET', path, opts }); return { data: pick(path) } },
    post: async (path, body) => { calls.push({ method: 'POST', path, body }); return { data: pick(path) } },
    patch: async (path, body) => { calls.push({ method: 'PATCH', path, body }); return { data: pick(path) } },
    put: async (path, body) => { calls.push({ method: 'PUT', path, body }); return { data: pick(path) } },
    del: async (path) => { calls.push({ method: 'DELETE', path }); return { data: null } },
  }
}

const pull = {
  number: 12,
  title: 'feat: x',
  state: 'open',
  draft: false,
  user: { login: 'octocat' },
  head: { ref: 'feat/x' },
  base: { ref: 'main' },
  additions: 10,
  deletions: 2,
  changed_files: 2,
  html_url: 'https://github.com/o/r/pull/12',
  labels: [{ name: 'type/feature' }],
  requested_reviewers: [{ login: 'rev' }],
}

test('createPull sends head, base, draft and body', async () => {
  const client = clientDouble([['/repos/o/r/pulls', pull]])
  await createPull(client, { owner: 'o', repo: 'r', title: 'feat: x', head: 'feat/x', body: 'notes', draft: true })
  assert.deepEqual(client.calls[0].body, { title: 'feat: x', head: 'feat/x', base: 'main', body: 'notes', draft: true })
  await assert.rejects(() => createPull(client, { owner: 'o', repo: 'r', title: 'x' }), /head branch is required/)
})

test('updatePull requires at least one field', async () => {
  const client = clientDouble([['/repos/o/r/pulls/12', pull]])
  const updated = await updatePull(client, { owner: 'o', repo: 'r', number: 12, title: 'new' })
  assert.equal(updated.number, 12)
  await assert.rejects(() => updatePull(client, { owner: 'o', repo: 'r', number: 12 }), /nothing to update/)
})

test('mergePull maps the method, folds the response and can delete the head branch', async () => {
  const client = clientDouble([
    ['/repos/o/r/pulls/12/merge', { merged: true, message: 'Pull Request successfully merged', sha: 'abc' }],
    ['/repos/o/r/pulls/12', pull],
  ])
  const merged = await mergePull(client, { owner: 'o', repo: 'r', number: 12, method: 'squash', deleteBranch: true })
  assert.equal(merged.merged, true)
  assert.equal(merged.sha, 'abc')
  assert.equal(merged.branchDeleted, 'feat/x')
  const put = client.calls.find((c) => c.method === 'PUT')
  assert.deepEqual(put.body, { merge_method: 'squash' })
  const del = client.calls.find((c) => c.method === 'DELETE')
  assert.equal(del.path, '/repos/o/r/git/refs/heads/feat%2Fx')
})

test('mergePull refuses an unknown method', async () => {
  await assert.rejects(
    () => mergePull(clientDouble([]), { owner: 'o', repo: 'r', number: 1, method: 'octopus' }),
    /method must be one of/,
  )
})

test('areasFor groups file paths into top-level areas', () => {
  assert.deepEqual(
    areasFor([{ filename: 'lib/a.js' }, { filename: 'lib/b.js' }, { filename: 'test/c.test.mjs' }, { filename: 'README.md' }]),
    ['README', 'lib', 'test'],
  )
})

test('reviewPull collects metadata, areas, capped diff, findings and checks', async () => {
  const files = [
    { filename: 'lib/a.js', status: 'modified', additions: 5, deletions: 1, patch: '@@ -1 +1 @@\n-a\n+b' },
    { filename: '.env', status: 'added', additions: 1, deletions: 0, patch: '+SECRET=1' },
    { filename: 'migrations/001.sql', status: 'added', additions: 3, deletions: 0, patch: '+alter table' },
    { filename: '.github/workflows/ci.yml', status: 'modified', additions: 1, deletions: 1, patch: '@@' },
  ]
  const client = clientDouble([
    ['/repos/o/r/pulls/12/files', files],
    ['/repos/o/r/issues/12/comments', [{ id: 1, user: { login: 'rev' }, body: 'looks good' }]],
    ['/repos/o/r/commits/feat/x/check-runs', { check_runs: [{ name: 'ci', status: 'completed', conclusion: 'success' }] }],
    ['/repos/o/r/commits/feat/x/status', { state: 'success', statuses: [] }],
    ['/repos/o/r/pulls/12', pull],
  ])
  const pack = await reviewPull(client, { owner: 'o', repo: 'r', number: 12, maxDiffChars: 100000 })
  assert.equal(pack.pull.number, 12)
  assert.ok(pack.areas.includes('lib'))
  assert.equal(pack.comments.length, 1)
  assert.equal(pack.checks.rollup, 'success')
  const areas = pack.findings.map((f) => f.area)
  assert.ok(areas.includes('secrets'), 'secret material is flagged as critical')
  assert.ok(areas.includes('migration'))
  assert.ok(areas.includes('ci'))
  assert.ok(areas.includes('tests'), 'source changed without tests is flagged')
  assert.ok(pack.diff.includes('lib/a.js'))
  assert.equal(pack.diffTruncated, false)
})

test('reviewPull truncates a large diff and says so', async () => {
  const big = { filename: 'lib/big.js', status: 'modified', additions: 1000, deletions: 0, patch: 'x'.repeat(500) }
  const client = clientDouble([
    ['/repos/o/r/pulls/12/files', [big]],
    ['/repos/o/r/issues/12/comments', []],
    ['/repos/o/r/commits/feat/x/check-runs', { check_runs: [] }],
    ['/repos/o/r/commits/feat/x/status', { state: 'pending' }],
    ['/repos/o/r/pulls/12', pull],
  ])
  const pack = await reviewPull(client, { owner: 'o', repo: 'r', number: 12, maxDiffChars: 50 })
  assert.equal(pack.diffTruncated, true)
  assert.equal(pack.diff.length, 50)
})

test('postReview posts a summary comment or an inline review', async () => {
  const client = clientDouble([
    ['/repos/o/r/issues/12/comments', { id: 9, html_url: 'u' }],
    ['/repos/o/r/pulls/12/reviews', { id: 10, html_url: 'v' }],
  ])
  const summary = await postReview(client, { owner: 'o', repo: 'r', number: 12, body: 'ok' })
  assert.equal(summary.mode, 'summary')
  const inline = await postReview(client, {
    owner: 'o', repo: 'r', number: 12, body: 'ok', mode: 'inline',
    inline: [{ path: 'lib/a.js', line: 3, body: 'nit' }],
  })
  assert.equal(inline.mode, 'inline')
  const reviewCall = client.calls.find((c) => c.path.endsWith('/reviews'))
  assert.equal(reviewCall.body.event, 'COMMENT')
  assert.deepEqual(reviewCall.body.comments, [{ path: 'lib/a.js', line: 3, body: 'nit' }])
})

test('getChecks folds check runs and statuses into one rollup', async () => {
  const failing = clientDouble([
    ['/repos/o/r/commits/abc/check-runs', { check_runs: [{ name: 'ci', status: 'completed', conclusion: 'failure' }] }],
    ['/repos/o/r/commits/abc/status', { state: 'success', statuses: [] }],
  ])
  assert.equal((await getChecks(failing, { owner: 'o', repo: 'r', ref: 'abc' })).rollup, 'failure')

  const pending = clientDouble([
    ['/repos/o/r/commits/abc/check-runs', { check_runs: [{ name: 'ci', status: 'in_progress', conclusion: null }] }],
    ['/repos/o/r/commits/abc/status', { state: 'pending', statuses: [] }],
  ])
  assert.equal((await getChecks(pending, { owner: 'o', repo: 'r', ref: 'abc' })).rollup, 'pending')

  const empty = clientDouble([
    ['/repos/o/r/commits/abc/check-runs', { check_runs: [] }],
    ['/repos/o/r/commits/abc/status', { state: 'success', statuses: [] }],
  ])
  assert.equal((await getChecks(empty, { owner: 'o', repo: 'r', ref: 'abc' })).rollup, 'success')

  await assert.rejects(() => getChecks(clientDouble([]), { owner: 'o', repo: 'r' }), /ref is required/)
})

test('ciRun turns a failed check rollup into needs-changes and a clean one into success', async () => {
  const failingClient = clientDouble([
    ['/repos/o/r/pulls/12/files', [{ filename: 'lib/a.js', status: 'modified', additions: 1, deletions: 1, patch: '@@' }]],
    ['/repos/o/r/issues/12/comments', []],
    ['/repos/o/r/commits/feat/x/check-runs', { check_runs: [{ name: 'ci', status: 'completed', conclusion: 'failure' }] }],
    ['/repos/o/r/commits/feat/x/status', { state: 'success', statuses: [] }],
    ['/repos/o/r/pulls/12', pull],
  ])
  const bad = await ciRun(failingClient, { owner: 'o', repo: 'r', number: 12 })
  assert.equal(bad.verdict, 'needs-changes')
  assert.match(bad.summary, /PR #12/)

  const cleanClient = clientDouble([
    ['/repos/o/r/pulls/12/files', [{ filename: 'test/a.test.mjs', status: 'modified', additions: 1, deletions: 1, patch: '@@' }]],
    ['/repos/o/r/issues/12/comments', []],
    ['/repos/o/r/commits/feat/x/check-runs', { check_runs: [{ name: 'ci', status: 'completed', conclusion: 'success' }] }],
    ['/repos/o/r/commits/feat/x/status', { state: 'success', statuses: [] }],
    ['/repos/o/r/pulls/12', pull],
  ])
  const good = await ciRun(cleanClient, { owner: 'o', repo: 'r', number: 12 })
  assert.equal(good.verdict, 'success')
})
