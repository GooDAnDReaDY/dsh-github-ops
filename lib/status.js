// What the settings card is allowed to know.
//
// The status of the access — where it comes from, which account, what the rate limit looks
// like — belongs in the card, not in a tool result: the model has no business holding a token,
// and a status block explains "not configured" far better than an error at the first call.
//
// The payload never contains the access value. The route answers only a local or same-origin
// caller, because the payload describes the machine's account.

/** Whether a request may read the status payload. Fail-closed. */
export function isTrustedRequest(req) {
  if (!req) return false
  const address = (req.socket && (req.socket.remoteAddress || req.socket.address?.().address)) || ''
  const loopback = address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
  if (loopback) return true

  // For non-loopback callers: fail-closed source verification
  const secFetchSite = header(req, 'sec-fetch-site')
  if (secFetchSite === 'cross-site') return false

  const host = header(req, 'x-forwarded-host') || header(req, 'host')
  const origin = header(req, 'origin') || header(req, 'referer')
  if (!host || !origin) return false

  try {
    const originUrl = new URL(origin)
    if (originUrl.host.toLowerCase() !== host.toLowerCase()) return false



    // DNS rebinding guard: host must be a loopback, local or private LAN address
    const hostname = host.split(':')[0].toLowerCase()
    const isPrivate =
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
      /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.lan')

    return isPrivate
  } catch {
    return false
  }
}

function header(req, name) {
  if (!req || !req.headers) return ''
  const value = req.headers[name] || req.headers[name.toLowerCase()]
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * The payload for the card.
 *
 * @param access - result of the access resolution: { value, source, guidance }
 * @param identity - { login, name } or null when the call failed
 * @param rateLimit - { limit, remaining, resetAt } or null
 * @param cache - { size, ttlMs }
 * @param error - a string when the identity call failed
 */
export function statusPayload({ access, identity, rateLimit, scopes, cache, error } = {}) {
  const configured = Boolean(access && access.value)
  return {
    configured,
    source: configured ? access.source || '' : '',
    login: (identity && identity.login) || '',
    name: (identity && identity.name) || '',
    scopes: scopes || '',
    rateLimit: rateLimit
      ? { limit: rateLimit.limit, remaining: rateLimit.remaining, resetAt: rateLimit.resetAt }
      : null,
    cache: cache ? { size: cache.size, ttlMs: cache.ttlMs } : null,
    guidance: configured ? '' : ((access && access.guidance) || ''),
    error: error ? String(error).slice(0, 200) : '',
  }
}

/** Answers one HTTP request with JSON. Shared by the route so the handler stays thin. */
export function sendJson(res, statusCode, payload) {
  try {
    res.writeHead(statusCode, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify(payload))
  } catch {
    // a client that went away must not break the route
  }
}
