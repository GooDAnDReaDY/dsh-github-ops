// GitHub Actions: workflow runs, their jobs and steps, rerun/cancel, and the logs
// archive URL (a redirect to a zip — the tool returns the URL instead of downloading
// a binary into the conversation).

function ensureRepo({ owner, repo }) {
  if (!owner || !repo) {
    throw new Error('owner and repo are required (pass "repository": "owner/repo" or set defaults in settings)')
  }
}

export function normalizeRun(data) {
  if (!data || typeof data !== 'object') return data
  return {
    id: data.id,
    name: data.name,
    displayTitle: data.display_title,
    workflow: data.workflow_id,
    event: data.event,
    status: data.status,
    conclusion: data.conclusion,
    branch: data.head_branch,
    sha: data.head_sha,
    attempt: data.run_attempt,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    url: data.html_url,
    actor: data.actor && data.actor.login,
  }
}

export async function listRuns(client, { owner, repo, branch, workflow, status, limit = 20 }) {
  ensureRepo({ owner, repo })
  const capped = Math.max(1, Math.min(Number(limit) || 20, 100))
  const route = workflow
    ? `/repos/${owner}/${repo}/actions/workflows/${encodeURIComponent(workflow)}/runs`
    : `/repos/${owner}/${repo}/actions/runs`
  const query = { per_page: capped }
  if (branch) query.branch = branch
  if (status) query.status = status
  const { data } = await client.get(route, { query })
  const runs = ((data && data.workflow_runs) || []).map(normalizeRun).slice(0, capped)
  return { runs, count: runs.length, total: (data && data.total_count) || runs.length }
}

export async function getRun(client, { owner, repo, runId }) {
  ensureRepo({ owner, repo })
  if (!runId) throw new Error('runId is required')
  const { data } = await client.get(`/repos/${owner}/${repo}/actions/runs/${runId}`)
  return normalizeRun(data)
}

/** Jobs with their steps: what actually failed, without parsing a log archive. */
export async function listRunJobs(client, { owner, repo, runId }) {
  ensureRepo({ owner, repo })
  if (!runId) throw new Error('runId is required')
  const { data } = await client.get(`/repos/${owner}/${repo}/actions/runs/${runId}/jobs`, {
    query: { per_page: 100 },
  })
  const jobs = ((data && data.jobs) || []).map((job) => ({
    id: job.id,
    name: job.name,
    status: job.status,
    conclusion: job.conclusion,
    startedAt: job.started_at,
    completedAt: job.completed_at,
    url: job.html_url,
    failedSteps: (job.steps || [])
      .filter((s) => s.conclusion && !['success', 'skipped', 'neutral'].includes(s.conclusion))
      .map((s) => ({ number: s.number, name: s.name, conclusion: s.conclusion })),
  }))
  return { jobs, count: jobs.length }
}

export async function rerunRun(client, { owner, repo, runId, failedOnly = false }) {
  ensureRepo({ owner, repo })
  if (!runId) throw new Error('runId is required')
  const path = failedOnly
    ? `/repos/${owner}/${repo}/actions/runs/${runId}/rerun-failed-jobs`
    : `/repos/${owner}/${repo}/actions/runs/${runId}/rerun`
  await client.post(path, {})
  return { rerun: true, runId, failedOnly: Boolean(failedOnly) }
}

export async function cancelRun(client, { owner, repo, runId }) {
  ensureRepo({ owner, repo })
  if (!runId) throw new Error('runId is required')
  await client.post(`/repos/${owner}/${repo}/actions/runs/${runId}/cancel`, {})
  return { cancelled: true, runId }
}

/**
 * Where the run logs live. GitHub answers the logs endpoint with a redirect to a zip,
 * so the tool returns the URL (short-lived, needs the token to download) instead of
 * pulling a binary into the conversation.
 */
export async function getRunLogsUrl(client, { owner, repo, runId }) {
  ensureRepo({ owner, repo })
  if (!runId) throw new Error('runId is required')
  const { location, status } = await client.getRedirect(`/repos/${owner}/${repo}/actions/runs/${runId}/logs`)
  return {
    runId,
    downloadUrl: location || '',
    note: location
      ? 'The archive is a zip and needs the same token to download; open it outside the conversation.'
      : `GitHub answered HTTP ${status} without a download location — the logs may have expired.`,
  }
}

export async function dispatchWorkflow(client, { owner, repo, workflow, ref, inputs }) {
  ensureRepo({ owner, repo })
  if (!workflow) throw new Error('workflow is required (file name like "release.yml" or numeric id)')
  if (!ref) throw new Error('ref is required (branch or tag name like "main")')
  const payload = { ref: String(ref) }
  if (inputs && typeof inputs === 'object') {
    const formatted = {}
    for (const [k, v] of Object.entries(inputs)) {
      if (v !== undefined && v !== null) {
        formatted[k] = typeof v === 'string' ? v : String(v)
      }
    }
    payload.inputs = formatted
  }
  const route = `/repos/${owner}/${repo}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`
  await client.post(route, payload)
  return {
    dispatched: true,
    workflow: String(workflow),
    ref: String(ref),
    inputs: payload.inputs || {},
  }
}

export function cleanLogContent(rawText, maxLines = 100) {
  if (!rawText || typeof rawText !== 'string') return []
  const stripped = rawText.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '').replace(/\r/g, '')
  const lines = stripped.split('\n')
  const masked = lines.map((line) => {
    return line
      .replace(/(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}/g, '[REDACTED_TOKEN]')
      .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED_TOKEN]')
  })
  const cap = Math.max(1, Math.min(Number(maxLines) || 100, 250))
  return masked.slice(-cap)
}

export async function getJobLogSummary(client, { owner, repo, runId, jobId, maxLines = 100 }) {
  ensureRepo({ owner, repo })
  let targetJobId = jobId
  let targetJobName = ''
  let failedStep = null

  if (!targetJobId) {
    if (!runId) throw new Error('either runId or jobId is required')
    const { jobs } = await listRunJobs(client, { owner, repo, runId })
    const failedJob = jobs.find((j) => j.conclusion === 'failure') || jobs[0]
    if (!failedJob) {
      return { note: `No jobs found for run ${runId}`, lines: [] }
    }
    targetJobId = failedJob.id
    targetJobName = failedJob.name
    failedStep = (failedJob.failedSteps && failedJob.failedSteps[0]) || null
  }

  let logText = ''
  try {
    const res = await client.getRaw(`/repos/${owner}/${repo}/actions/jobs/${targetJobId}/logs`)
    logText = typeof res === 'string' ? res : (res && res.data ? res.data : String(res || ''))
  } catch (err) {
    return {
      jobId: targetJobId,
      jobName: targetJobName,
      error: `Could not retrieve logs: ${err && err.message}`,
      lines: [],
    }
  }

  const lines = cleanLogContent(logText, maxLines)
  return {
    jobId: targetJobId,
    jobName: targetJobName,
    failedStep,
    lineCount: lines.length,
    lines,
  }
}
