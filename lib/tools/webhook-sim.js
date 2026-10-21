// Webhook Simulator and Local Event Emitter.
// Generates canonical GitHub webhook payloads and emits to local SSE event bus.

import { randomUUID } from 'node:crypto'
import { getGlobalEventManager } from '../events.js'

/** Canonical mock payload generator for GitHub webhook events. */
export function buildCanonicalWebhookPayload({
  event = 'issues',
  action = 'opened',
  owner = 'goodandready',
  repo = 'dsh-github-ops',
  data = {},
} = {}) {
  const deliveryId = randomUUID()
  const timestamp = new Date().toISOString()
  const repoFullName = `${owner}/${repo}`

  const baseRepo = {
    id: 123456789,
    node_id: 'MDEwOlJlcG9zaXRvcnkxMjM0NTY3ODk=',
    name: repo,
    full_name: repoFullName,
    private: false,
    owner: {
      login: owner,
      id: 9876543,
      avatar_url: 'https://avatars.githubusercontent.com/u/9876543?v=4',
      html_url: `https://github.com/${owner}`,
    },
    html_url: `https://github.com/${repoFullName}`,
    default_branch: 'main',
  }

  const sender = {
    login: 'agent-antigravity',
    id: 424242,
    avatar_url: 'https://avatars.githubusercontent.com/u/424242?v=4',
    html_url: 'https://github.com/agent-antigravity',
  }

  let eventPayload = {}

  switch (event) {
    case 'issues': {
      eventPayload = {
        action,
        issue: {
          id: 1001,
          number: 42,
          title: 'Example Issue from Webhook Simulator',
          user: sender,
          labels: [{ id: 1, name: 'bug', color: 'd73a4a' }],
          state: action === 'closed' ? 'closed' : 'open',
          comments: 0,
          created_at: timestamp,
          updated_at: timestamp,
          body: 'This is a simulated issue payload for testing.',
          html_url: `https://github.com/${repoFullName}/issues/42`,
        },
        repository: baseRepo,
        sender,
      }
      break
    }

    case 'pull_request': {
      eventPayload = {
        action,
        number: 101,
        pull_request: {
          id: 2002,
          number: 101,
          state: action === 'closed' ? 'closed' : 'open',
          title: 'feat: simulated pull request payload',
          user: sender,
          body: 'Simulated PR body for local testing.',
          created_at: timestamp,
          updated_at: timestamp,
          head: {
            label: `${owner}:feature-sim`,
            ref: 'feature-sim',
            sha: '0123456789abcdef0123456789abcdef01234567',
          },
          base: {
            label: `${owner}:main`,
            ref: 'main',
            sha: 'abcdef0123456789abcdef0123456789abcdef01',
          },
          merged: action === 'closed',
          html_url: `https://github.com/${repoFullName}/pull/101`,
        },
        repository: baseRepo,
        sender,
      }
      break
    }

    case 'workflow_run': {
      eventPayload = {
        action,
        workflow_run: {
          id: 3003,
          name: 'CI Build & Test',
          head_branch: 'main',
          head_sha: '0123456789abcdef0123456789abcdef01234567',
          status: action === 'completed' ? 'completed' : 'in_progress',
          conclusion: action === 'completed' ? 'success' : null,
          html_url: `https://github.com/${repoFullName}/actions/runs/3003`,
          created_at: timestamp,
          updated_at: timestamp,
        },
        repository: baseRepo,
        sender,
      }
      break
    }

    case 'release': {
      eventPayload = {
        action,
        release: {
          id: 4004,
          tag_name: 'v1.0.0',
          name: 'Release v1.0.0',
          draft: false,
          prerelease: false,
          created_at: timestamp,
          published_at: timestamp,
          html_url: `https://github.com/${repoFullName}/releases/tag/v1.0.0`,
        },
        repository: baseRepo,
        sender,
      }
      break
    }

    case 'deployment': {
      eventPayload = {
        action,
        deployment: {
          id: 5005,
          sha: '0123456789abcdef0123456789abcdef01234567',
          ref: 'main',
          task: 'deploy',
          environment: 'production',
          description: 'Deploying to production server',
          created_at: timestamp,
          updated_at: timestamp,
        },
        repository: baseRepo,
        sender,
      }
      break
    }

    case 'deployment_status': {
      eventPayload = {
        action,
        deployment_status: {
          id: 6006,
          state: 'success',
          description: 'Deployment finished successfully',
          target_url: 'https://goodandready.app',
          created_at: timestamp,
          updated_at: timestamp,
        },
        deployment: {
          id: 5005,
          environment: 'production',
        },
        repository: baseRepo,
        sender,
      }
      break
    }

    case 'push': {
      eventPayload = {
        ref: 'refs/heads/main',
        before: 'abcdef0123456789abcdef0123456789abcdef01',
        after: '0123456789abcdef0123456789abcdef01234567',
        commits: [
          {
            id: '0123456789abcdef0123456789abcdef01234567',
            message: 'feat: add exciting new capability',
            timestamp,
            author: { name: 'Vadim', email: 'vadim@goodandready.app' },
          },
        ],
        repository: baseRepo,
        sender,
      }
      break
    }

    default: {
      eventPayload = {
        action,
        event,
        repository: baseRepo,
        sender,
      }
    }
  }

  const payload = {
    ...eventPayload,
    ...data,
  }

  return { deliveryId, timestamp, payload }
}

/** Simulate a webhook event, emit to local SSE bus and optionally dispatch to HTTP receiver. */
export async function simulateWebhook({
  event = 'issues',
  action = 'opened',
  owner = 'goodandready',
  repo = 'dsh-github-ops',
  data = {},
  broadcast = true,
  targetUrl,
  eventManager,
  fetchFn = (typeof fetch !== 'undefined' ? fetch : null),
} = {}) {
  const { deliveryId, timestamp, payload } = buildCanonicalWebhookPayload({
    event,
    action,
    owner,
    repo,
    data,
  })

  let broadcastCount = 0
  if (broadcast) {
    const mgr = eventManager || getGlobalEventManager()
    if (mgr && typeof mgr.broadcast === 'function') {
      mgr.broadcast('webhook', {
        event,
        action,
        deliveryId,
        timestamp,
        payload,
      })
      mgr.broadcast(event, payload)
      broadcastCount = mgr.clientCount || 1
    }
  }

  let delivered = false
  let targetStatus = null
  let deliveryError = null

  if (targetUrl && typeof fetchFn === 'function') {
    try {
      const res = await fetchFn(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'GitHub-Hookshot/dsh-github-ops',
          'X-GitHub-Event': event,
          'X-GitHub-Delivery': deliveryId,
          'X-GitHub-Hook-ID': '9999999',
        },
        body: JSON.stringify(payload),
      })
      delivered = Boolean(res && res.ok)
      targetStatus = res ? res.status : null
    } catch (err) {
      deliveryError = String((err && err.message) || err)
    }
  }

  return {
    simulated: true,
    event,
    action,
    deliveryId,
    timestamp,
    broadcasted: broadcast && broadcastCount > 0,
    broadcastClients: broadcastCount,
    targetUrl: targetUrl || null,
    delivered,
    targetStatus,
    deliveryError,
    payload,
  }
}
