// Repository and file operations: metadata, file content at a ref, repository
// search (its own quota), plus repository creation and edits.

function ensureRepo({ owner, repo }) {
  if (!owner || !repo) {
    throw new Error('owner and repo are required (pass "repository": "owner/repo" or set defaults in settings)')
  }
}

export function normalizeRepo(data) {
  if (!data || typeof data !== 'object') return data
  return {
    fullName: data.full_name,
    description: data.description || '',
    private: Boolean(data.private),
    archived: Boolean(data.archived),
    defaultBranch: data.default_branch,
    language: data.language,
    stars: data.stargazers_count,
    forks: data.forks_count,
    openIssues: data.open_issues_count,
    topics: Array.isArray(data.topics) ? data.topics : [],
    license: data.license && (data.license.spdx_id || data.license.name),
    homepage: data.homepage || '',
    pushedAt: data.pushed_at,
    updatedAt: data.updated_at,
    url: data.html_url,
  }
}

export async function getRepo(client, { owner, repo }) {
  ensureRepo({ owner, repo })
  const { data } = await client.get(`/repos/${owner}/${repo}`)
  return normalizeRepo(data)
}

export async function getFile(client, { owner, repo, path, ref }) {
  ensureRepo({ owner, repo })
  if (!path) throw new Error('path is required')
  const { data } = await client.get(`/repos/${owner}/${repo}/contents/${path}`, {
    query: ref ? { ref } : undefined,
  })
  if (Array.isArray(data)) {
    return {
      kind: 'directory',
      path,
      entries: data.map((e) => ({ name: e.name, type: e.type, size: e.size, path: e.path })),
    }
  }
  const encoded = String((data && data.content) || '').replace(/\n/g, '')
  const decoded = encoded && String(data.encoding || 'base64') === 'base64'
    ? Buffer.from(encoded, 'base64').toString('utf8')
    : String((data && data.content) || '')
  return {
    kind: 'file',
    path: data && data.path ? data.path : path,
    sha: data && data.sha,
    size: data && data.size,
    truncated: Boolean(data && data.truncated),
    content: decoded,
  }
}

export async function searchRepos(client, { query, limit = 20 }) {
  if (!query) throw new Error('query is required')
  const capped = Math.max(1, Math.min(Number(limit) || 20, 100))
  const { data } = await client.get('/search/repositories', {
    query: { q: query, per_page: capped },
  })
  const items = (data && data.items) || []
  return {
    total: (data && data.total_count) || items.length,
    repos: items.map(normalizeRepo),
  }
}

export async function createRepo(client, { name, org, description, private: isPrivate = true, autoInit = false }) {
  if (!name) throw new Error('name is required')
  const payload = {
    name,
    description: description || '',
    private: Boolean(isPrivate),
    auto_init: Boolean(autoInit),
  }
  const path = org ? `/orgs/${org}/repos` : '/user/repos'
  const { data } = await client.post(path, payload)
  return normalizeRepo(data)
}

export async function editRepo(client, { owner, repo, description, homepage, private: isPrivate, archived, topics }) {
  ensureRepo({ owner, repo })
  const payload = {}
  if (description !== undefined) payload.description = description
  if (homepage !== undefined) payload.homepage = homepage
  if (isPrivate !== undefined) payload.private = Boolean(isPrivate)
  if (archived !== undefined) payload.archived = Boolean(archived)
  const { data } = Object.keys(payload).length
    ? await client.patch(`/repos/${owner}/${repo}`, payload)
    : { data: null }
  const result = data ? normalizeRepo(data) : await getRepo(client, { owner, repo })
  if (Array.isArray(topics)) {
    // The topics endpoint is separate and its response is the only place the applied
    // list is reported: a PATCH response may still carry the previous topics.
    const { data: topicData } = await client.put(`/repos/${owner}/${repo}/topics`, { names: topics })
    if (topicData && Array.isArray(topicData.names)) result.topics = topicData.names
  }
  return result
}
