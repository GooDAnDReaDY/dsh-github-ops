// Issue operations: listing (pull requests come back marked `kind: "pr"`), reading
// with comments, creating, commenting, closing, and the cross-repository search
// endpoint (which has its own quota).

function ensureRepo({ owner, repo }) {
  if (!owner || !repo) {
    throw new Error('owner and repo are required (pass "repository": "owner/repo" or set defaults in settings)')
  }
}

export function normalizeIssue(data, { mine = '' } = {}) {
  if (!data || typeof data !== 'object') return data
  const isPull = Boolean(data.pull_request)
  return {
    number: data.number,
    kind: isPull ? 'pr' : 'issue',
    title: data.title,
    state: data.state,
    stateReason: data.state_reason || null,
    author: data.user && data.user.login,
    labels: Array.isArray(data.labels)
      ? data.labels.map((l) => (typeof l === 'string' ? l : l.name))
      : [],
    assignees: Array.isArray(data.assignees) ? data.assignees.map((a) => a.login) : [],
    comments: data.comments,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    closedAt: data.closed_at,
    url: data.html_url,
    body: typeof data.body === 'string' ? data.body : '',
    isMine: mine ? (data.user && data.user.login) === mine : undefined,
  }
}

export async function listIssues(client, { owner, repo, state = 'open', labels, limit = 30, kind = 'all' }) {
  ensureRepo({ owner, repo })
  const capped = Math.max(1, Math.min(Number(limit) || 30, 100))
  const query = { state, per_page: capped }
  if (labels) query.labels = Array.isArray(labels) ? labels.join(',') : labels
  const { data } = await client.get(`/repos/${owner}/${repo}/issues`, { query })
  let issues = Array.isArray(data) ? data.map((i) => normalizeIssue(i)) : []
  if (kind === 'pr') issues = issues.filter((i) => i.kind === 'pr')
  if (kind === 'issue') issues = issues.filter((i) => i.kind === 'issue')
  issues = issues.slice(0, capped)
  return { issues, count: issues.length }
}

export async function getIssue(client, { owner, repo, number, includeComments = false }) {
  ensureRepo({ owner, repo })
  if (!number) throw new Error('number is required')
  const { data } = await client.get(`/repos/${owner}/${repo}/issues/${number}`)
  const issue = normalizeIssue(data)
  if (!includeComments) return issue
  const { data: comments } = await client.get(`/repos/${owner}/${repo}/issues/${number}/comments`, {
    query: { per_page: 100 },
  })
  issue.commentList = Array.isArray(comments)
    ? comments.map((c) => ({ id: c.id, author: c.user && c.user.login, createdAt: c.created_at, body: c.body }))
    : []
  return issue
}

export async function createIssue(client, { owner, repo, title, body, labels, assignees }) {
  ensureRepo({ owner, repo })
  if (!title) throw new Error('title is required')
  const payload = { title, body: body || '' }
  if (labels) payload.labels = Array.isArray(labels) ? labels : [labels]
  if (assignees) payload.assignees = Array.isArray(assignees) ? assignees : [assignees]
  const { data } = await client.post(`/repos/${owner}/${repo}/issues`, payload)
  return normalizeIssue(data)
}

export async function commentIssue(client, { owner, repo, number, body }) {
  ensureRepo({ owner, repo })
  if (!number) throw new Error('number is required')
  if (!body) throw new Error('body is required')
  const { data } = await client.post(`/repos/${owner}/${repo}/issues/${number}/comments`, { body })
  return { id: data && data.id, url: data && data.html_url, createdAt: data && data.created_at }
}

export async function closeIssue(client, { owner, repo, number, stateReason }) {
  ensureRepo({ owner, repo })
  if (!number) throw new Error('number is required')
  const payload = { state: 'closed' }
  if (stateReason) payload.state_reason = stateReason
  const { data } = await client.patch(`/repos/${owner}/${repo}/issues/${number}`, payload)
  return normalizeIssue(data)
}

export async function searchIssues(client, { query, limit = 20 }) {
  if (!query) throw new Error('query is required')
  const capped = Math.max(1, Math.min(Number(limit) || 20, 100))
  const { data } = await client.get('/search/issues', { query: { q: query, per_page: capped } })
  const items = ((data && data.items) || []).slice(0, capped)
  return {
    total: (data && data.total_count) || items.length,
    issues: items.map((i) => ({
      ...normalizeIssue(i),
      repository: i.repository_url ? String(i.repository_url).replace(/^.*\/repos\//, '') : undefined,
    })),
  }
}
