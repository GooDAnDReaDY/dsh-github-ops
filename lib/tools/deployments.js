// GitHub Environments and Deployments tools.
// Pure functions over a GitHub client.

function ensureRepo({ owner, repo }) {
  if (!owner || !repo) {
    throw new Error('owner and repo are required (pass "repository": "owner/repo" or set defaults in settings)')
  }
}

/** List environments for a repository. */
export async function listEnvironments(client, { owner, repo, limit = 30 } = {}) {
  ensureRepo({ owner, repo })
  const perPage = Math.max(1, Math.min(Number(limit) || 30, 100))
  const { data } = await client.get(`/repos/${owner}/${repo}/environments`, {
    query: { per_page: perPage },
  })
  const envs = data && Array.isArray(data.environments) ? data.environments : []
  return {
    totalCount: data && typeof data.total_count === 'number' ? data.total_count : envs.length,
    environments: envs.map((env) => ({
      id: env.id,
      name: env.name,
      url: env.html_url || '',
      createdAt: env.created_at,
      updatedAt: env.updated_at,
      protectionRulesCount: Array.isArray(env.protection_rules) ? env.protection_rules.length : 0,
      protectionRules: (env.protection_rules || []).map((r) => ({
        id: r.id,
        type: r.type,
        waitTimer: r.wait_timer,
      })),
    })),
  }
}

/** List deployments for a repository. */
export async function listDeployments(client, { owner, repo, environment, ref, sha, task, limit = 30 } = {}) {
  ensureRepo({ owner, repo })
  const perPage = Math.max(1, Math.min(Number(limit) || 30, 100))
  const query = { per_page: perPage }
  if (environment) query.environment = environment
  if (ref) query.ref = ref
  if (sha) query.sha = sha
  if (task) query.task = task

  const { data } = await client.get(`/repos/${owner}/${repo}/deployments`, { query })
  const deployments = Array.isArray(data) ? data : []
  return {
    deployments: deployments.map((d) => ({
      id: d.id,
      sha: d.sha,
      ref: d.ref,
      task: d.task,
      environment: d.environment,
      description: d.description || '',
      creator: d.creator && d.creator.login,
      createdAt: d.created_at,
      updatedAt: d.updated_at,
      url: d.url,
      statusesUrl: d.statuses_url,
    })),
  }
}

/** Create a new deployment for a ref. */
export async function createDeployment(client, {
  owner, repo, ref, environment = 'production', description, task = 'deploy',
  autoMerge = false, requiredContexts = [], transientEnvironment = false,
  productionEnvironment,
} = {}) {
  ensureRepo({ owner, repo })
  if (!ref) throw new Error('ref is required (branch name, tag or commit SHA)')

  const payload = {
    ref,
    environment,
    task,
    auto_merge: Boolean(autoMerge),
    required_contexts: Array.isArray(requiredContexts) ? requiredContexts : [],
    transient_environment: Boolean(transientEnvironment),
  }
  if (typeof productionEnvironment === 'boolean') {
    payload.production_environment = productionEnvironment
  }
  if (description) payload.description = String(description)

  const { data } = await client.post(`/repos/${owner}/${repo}/deployments`, payload)
  return {
    id: data && data.id,
    sha: data && data.sha,
    ref: data && data.ref,
    task: data && data.task,
    environment: data && data.environment,
    description: (data && data.description) || '',
    creator: data && data.creator && data.creator.login,
    createdAt: data && data.created_at,
    url: data && data.url,
    statusesUrl: data && data.statuses_url,
  }
}

/** List deployment statuses. */
export async function listDeploymentStatuses(client, { owner, repo, deploymentId, limit = 30 } = {}) {
  ensureRepo({ owner, repo })
  if (!deploymentId) throw new Error('deploymentId is required')
  const perPage = Math.max(1, Math.min(Number(limit) || 30, 100))
  const { data } = await client.get(`/repos/${owner}/${repo}/deployments/${deploymentId}/statuses`, {
    query: { per_page: perPage },
  })
  const statuses = Array.isArray(data) ? data : []
  return {
    deploymentId,
    statuses: statuses.map((s) => ({
      id: s.id,
      state: s.state,
      description: s.description || '',
      environmentUrl: s.environment_url || '',
      logUrl: s.log_url || '',
      creator: s.creator && s.creator.login,
      createdAt: s.created_at,
    })),
  }
}

/** Create a status for an existing deployment. */
export async function createDeploymentStatus(client, {
  owner, repo, deploymentId, state, logUrl, description, environmentUrl, autoInactive = true,
} = {}) {
  ensureRepo({ owner, repo })
  if (!deploymentId) throw new Error('deploymentId is required')
  const validStates = ['error', 'failure', 'in_progress', 'queued', 'pending', 'success']
  if (!state || !validStates.includes(state)) {
    throw new Error(`state must be one of: ${validStates.join(', ')}`)
  }

  const payload = {
    state,
    auto_inactive: Boolean(autoInactive),
  }
  if (logUrl) payload.log_url = String(logUrl)
  if (description) payload.description = String(description)
  if (environmentUrl) payload.environment_url = String(environmentUrl)

  const { data } = await client.post(`/repos/${owner}/${repo}/deployments/${deploymentId}/statuses`, payload)
  return {
    id: data && data.id,
    deploymentId,
    state: data && data.state,
    description: (data && data.description) || '',
    environmentUrl: (data && data.environment_url) || '',
    logUrl: (data && data.log_url) || '',
    createdAt: data && data.created_at,
  }
}
