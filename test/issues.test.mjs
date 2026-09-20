import test from 'node:test'
import assert from 'node:assert/strict'

import {
  listIssues,
  getIssue,
  createIssue,
  commentIssue,
  closeIssue,
  searchIssues,
} from '../lib/tools/issues.js'

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
  }
}

const issue = {
  number: 7,
  title: 'bug',
  state: 'open',
  user: { login: 'octocat' },
  labels: [{ name: 'type/bug' }],
  assignees: [{ login: 'me' }],
  comments: 2,
  html_url: 'https://github.com/o/r/issues/7',
  body: 'details',
}

const pullRequest = { ...issue, number: 8, title: 'pr', pull_request: { url: 'x' } }

test('listIssues marks pull requests and filters by kind', async () => {
  const client = clientDouble([['/repos/o/r/issues', [issue, pullRequest]]])
  const all = await listIssues(client, { owner: 'o', repo: 'r' })
  assert.equal(all.count, 2)
  assert.equal(all.issues[0].kind, 'issue')
  assert.equal(all.issues[1].kind, 'pr')

  const onlyPr = await listIssues(client, { owner: 'o', repo: 'r', kind: 'pr' })
  assert.equal(onlyPr.count, 1)
  assert.equal(onlyPr.issues[0].number, 8)

  const onlyIssues = await listIssues(client, { owner: 'o', repo: 'r', kind: 'issue' })
  assert.equal(onlyIssues.count, 1)
  assert.equal(onlyIssues.issues[0].number, 7)
})

test('listIssues passes state and labels and caps the page size', async () => {
  const client = clientDouble([['/repos/o/r/issues', []]])
  await listIssues(client, { owner: 'o', repo: 'r', state: 'all', labels: ['a', 'b'], limit: 500 })
  const query = client.calls[0].opts.query
  assert.equal(query.state, 'all')
  assert.equal(query.labels, 'a,b')
  assert.equal(query.per_page, 100)
})

test('getIssue can include the comment list', async () => {
  const client = clientDouble([
    ['/repos/o/r/issues/7/comments', [{ id: 1, user: { login: 'me' }, created_at: 'now', body: 'hi' }]],
    ['/repos/o/r/issues/7', issue],
  ])
  const plain = await getIssue(client, { owner: 'o', repo: 'r', number: 7 })
  assert.equal(plain.number, 7)
  assert.equal(plain.commentList, undefined)

  const withComments = await getIssue(client, { owner: 'o', repo: 'r', number: 7, includeComments: true })
  assert.equal(withComments.commentList.length, 1)
  assert.equal(withComments.commentList[0].author, 'me')
})

test('createIssue sends title, body, labels and assignees', async () => {
  const client = clientDouble([['/repos/o/r/issues', issue]])
  await createIssue(client, { owner: 'o', repo: 'r', title: 'bug', body: 'x', labels: ['a'], assignees: ['me'] })
  assert.deepEqual(client.calls[0].body, { title: 'bug', body: 'x', labels: ['a'], assignees: ['me'] })
  await assert.rejects(() => createIssue(client, { owner: 'o', repo: 'r' }), /title is required/)
})

test('commentIssue requires a body and returns the comment identity', async () => {
  const client = clientDouble([['/repos/o/r/issues/7/comments', { id: 5, html_url: 'u', created_at: 't' }]])
  const result = await commentIssue(client, { owner: 'o', repo: 'r', number: 7, body: 'ping' })
  assert.deepEqual(result, { id: 5, url: 'u', createdAt: 't' })
  await assert.rejects(() => commentIssue(client, { owner: 'o', repo: 'r', number: 7, body: '' }), /body is required/)
})

test('closeIssue sends the state and an optional reason', async () => {
  const client = clientDouble([['/repos/o/r/issues/7', { ...issue, state: 'closed', state_reason: 'completed' }]])
  const closed = await closeIssue(client, { owner: 'o', repo: 'r', number: 7, stateReason: 'completed' })
  assert.equal(closed.state, 'closed')
  assert.deepEqual(client.calls[0].body, { state: 'closed', state_reason: 'completed' })
})

test('searchIssues returns the total and the repository of each hit', async () => {
  const client = clientDouble([['/search/issues', {
    total_count: 1,
    items: [{ ...issue, repository_url: 'https://api.github.com/repos/o/r' }],
  }]])
  const result = await searchIssues(client, { query: 'repo:o/r is:open bug' })
  assert.equal(result.total, 1)
  assert.equal(result.issues[0].repository, 'o/r')
  await assert.rejects(() => searchIssues(client, {}), /query is required/)
})
