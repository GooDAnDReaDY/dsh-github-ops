import test from 'node:test'
import assert from 'node:assert/strict'

import {
  formatGiteaDraft,
  isAlreadyTriaged,
  triageExternalIssues,
} from '../lib/tools/triage.js'

test('formatGiteaDraft formats canonical title, body, and labels', () => {
  const bugIssue = {
    number: 42,
    title: 'crash on startup',
    body: 'application throws unhandled error',
    html_url: 'https://github.com/goodandready/my-repo/issues/42',
    user: { login: 'reporter' },
    created_at: '2026-02-01T12:00:00Z',
    labels: [{ name: 'bug' }],
  }

  const draft = formatGiteaDraft({ owner: 'goodandready', repo: 'my-repo', issue: bugIssue })
  assert.equal(draft.title, 'M: fix(ext): crash on startup (GH#42)')
  assert.ok(draft.body.includes('https://github.com/goodandready/my-repo/issues/42'))
  assert.ok(draft.body.includes('@reporter'))
  assert.ok(draft.body.includes('application throws unhandled error'))
  assert.deepEqual(draft.labels, ['priority/medium', 'type/bug', 'status/confirmed'])

  const featIssue = {
    number: 43,
    title: 'critical security vulnerability',
    body: 'security issue',
    html_url: 'https://github.com/goodandready/my-repo/issues/43',
    labels: [{ name: 'security' }],
  }
  const featDraft = formatGiteaDraft({ owner: 'goodandready', repo: 'my-repo', issue: featIssue })
  assert.equal(featDraft.title, 'H: feat(ext): critical security vulnerability (GH#43)')
  assert.deepEqual(featDraft.labels, ['priority/high', 'type/feature', 'status/confirmed'])
})

test('isAlreadyTriaged detects existing Gitea issues by url or GH markers', () => {
  const ghIssue = { number: 10 }
  const giteaIssues = [
    { number: 101, title: 'Existing issue', body: 'Refs: github.com/o/r/issues/10', html_url: 'http://gitea/101' },
    { number: 102, title: 'Another issue (GH#20)', body: 'Details', html_url: 'http://gitea/102' },
  ]

  const match1 = isAlreadyTriaged(ghIssue, giteaIssues, { owner: 'o', repo: 'r' })
  assert.equal(match1.triaged, true)
  assert.equal(match1.giteaIssueNumber, 101)

  const match2 = isAlreadyTriaged({ number: 20 }, giteaIssues, { owner: 'o', repo: 'r' })
  assert.equal(match2.triaged, true)
  assert.equal(match2.giteaIssueNumber, 102)

  const match3 = isAlreadyTriaged({ number: 99 }, giteaIssues, { owner: 'o', repo: 'r' })
  assert.equal(match3.triaged, false)
  assert.equal(match3.giteaIssueNumber, null)
})

test('triageExternalIssues fetches github issues and reports triaged vs pending', async () => {
  const ghIssues = [
    {
      number: 1,
      title: 'First issue',
      state: 'open',
      html_url: 'https://github.com/o/r/issues/1',
      body: 'Bug here',
      labels: [{ name: 'bug' }],
    },
    {
      number: 2,
      title: 'Second issue',
      state: 'open',
      html_url: 'https://github.com/o/r/issues/2',
      body: 'Feature here',
      labels: [],
    },
    {
      number: 3,
      title: 'A pull request',
      state: 'open',
      pull_request: { url: 'https://github.com/o/r/pulls/3' },
    },
  ]

  const client = {
    get: async () => ({ data: ghIssues }),
  }

  const fakeGiteaClient = {
    getIssues: async () => [
      { number: 50, title: 'Already imported [GH-1]', body: '', html_url: 'http://gitea/50' },
    ],
  }

  const result = await triageExternalIssues(client, {
    repository: 'o/r',
    giteaOwner: 'goodandready',
    giteaRepo: 'r',
  }, { giteaClient: fakeGiteaClient })

  assert.equal(result.totalExternalIssues, 2, 'pull request must be filtered out')
  assert.equal(result.triagedCount, 1)
  assert.equal(result.pendingCount, 1)
  assert.equal(result.syncedCount, 0)

  const item1 = result.items.find((i) => i.githubIssueNumber === 1)
  assert.equal(item1.alreadyTriaged, true)
  assert.equal(item1.giteaIssueNumber, 50)

  const item2 = result.items.find((i) => i.githubIssueNumber === 2)
  assert.equal(item2.alreadyTriaged, false)
  assert.equal(item2.giteaIssueNumber, null)
})

test('triageExternalIssues syncs missing issues when sync and confirm are true', async () => {
  const ghIssues = [
    { number: 5, title: 'New bug', state: 'open', html_url: 'https://github.com/o/r/issues/5', labels: [] },
  ]
  const client = { get: async () => ({ data: ghIssues }) }

  const created = []
  const fakeGiteaClient = {
    getIssues: async () => [],
    createIssue: async (args) => {
      created.push(args)
      return { number: 77, html_url: 'http://gitea/77' }
    },
  }

  // Without confirm, it must throw
  await assert.rejects(
    () => triageExternalIssues(client, { repository: 'o/r', sync: true, confirm: false }),
    /confirm: true is required/,
  )

  // With confirm, it syncs
  const res = await triageExternalIssues(client, {
    repository: 'o/r',
    sync: true,
    confirm: true,
  }, { giteaClient: fakeGiteaClient })

  assert.equal(res.syncedCount, 1)
  assert.equal(created.length, 1)
  assert.equal(res.items[0].synced, true)
  assert.equal(res.items[0].giteaIssueNumber, 77)
})
