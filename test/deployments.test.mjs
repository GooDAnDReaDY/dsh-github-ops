import test from 'node:test'
import assert from 'node:assert/strict'

import {
  listEnvironments,
  listDeployments,
  createDeployment,
  listDeploymentStatuses,
  createDeploymentStatus,
} from '../lib/tools/deployments.js'

function clientDouble(routes = {}) {
  const calls = []
  const answer = (method, path, body) => {
    calls.push({ method, path, body })
    let best = null
    let bestLength = -1
    for (const [key, value] of Object.entries(routes)) {
      const [routeMethod, fragment] = key.split(' ')
      if (routeMethod !== method || !path.includes(fragment)) continue
      if (fragment.length > bestLength) {
        best = value
        bestLength = fragment.length
      }
    }
    return typeof best === 'function' ? best(path, body) : (best || { data: {} })
  }
  return {
    calls,
    get: async (path, opts) => answer('GET', path, opts),
    post: async (path, body) => answer('POST', path, body),
  }
}

test('listEnvironments retrieves environments and maps protection rules', async () => {
  const client = clientDouble({
    'GET /repos/o/r/environments': {
      data: {
        total_count: 2,
        environments: [
          {
            id: 1,
            name: 'production',
            html_url: 'https://github.com/o/r/environments/production',
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-02T00:00:00Z',
            protection_rules: [{ id: 10, type: 'wait_timer', wait_timer: 15 }],
          },
          { id: 2, name: 'staging', protection_rules: [] },
        ],
      },
    },
  })

  const res = await listEnvironments(client, { owner: 'o', repo: 'r' })
  assert.equal(res.totalCount, 2)
  assert.equal(res.environments.length, 2)
  assert.equal(res.environments[0].name, 'production')
  assert.equal(res.environments[0].protectionRulesCount, 1)
  assert.equal(res.environments[0].protectionRules[0].waitTimer, 15)
})

test('listDeployments queries deployments with environment and ref filter', async () => {
  let capturedQuery = null
  const client = {
    calls: [],
    get: async (path, opts) => {
      capturedQuery = opts?.query
      return {
        data: [
          {
            id: 100,
            sha: 'abcdef123456',
            ref: 'main',
            task: 'deploy',
            environment: 'production',
            creator: { login: 'octocat' },
            created_at: '2026-01-01T00:00:00Z',
          },
        ],
      }
    },
  }

  const res = await listDeployments(client, { owner: 'o', repo: 'r', environment: 'production', ref: 'main' })
  assert.equal(capturedQuery.environment, 'production')
  assert.equal(capturedQuery.ref, 'main')
  assert.equal(res.deployments.length, 1)
  assert.equal(res.deployments[0].creator, 'octocat')
})

test('createDeployment creates deployment and validates required ref', async () => {
  await assert.rejects(
    () => createDeployment({}, { owner: 'o', repo: 'r' }),
    /ref is required/
  )

  let postedPayload = null
  const client = {
    post: async (path, body) => {
      postedPayload = body
      return {
        data: {
          id: 555,
          sha: '112233445566',
          ref: body.ref,
          environment: body.environment,
          created_at: '2026-01-01T00:00:00Z',
        },
      }
    },
  }

  const res = await createDeployment(client, {
    owner: 'o',
    repo: 'r',
    ref: 'v1.0.0',
    environment: 'production',
    description: 'Ship v1.0.0',
    autoMerge: false,
    requiredContexts: ['ci/test'],
  })

  assert.equal(res.id, 555)
  assert.equal(postedPayload.ref, 'v1.0.0')
  assert.equal(postedPayload.auto_merge, false)
  assert.deepEqual(postedPayload.required_contexts, ['ci/test'])
})

test('createDeploymentStatus validates state and posts status update', async () => {
  await assert.rejects(
    () => createDeploymentStatus({}, { owner: 'o', repo: 'r', deploymentId: 555, state: 'invalid_state' }),
    /state must be one of/
  )

  let postedPayload = null
  const client = {
    post: async (path, body) => {
      postedPayload = body
      return {
        data: {
          id: 999,
          state: body.state,
          description: body.description,
          environment_url: body.environment_url,
          created_at: '2026-01-01T00:00:00Z',
        },
      }
    },
  }

  const res = await createDeploymentStatus(client, {
    owner: 'o',
    repo: 'r',
    deploymentId: 555,
    state: 'success',
    description: 'Deployment live on MiniAI',
    environmentUrl: 'https://goodandready.app',
  })

  assert.equal(res.id, 999)
  assert.equal(res.state, 'success')
  assert.equal(postedPayload.state, 'success')
  assert.equal(postedPayload.environment_url, 'https://goodandready.app')
})
