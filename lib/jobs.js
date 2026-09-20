// Long reviews as background jobs.
//
// A review of a big pull request can take a while, and a turn should not sit and wait for
// it. When the host exposes a job registry (`ctx.jobs`) the work runs there, where the UI
// can show it and cancel it; otherwise it runs in this plugin's own registry, so the feature
// degrades to "works, just without the host UI" instead of "missing".
//
// Records are kept in memory, bounded, and never contain the access value.

export const REVIEW_JOB_KIND = 'github-review'
const DEFAULT_RECORD_LIMIT = 20

/** Bounded record store for started jobs. */
export function createRecords({ limit = DEFAULT_RECORD_LIMIT } = {}) {
  const records = new Map()
  return {
    remember(id, record) {
      records.set(id, record)
      while (records.size > limit) {
        const oldest = records.keys().next().value
        records.delete(oldest)
      }
      return id
    },
    get(id) {
      return records.get(id) || null
    },
    list() {
      return [...records.entries()].map(([id, record]) => ({ id, ...record }))
    },
    get size() {
      return records.size
    },
  }
}

function splitRepo(repo) {
  const [owner, name] = String(repo || '').split('/')
  if (!owner || !name) throw new Error(`"${repo}" is not an owner/repo pair`)
  return { owner, repo: name }
}

/**
 * Start one review job.
 *
 * @param registry - host job registry (ctx.jobs) when available
 * @param records - record store from createRecords()
 * @param spec - { repo, pr, label, owner, timeoutMs, maxDiffChars, rules, client, ciRun }
 * @returns the job id
 */
export function startReviewJob({ registry, records, repo, pr, label, owner, timeoutMs = 120000, maxDiffChars, rules, client, ciRun }) {
  const target = splitRepo(repo)
  const record = {
    kind: REVIEW_JOB_KIND,
    status: 'running',
    repo,
    pr,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    report: null,
    error: null,
  }

  const run = async () => {
    try {
      const clientInstance = typeof client === 'function' ? await client() : client
      const report = await ciRun(clientInstance, { ...target, number: pr, maxDiffChars, rules })
      record.status = 'done'
      record.report = report
      record.finishedAt = new Date().toISOString()
      return report
    } catch (err) {
      record.status = 'failed'
      record.error = String((err && err.message) || err)
      record.finishedAt = new Date().toISOString()
      throw err
    }
  }

  const useHost = registry && typeof registry.start === 'function'
  const id = useHost
    ? registry.start({
      kind: REVIEW_JOB_KIND,
      label: label || `${REVIEW_JOB_KIND} ${repo}#${pr}`,
      owner,
      timeoutMs,
      outputLimitBytes: 64 * 1024,
      run,
    })
    : `local-${Date.now().toString(36)}-${records.size + 1}`

  records.remember(id, record)
  if (!useHost) {
    // no host registry: run it in the background, but never let a rejection escape
    Promise.resolve().then(run).catch(() => {})
  }
  return id
}

/** One-line status for the model, derived from a record. */
export function describeRecord(record) {
  if (!record) return 'unknown job'
  if (record.status === 'running') return `running: review of ${record.repo}#${record.pr}`
  if (record.status === 'failed') return `failed: review of ${record.repo}#${record.pr} — ${record.error}`
  const verdict = record.report && record.report.verdict ? record.report.verdict : 'done'
  return `${verdict}: review of ${record.repo}#${record.pr}`
}
