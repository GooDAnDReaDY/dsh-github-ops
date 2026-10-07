import { registerCollabTools } from '../lib/tools/register-collab.js'
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
  listReviewThreads,
  replyReviewThread,
  resolveReviewThread,
  parseSuggestionBlock,
  applySuggestion,
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
  assert.ok(areas.includes('sensitive-paths'), 'paths needing a human eye are flagged as critical')
  assert.ok(areas.includes('migration'))
  assert.ok(areas.includes('attention-paths'), 'CI config and internal documents need attention')
  assert.ok(areas.includes('tests'), 'source changed without tests is flagged')
  assert.equal(pack.findings.find((f) => f.area === 'sensitive-paths').level, 'critical')
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

test('listReviewThreads queries GraphQL, normalizes threads and filters unresolved', async () => {
  const threadsData = {
    repository: {
      pullRequest: {
        reviewThreads: {
          nodes: [
            {
              id: 'thread_1',
              isResolved: false,
              isOutdated: false,
              path: 'lib/index.js',
              line: 42,
              diffSide: 'RIGHT',
              resolvedBy: null,
              comments: {
                nodes: [
                  {
                    id: 'comment_node_1',
                    databaseId: 1001,
                    author: { login: 'reviewer' },
                    body: 'Please check this line',
                    createdAt: '2026-09-24T12:00:00Z',
                    url: 'https://github.com/o/r/pull/12#comment-1',
                  },
                ],
              },
            },
            {
              id: 'thread_2',
              isResolved: true,
              isOutdated: true,
              path: 'lib/old.js',
              line: 10,
              diffSide: 'LEFT',
              resolvedBy: { login: 'octocat' },
              comments: { nodes: [] },
            },
          ],
        },
      },
    },
  }
  const client = {
    graphql: async (query, vars) => {
      assert.equal(vars.owner, 'o')
      assert.equal(vars.repo, 'r')
      assert.equal(vars.number, 12)
      return threadsData
    },
  }

  const all = await listReviewThreads(client, { owner: 'o', repo: 'r', number: 12 })
  assert.equal(all.count, 2)
  assert.equal(all.threads[0].id, 'thread_1')
  assert.equal(all.threads[0].isResolved, false)
  assert.equal(all.threads[0].comments[0].author, 'reviewer')

  const unresolved = await listReviewThreads(client, { owner: 'o', repo: 'r', number: 12, unresolvedOnly: true })
  assert.equal(unresolved.count, 1)
  assert.equal(unresolved.threads[0].id, 'thread_1')
})

test('replyReviewThread replies via GraphQL threadId mutation or REST commentId', async () => {
  let graphqlCalled = false
  const client = {
    ...clientDouble([
      ['/repos/o/r/pulls/12/comments', { id: 2002, created_at: '2026-09-24T12:05:00Z' }],
    ]),
    graphql: async (query, vars) => {
      graphqlCalled = true
      assert.equal(vars.threadId, 'thread_1')
      assert.equal(vars.body, 'Fixed now')
      return {
        addPullRequestReviewThreadReply: {
          comment: { id: 'c_1', databaseId: 3003, body: 'Fixed now', createdAt: '2026-09-24T12:05:00Z' },
        },
      }
    },
  }

  const res1 = await replyReviewThread(client, {
    owner: 'o', repo: 'r', threadId: 'thread_1', body: 'Fixed now',
  })
  assert.equal(res1.replied, true)
  assert.equal(res1.threadId, 'thread_1')
  assert.equal(res1.commentId, 3003)
  assert.equal(graphqlCalled, true)

  const res2 = await replyReviewThread(client, {
    owner: 'o', repo: 'r', number: 12, commentId: 1001, body: 'Acknowledged',
  })
  assert.equal(res2.replied, true)
  assert.equal(res2.commentId, 2002)
  assert.equal(client.calls[0].path, '/repos/o/r/pulls/12/comments')
  assert.equal(client.calls[0].body.in_reply_to, 1001)
})

test('resolveReviewThread resolves and unresolves via GraphQL', async () => {
  const calls = []
  const client = {
    graphql: async (query, vars) => {
      calls.push({ query, vars })
      const isResolve = !query.includes('unresolveReviewThread')
      return {
        [isResolve ? 'resolveReviewThread' : 'unresolveReviewThread']: {
          thread: { id: vars.threadId, isResolved: isResolve },
        },
      }
    },
  }

  const resolved = await resolveReviewThread(client, { owner: 'o', repo: 'r', threadId: 'thread_1', resolve: true })
  assert.equal(resolved.isResolved, true)
  assert.ok(calls[0].query.includes('resolveReviewThread('))

  const unresolved = await resolveReviewThread(client, { owner: 'o', repo: 'r', threadId: 'thread_1', resolve: false })
  assert.equal(unresolved.isResolved, false)
  assert.ok(calls[1].query.includes('unresolveReviewThread('))
})

test('resolveReviewThread throws when mutation returns no thread', async () => {
  const client = {
    graphql: async () => ({ resolveReviewThread: { thread: null } }),
  }
  await assert.rejects(
    () => resolveReviewThread(client, { owner: 'o', repo: 'r', threadId: 'bad_thread', resolve: true }),
    /mutation returned no thread/
  )
})

test('parseSuggestionBlock extracts single, multi-line and empty suggestion blocks', () => {
  assert.equal(parseSuggestionBlock('```suggestion\nconst x = 1\n```'), 'const x = 1')
  assert.equal(parseSuggestionBlock('Text before\n```suggestion\nline1\nline2\n```\nText after'), 'line1\nline2')
  assert.equal(parseSuggestionBlock('```suggestion\n```'), '')
  assert.equal(parseSuggestionBlock('No suggestion here'), null)
  assert.equal(parseSuggestionBlock(''), null)
})

test('applySuggestion modifies target file, commits with reviewer attribution and pushes', async () => {
  const client = clientDouble([
    ['/repos/o/r/pulls/12', { number: 12, state: 'open', head: { ref: 'main', sha: 'head1' } }],
    ['/repos/o/r/pulls/comments/501', {
      id: 501,
      body: '```suggestion\nconst answer = 42\n```',
      path: 'lib/ans.js',
      line: 2,
      user: { login: 'reviewer' },
    }],
    ['/repos/o/r/contents/lib/ans.js', {
      content: Buffer.from('const question = 1\nconst answer = 0\nexport default answer\n').toString('base64'),
    }],
    ['/repos/o/r/git/ref/heads/main', { object: { sha: 'commit123' } }],
    ['/repos/o/r/git/commits/commit123', { tree: { sha: 'tree123' } }],
    ['/repos/o/r/git/blobs', { sha: 'blob123' }],
    ['/repos/o/r/git/trees', { sha: 'newtree123' }],
    ['/repos/o/r/git/commits', { sha: 'newcommit123' }],
    ['/repos/o/r/git/refs/heads/main', {}],
  ])

  const res = await applySuggestion(client, {
    owner: 'o',
    repo: 'r',
    pullNumber: 12,
    commentId: 501,
    confirm: true,
  })

  assert.equal(res.applied, true)
  assert.equal(res.commit, 'newcommit123')
  assert.equal(res.branch, 'main')
  assert.deepEqual(res.files, ['lib/ans.js'])

  const commitCall = client.calls.find((c) => c.method === 'POST' && c.path === '/repos/o/r/git/commits')
  assert.ok(commitCall.body.message.includes('Apply suggestion from @reviewer'))
  assert.ok(commitCall.body.message.includes('Refs: #12'))
})

test('applySuggestion refuses without confirm, on closed PR or when comment is outdated', async () => {
  const client = clientDouble([
    ['/repos/o/r/pulls/12', { number: 12, state: 'closed', head: { ref: 'feat/test' } }],
    ['/repos/o/r/pulls/comments/501', { id: 501, body: '```suggestion\nx\n```', line: 1 }],
  ])

  await assert.rejects(
    () => applySuggestion(client, { owner: 'o', repo: 'r', pullNumber: 12, commentId: 501, confirm: false }),
    /refusing to apply suggestion without confirm: true/
  )

  await assert.rejects(
    () => applySuggestion(client, { owner: 'o', repo: 'r', pullNumber: 12, commentId: 501, confirm: true }),
    /pull request #12 is not open/
  )

  const outdatedClient = clientDouble([
    ['/repos/o/r/pulls/13', { number: 13, state: 'open', head: { ref: 'feat/test' } }],
    ['/repos/o/r/pulls/comments/502', { id: 502, body: '```suggestion\nx\n```', line: 1, position: null, original_position: 1 }],
  ])

  await assert.rejects(
    () => applySuggestion(outdatedClient, { owner: 'o', repo: 'r', pullNumber: 13, commentId: 502, confirm: true }),
    /comment #502 is outdated/
  )
})
test('registerCollabTools registers pr_apply_suggestion', () => {
  const tools = {}
  registerCollabTools({
    tool: (name, desc, schema, fn) => { tools[name] = { desc, schema, fn } },
    asRepo: (args, fn) => fn(args),
    client: async () => ({}),
    liveConfig: () => ({}),
    git: async () => ({ code: 0 }),
    defaultCwd: () => '/repo',
  })
  assert.ok(tools.pr_apply_suggestion)
})
