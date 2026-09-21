// Data shapes the sidebar panel needs.
//
// The panel shows a repository the way a person browses it: a tree, a file, the issue and pull
// request lists, the recent runs and the attention inbox. These are thin compositions over the
// existing readers, kept here so the route stays a switch instead of a second implementation.

export { listNotifications } from './insights.js'

function ensureRepo({ owner, repo }) {
  if (!owner || !repo) throw new Error('owner and repo are required')
}

/**
 * One level of a repository tree, ready for a file browser: directories first, then files,
 * each with the path the panel asks for next.
 */
export async function repoTreeView(client, { owner, repo, ref, path = '', limit = 200 } = {}) {
  ensureRepo({ owner, repo })
  const capped = Math.max(1, Math.min(Number(limit) || 200, 1000))
  const target = ref || 'HEAD'
  const suffix = path ? `/${String(path).replace(/^\/+|\/+$/g, '')}` : ''
  const { data } = await client.get(`/repos/${owner}/${repo}/git/trees/${encodeURIComponent(target)}${suffix}`, {
    query: { per_page: capped },
  })
  const entries = (data && Array.isArray(data.tree) ? data.tree : [])
    .slice(0, capped)
    .map((entry) => ({
      name: String(entry.path || '').split('/').pop(),
      path: entry.path,
      type: entry.type,
      size: entry.size,
      sha: entry.sha,
    }))
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'tree' ? -1 : 1
      return String(a.name).localeCompare(String(b.name))
    })
  return {
    ref: target,
    path: path || '',
    truncated: Boolean(data && data.truncated),
    count: entries.length,
    entries,
  }
}
