import test from 'node:test'
import assert from 'node:assert/strict'

import { syncIssueMirror } from '../lib/tools/triage.js'

test('syncIssueMirror dryRun plans comment sync and detects state mismatch', async () => {
  const ghClient = {
    get: async (path) => {
      if (path.endsWith('/comments')) {
        return { data: [{ id: 1, body: 'GitHub comment 1' }] }
      }
      return { data: { number: 42, state: 'open' } }
    },
  }

  const mockFetch = async (url) => {
    if (url.endsWith('/comments')) {
      return {
        ok: true,
        json: async () => [{ id: 101, body: 'Gitea comment 101', user: { login: 'vadim' } }],
      }
    }
    return {
      ok: true,
      json: async () => ({ number: 120, state: 'closed' }),
    }
  }

  const res = await syncIssueMirror(
    ghClient,
    {
      repository: 'goodandready/dsh-github-ops',
      githubIssueNumber: 42,
      giteaIssueNumber: 120,
      confirm: false,
    },
    { fetchFn: mockFetch }
  )

  assert.equal(res.dryRun, true)
  assert.equal(res.githubState, 'open')
  assert.equal(res.giteaState, 'closed')
  assert.equal(res.stateAction, 'close_github')
  assert.equal(res.pendingGiteaToGithubCount, 1)
  assert.equal(res.pendingGithubToGiteaCount, 1)
})

test('syncIssueMirror confirmed propagates comments with sync markers and updates state', async () => {
  const postedGhComments = []
  let patchedGhState = null
  const ghClient = {
    get: async (path) => {
      if (path.endsWith('/comments')) {
        return {
          data: [
            { id: 1, body: 'Original GH comment' },
            { id: 2, body: 'Already synced\n\n<!-- synced-from: gitea#999 by @vadim -->' },
          ],
        }
      }
      return { data: { number: 42, state: 'open' } }
    },
    post: async (path, body) => {
      postedGhComments.push(body)
      return { data: { id: 3, ...body } }
    },
    patch: async (path, body) => {
      patchedGhState = body.state
      return { data: { state: body.state } }
    },
  }

  const postedGiteaComments = []
  const mockFetch = async (url, opts) => {
    if (opts?.method === 'POST') {
      postedGiteaComments.push(JSON.parse(opts.body))
      return { ok: true, json: async () => ({ id: 200 }) }
    }
    if (url.endsWith('/comments')) {
      return {
        ok: true,
        json: async () => [
          { id: 101, body: 'Fresh Gitea comment', user: { login: 'vadim' } },
          { id: 999, body: 'Old Gitea comment', user: { login: 'vadim' } },
        ],
      }
    }
    return {
      ok: true,
      json: async () => ({ number: 120, state: 'closed' }),
    }
  }

  const res = await syncIssueMirror(
    ghClient,
    {
      repository: 'goodandready/dsh-github-ops',
      githubIssueNumber: 42,
      giteaIssueNumber: 120,
      confirm: true,
    },
    { fetchFn: mockFetch }
  )

  assert.equal(res.success, true)
  assert.equal(res.syncedGiteaToGithub, 1) // Fresh Gitea comment synced (Old 999 was skipped because marker was on GH)
  assert.equal(res.syncedGithubToGitea, 1) // Original GH comment synced
  assert.equal(res.stateAction, 'close_github')
  assert.equal(res.stateSynced, true)
  assert.equal(patchedGhState, 'closed')

  // Check marker in posted comment
  assert.ok(postedGhComments[0].body.includes('synced-from: gitea#101'))
  assert.ok(postedGiteaComments[0].body.includes('synced-from: github#1'))
})
