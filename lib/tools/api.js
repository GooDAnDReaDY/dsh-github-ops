// Generic `gh api` pass-through with an explicit safety boundary.
//
// Reads are free. Anything that changes state needs `confirm: true`, and a small
// deny list refuses the calls that would be destructive in a way a single
// confirmation cannot undo (deleting repositories, transferring ownership).

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE'])

const DENY = [
  { method: 'DELETE', pattern: /^\/repos\/[^/]+\/[^/]+$/, reason: 'deleting a repository is refused' },
  { method: 'POST', pattern: /^\/repos\/[^/]+\/[^/]+\/transfer$/, reason: 'transferring a repository is refused' },
  { method: 'DELETE', pattern: /^\/orgs\/[^/]+$/, reason: 'deleting an organization is refused' },
]

export function validateApiCall({ method, path, confirm }) {
  const m = String(method || 'GET').toUpperCase()
  if (!path || !String(path).startsWith('/')) {
    throw new Error('path must start with "/" and be relative to the API base, e.g. "/repos/owner/repo"')
  }
  for (const rule of DENY) {
    if (rule.method === m && rule.pattern.test(path)) {
      throw new Error(`${rule.reason} (${m} ${path})`)
    }
  }
  const mutating = MUTATING.has(m)
  if (mutating && confirm !== true) {
    throw new Error(`refusing ${m} ${path}: pass confirm: true to run a state-changing call`)
  }
  return { method: m, mutating }
}

/** Run one generic API call. `body` may be an object (JSON) — it is passed as-is. */
export async function callApi(client, { method = 'GET', path, query, body, confirm = false, graphql } = {}) {
  if (graphql) {
    const data = await client.graphql(graphql, body && typeof body === 'object' ? body : undefined)
    return { graphql: true, data }
  }
  const { method: m, mutating } = validateApiCall({ method, path, confirm })
  const opts = { query }
  const { data, status, rateLimit } = m === 'GET' || m === 'DELETE'
    ? await client.request(m, path, opts)
    : await client.request(m, path, { ...opts, body })
  return { method: m, mutating, status, rateLimit, data }
}
