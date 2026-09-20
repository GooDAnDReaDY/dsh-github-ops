// GitHub API client: REST v3 and GraphQL v4 in one place.
//
// The transport is injected (`fetchImpl`) and so is the sleep (`sleepImpl`), so every
// caller and every test runs without a real network or real timers. Errors are normalized
// into a single shape — `{ ok: false, status, code, message, rateLimit }` at the tool
// layer — so a tool never throws the whole turn away because GitHub answered 404 or 403.
//
// Resilience: a read (GET/HEAD) is retried on a network failure, a timeout, or a 5xx, and
// a 429 is honoured through `Retry-After` (seconds or a date) or the rate-limit reset. A
// write is never retried automatically: a failed write has an unknown outcome, and
// repeating it silently is worse than reporting it.

export const DEFAULT_BASE_URL = 'https://api.github.com'
export const DEFAULT_GRAPHQL_URL = 'https://api.github.com/graphql'
export const DEFAULT_API_VERSION = '2022-11-28'
export const DEFAULT_USER_AGENT = 'dsh-github-ops'

/** Methods whose retry cannot duplicate a state change. */
export const SAFE_RETRY_METHODS = new Set(['GET', 'HEAD'])

/** Statuses worth another attempt for a read. */
export const RETRYABLE_STATUS = new Set([429, 502, 503, 504])

/** Normalized failure. */
export class GitHubError extends Error {
  constructor(message, { status = 0, code = '', rateLimit = null, details = null, attempts = 1 } = {}) {
    super(message)
    this.name = 'GitHubError'
    this.status = status
    this.code = code
    this.rateLimit = rateLimit
    this.details = details
    this.attempts = attempts
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

/**
 * How long to wait before the next attempt.
 *
 * `Retry-After` wins (it is what the server asks for), then the rate-limit reset when the
 * limit is spent, then exponential backoff. The result is capped so a hostile header
 * cannot stall a turn.
 */
export function retryDelayMs({ headers, attempt, baseMs = 500, maxDelayMs = 10000 } = {}) {
  const header = headers && typeof headers.get === 'function' ? headers.get('retry-after') : null
  if (header) {
    const seconds = Number(header)
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, maxDelayMs)
    const at = Date.parse(header)
    if (Number.isFinite(at)) return Math.min(Math.max(at - Date.now(), 0), maxDelayMs)
  }
  const limit = rateLimitFrom(headers)
  if (limit && limit.remaining === 0 && limit.resetAt) {
    const wait = Date.parse(limit.resetAt) - Date.now()
    if (Number.isFinite(wait) && wait > 0) return Math.min(wait, maxDelayMs)
  }
  const backoff = baseMs * (2 ** Math.max(0, attempt - 1))
  return Math.min(backoff, maxDelayMs)
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
 * Create a client bound to one access value. Nothing here reads globals: the caller
 * decides the access, the base URL, the transport and the clock.
 */
export function createGitHubClient({
  token = '',
  baseUrl = DEFAULT_BASE_URL,
  graphqlUrl = DEFAULT_GRAPHQL_URL,
  apiVersion = DEFAULT_API_VERSION,
  userAgent = DEFAULT_USER_AGENT,
  fetchImpl = globalThis.fetch,
  sleepImpl,
  timeoutMs = 30000,
  maxRetries = 2,
  retryBaseMs = 500,
  maxRetryDelayMs = 10000,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new GitHubError('no fetch implementation available', { code: 'no_fetch' })
  }
  const sleep = typeof sleepImpl === 'function'
    ? sleepImpl
    : (ms) => new Promise((resolve) => setTimeout(resolve, ms))

  async function attemptOnce({ method, path, query, body, url, accept, redirect }) {
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
        ...(redirect ? { redirect } : {}),
      })
    } catch (err) {
      if (timer) clearTimeout(timer)
      const aborted = err && (err.name === 'AbortError' || err.code === 'ABORT_ERR')
      throw new GitHubError(aborted ? `request timed out after ${timeoutMs}ms` : String((err && err.message) || err), {
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
    return { response, payload, rateLimit }
  }

  async function call({ method = 'GET', path, query, body, url, accept = 'application/vnd.github+json', redirect }) {
    const upper = method.toUpperCase()
    const retryable = SAFE_RETRY_METHODS.has(upper)
    const attemptsAllowed = Math.max(1, Number(maxRetries) + 1)
    let lastError = null

    for (let attempt = 1; attempt <= attemptsAllowed; attempt += 1) {
      let result
      try {
        result = await attemptOnce({ method: upper, path, query, body, url, accept, redirect })
      } catch (err) {
        lastError = err
        if (!retryable || attempt >= attemptsAllowed) {
          err.attempts = attempt
          throw err
        }
        await sleep(retryDelayMs({ attempt, baseMs: retryBaseMs, maxDelayMs: maxRetryDelayMs }))
        continue
      }

      const { response, payload, rateLimit } = result
      if (response.ok) {
        return { data: payload, status: response.status, rateLimit, attempts: attempt }
      }

      const message = (payload && (payload.message || payload.error)) || `HTTP ${response.status}`
      const exhausted = rateLimit && rateLimit.remaining === 0
      const error = new GitHubError(String(message), {
        status: response.status,
        code: exhausted ? 'rate_limited' : 'http_error',
        rateLimit,
        details: payload,
        attempts: attempt,
      })
      lastError = error

      const worthRetrying = retryable && RETRYABLE_STATUS.has(response.status)
      if (!worthRetrying || attempt >= attemptsAllowed) throw error
      await sleep(retryDelayMs({ headers: response.headers, attempt, baseMs: retryBaseMs, maxDelayMs: maxRetryDelayMs }))
    }
    throw lastError || new GitHubError('request failed', { code: 'http_error' })
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

    /**
     * Resolve an endpoint that answers with a redirect instead of JSON (the workflow
     * logs archive is a 302 to a zip). Nothing is downloaded: the caller gets the URL.
     */
    async getRedirect(path, { query } = {}) {
      const target = buildUrl(baseUrl, path, query)
      const headers = {
        accept: 'application/vnd.github+json',
        'x-github-api-version': apiVersion,
        'user-agent': userAgent,
      }
      if (token) headers.authorization = `Bearer ${token}`
      let response
      try {
        response = await fetchImpl(target, { method: 'GET', headers, redirect: 'manual' })
      } catch (err) {
        throw new GitHubError(String((err && err.message) || err), { code: 'network' })
      }
      const location = typeof response.headers?.get === 'function' ? response.headers.get('location') : null
      const rateLimit = rateLimitFrom(response.headers)
      if (!response.ok && !location) {
        throw new GitHubError(`HTTP ${response.status}`, { status: response.status, code: 'http_error', rateLimit })
      }
      return { status: response.status, location, rateLimit }
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
    if (err.attempts > 1) parts.push(`${err.attempts} attempts`)
    if (err.rateLimit && err.rateLimit.remaining === 0) {
      parts.push(`rate limit exhausted, resets at ${err.rateLimit.resetAt || 'unknown'}`)
    }
    return parts.length ? `${err.message} (${parts.join(', ')})` : err.message
  }
  return String(err.message || err)
}
