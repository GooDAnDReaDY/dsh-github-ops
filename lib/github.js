// GitHub API client: REST v3 and GraphQL v4 in one place.
//
// The transport is injected (`fetchImpl`), so every caller and every test runs
// without a real network. Errors are normalized into a single shape: callers get
// `{ ok: false, status, code, message, rateLimit }` instead of raw exceptions, so a
// tool never throws the whole turn away because GitHub answered 404 or 403.

export const DEFAULT_BASE_URL = 'https://api.github.com'
export const DEFAULT_GRAPHQL_URL = 'https://api.github.com/graphql'
export const DEFAULT_API_VERSION = '2022-11-28'
export const DEFAULT_USER_AGENT = 'dsh-github-ops'

/** Normalized failure. */
export class GitHubError extends Error {
  constructor(message, { status = 0, code = '', rateLimit = null, details = null } = {}) {
    super(message)
    this.name = 'GitHubError'
    this.status = status
    this.code = code
    this.rateLimit = rateLimit
    this.details = details
  }
}

function rateLimitFrom(headers) {
  if (!headers || typeof headers.get !== 'function') return null
  const remaining = headers.get('x-ratelimit-remaining')
  const reset = headers.get('x-ratelimit-reset')
  const limit = headers.get('x-ratelimit-limit')
  if (remaining === null && reset === null && limit === null) return null
  const out = {}
  if (remaining !== null) out.remaining = Number(remaining)
  if (limit !== null) out.limit = Number(limit)
  if (reset !== null) {
    out.resetAt = new Date(Number(reset) * 1000).toISOString()
  }
  return out
}

function buildUrl(baseUrl, path, query) {
  const url = new URL(baseUrl.replace(/\/+$/, '') + (path.startsWith('/') ? path : `/${path}`))
  if (query && typeof query === 'object') {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue
      url.searchParams.set(key, String(value))
    }
  }
  return url.toString()
}

/**
 * Create a client bound to one token. Nothing here reads globals: the caller
 * decides the token, the base URL and the transport.
 */
export function createGitHubClient({
  token = '',
  baseUrl = DEFAULT_BASE_URL,
  graphqlUrl = DEFAULT_GRAPHQL_URL,
  apiVersion = DEFAULT_API_VERSION,
  userAgent = DEFAULT_USER_AGENT,
  fetchImpl = globalThis.fetch,
  timeoutMs = 30000,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new GitHubError('no fetch implementation available', { code: 'no_fetch' })
  }

  async function call({ method = 'GET', path, query, body, url, accept = 'application/vnd.github+json' }) {
    const target = url || buildUrl(baseUrl, path, query)
    const headers = {
      accept,
      'x-github-api-version': apiVersion,
      'user-agent': userAgent,
    }
    if (token) headers.authorization = `Bearer ${token}`
    if (body !== undefined) headers['content-type'] = 'application/json'

    const controller = typeof AbortController === 'function' ? new AbortController() : null
    const timer = controller && timeoutMs > 0
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null

    let response
    try {
      response = await fetchImpl(target, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller ? controller.signal : undefined,
      })
    } catch (err) {
      if (timer) clearTimeout(timer)
      const aborted = err && (err.name === 'AbortError' || err.code === 'ABORT_ERR')
      throw new GitHubError(aborted ? `request timed out after ${timeoutMs}ms` : String(err && err.message || err), {
        code: aborted ? 'timeout' : 'network',
      })
    }
    if (timer) clearTimeout(timer)

    const rateLimit = rateLimitFrom(response.headers)
    const text = typeof response.text === 'function' ? await response.text() : ''
    let payload = null
    if (text) {
      try {
        payload = JSON.parse(text)
      } catch {
        payload = { raw: text.slice(0, 2000) }
      }
    }

    if (!response.ok) {
      const message = (payload && (payload.message || payload.error)) || `HTTP ${response.status}`
      throw new GitHubError(String(message), {
        status: response.status,
        code: rateLimit && rateLimit.remaining === 0 ? 'rate_limited' : 'http_error',
        rateLimit,
        details: payload,
      })
    }
    return { data: payload, status: response.status, rateLimit }
  }

  return {
    token,
    baseUrl,

    /** One REST call. `path` is relative to the API base, e.g. `/repos/o/r`. */
    request(method, path, { query, body, accept } = {}) {
      return call({ method: method.toUpperCase(), path, query, body, accept })
    },

    get(path, opts) {
      return call({ method: 'GET', path, ...(opts || {}) })
    },

    post(path, body, opts) {
      return call({ method: 'POST', path, body, ...(opts || {}) })
    },

    patch(path, body, opts) {
      return call({ method: 'PATCH', path, body, ...(opts || {}) })
    },

    put(path, body, opts) {
      return call({ method: 'PUT', path, body, ...(opts || {}) })
    },

    del(path, opts) {
      return call({ method: 'DELETE', path, ...(opts || {}) })
    },

    /** GraphQL v4. Returns `data` only; `errors` become a GitHubError. */
    async graphql(query, variables) {
      const { data } = await call({
        method: 'POST',
        url: graphqlUrl,
        body: { query, variables: variables || {} },
        accept: 'application/json',
      })
      if (data && Array.isArray(data.errors) && data.errors.length) {
        throw new GitHubError(data.errors.map((e) => e.message).join('; '), {
          code: 'graphql_error',
          details: data.errors,
        })
      }
      return data && data.data ? data.data : data
    },

    /**
     * Walk a paginated REST list. `pageSize` maps to `per_page`; stops when a page
     * is shorter than the page size or when `maxItems` is reached.
     */
    async paginate(path, { query = {}, pageSize = 100, maxItems = 1000 } = {}) {
      const items = []
      for (let page = 1; items.length < maxItems; page += 1) {
        const { data } = await call({
          method: 'GET',
          path,
          query: { ...query, per_page: pageSize, page },
        })
        if (!Array.isArray(data) || data.length === 0) break
        items.push(...data)
        if (data.length < pageSize) break
      }
      return items.slice(0, maxItems)
    },
  }
}

/** Split `owner/repo` (or `owner/repo#123`) into its parts. Returns null when malformed. */
export function parseRepoSpec(spec) {
  if (typeof spec !== 'string') return null
  const match = spec.trim().match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:#(\d+))?$/)
  if (!match) return null
  return { owner: match[1], repo: match[2], number: match[3] ? Number(match[3]) : null }
}

/** Human-readable one-liner for a failure, used by every tool renderer. */
export function describeError(err) {
  if (!err) return 'unknown error'
  if (err instanceof GitHubError) {
    const parts = []
    if (err.status) parts.push(`HTTP ${err.status}`)
    if (err.code) parts.push(err.code)
    if (err.rateLimit && err.rateLimit.remaining === 0) {
      parts.push(`rate limit exhausted, resets at ${err.rateLimit.resetAt || 'unknown'}`)
    }
    return parts.length ? `${err.message} (${parts.join(', ')})` : err.message
  }
  return String(err.message || err)
}
