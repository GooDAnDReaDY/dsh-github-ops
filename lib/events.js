// Server-Sent Events (SSE) notification manager for CI runs and PR events.
//
// Maintains client subscriptions, broadcasts real-time events, and runs an adaptive
// background polling loop only when at least one client is connected, conserving
// GitHub API rate limits.

import { listRuns } from './tools/actions.js'
import { listIssues } from './tools/issues.js'

export class SseEventManager {
  constructor({ client, liveConfig, describeError, baseIntervalMs = 60000, activeIntervalMs = 15000 } = {}) {
    this.client = client || (async () => null)
    this.liveConfig = liveConfig || (() => ({}))
    this.describeError = describeError || ((e) => String((e && e.message) || e))
    this.baseIntervalMs = baseIntervalMs
    this.activeIntervalMs = activeIntervalMs

    this.clients = new Set()
    this.timer = null
    this.isPolling = false
    this.lastRuns = new Map() // runId -> { status, conclusion }
    this.lastPulls = new Map() // pullNumber -> { updated, state }
    this.hasActiveWork = false
  }

  get clientCount() {
    return this.clients.size
  }

  addClient(res, req) {
    this.clients.add(res)

    try {
      res.write(': connected\n\n')
      res.write(`data: ${JSON.stringify({ type: 'connected', clients: this.clients.size, timestamp: Date.now() })}\n\n`)
    } catch {
      this.clients.delete(res)
      return
    }

    if (req) {
      req.on('close', () => {
        this.removeClient(res)
      })
    }

    if (this.clients.size === 1) {
      this.startPolling()
    }
  }

  removeClient(res) {
    this.clients.delete(res)
    if (this.clients.size === 0) {
      this.stopPolling()
    }
  }

  broadcast(event, data) {
    if (this.clients.size === 0) return
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    for (const res of Array.from(this.clients)) {
      try {
        res.write(payload)
      } catch {
        this.clients.delete(res)
      }
    }
    if (this.clients.size === 0) {
      this.stopPolling()
    }
  }

  startPolling() {
    if (this.timer) return
    this.scheduleNext(1000)
  }

  stopPolling() {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  scheduleNext(delayMs) {
    if (this.timer) clearTimeout(this.timer)
    if (this.clients.size === 0) return
    const delay = typeof delayMs === 'number' ? delayMs : (this.hasActiveWork ? this.activeIntervalMs : this.baseIntervalMs)
    this.timer = setTimeout(() => {
      this.poll().finally(() => {
        if (this.clients.size > 0) {
          this.scheduleNext()
        }
      })
    }, delay)
    if (this.timer && typeof this.timer.unref === 'function') {
      this.timer.unref()
    }
  }

  async poll() {
    if (this.isPolling) return
    this.isPolling = true
    try {
      const cfg = this.liveConfig()
      const owner = cfg.owner
      const repo = cfg.repo
      if (!owner || !repo) {
        this.hasActiveWork = false
        return
      }

      const github = await this.client()
      if (!github) {
        this.hasActiveWork = false
        return
      }

      // 1. Check CI workflow runs
      let runs = []
      try {
        const runsResult = await listRuns(github, { owner, repo, limit: 10 })
        runs = (runsResult && runsResult.runs) || []
      } catch {
        // ignore fetch error during polling
      }

      let activeRunsFound = false
      for (const run of runs) {
        const id = run.id
        const status = run.status
        const conclusion = run.conclusion
        if (status === 'in_progress' || status === 'queued') {
          activeRunsFound = true
        }
        const previous = this.lastRuns.get(id)
        if (previous) {
          if (previous.status !== status || previous.conclusion !== conclusion) {
            this.broadcast('ci_status', {
              id,
              name: run.name,
              status,
              conclusion,
              html_url: run.html_url,
              head_branch: run.head_branch,
              head_sha: run.head_sha ? run.head_sha.slice(0, 7) : '',
              timestamp: Date.now(),
            })
          }
        }
        this.lastRuns.set(id, { status, conclusion })
      }

      // 2. Check open Pull Requests
      let pulls = []
      try {
        const pullsResult = await listIssues(github, { owner, repo, kind: 'pr', state: 'open', limit: 10 })
        pulls = (pullsResult && pullsResult.issues) || []
      } catch {
        // ignore fetch error during polling
      }

      for (const pr of pulls) {
        const number = pr.number
        const previous = this.lastPulls.get(number)
        const updated = pr.updatedAt || pr.updated_at || pr.updated
        if (previous && previous.updated !== updated) {
          this.broadcast('pr_status', {
            number,
            title: pr.title,
            state: pr.state,
            user: pr.author || (pr.user && pr.user.login) || '',
            updated_at: updated,
            html_url: pr.html_url || '',
            timestamp: Date.now(),
          })
        }
        this.lastPulls.set(number, { updated, state: pr.state })
      }

      this.hasActiveWork = activeRunsFound
    } catch {
      // do not crash on polling errors
    } finally {
      this.isPolling = false
    }
  }

  destroy() {
    this.stopPolling()
    for (const res of this.clients) {
      try {
        res.end()
      } catch {}
    }
    this.clients.clear()
    this.lastRuns.clear()
    this.lastPulls.clear()
  }
}
