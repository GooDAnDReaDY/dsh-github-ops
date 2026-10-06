// What the settings card is allowed to know.
//
// The status of the access — where it comes from, which account, what the rate limit looks
// like — belongs in the card, not in a tool result: the model has no business holding a token,
// and a status block explains "not configured" far better than an error at the first call.
//
// The payload never contains the access value. The route answers only a local or same-origin
// caller, because the payload describes the machine's account.

/** Whether a request may read the status payload. Fail-closed. */
function isTrustedHost(host) {
  if (!host || typeof host !== 'string') return false
  let hostname = host.trim()
  if (hostname.startsWith('[')) {
    const end = hostname.indexOf(']')
    if (end > 0) hostname = hostname.slice(1, end)
  } else if (hostname.includes(':')) {
    const colons = hostname.split(':').length - 1
    if (colons === 1) {
      hostname = hostname.split(':')[0]
    }
  }
  hostname = hostname.toLowerCase()
  if (!hostname) return false
  if (hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.lan')) return true
  const clean = hostname.replace(/^::ffff:/, '')
  if (clean === '127.0.0.1' || clean === '::1' || clean.startsWith('127.')) return true
  if (clean.startsWith('10.') || clean.startsWith('192.168.')) return true
  const match172 = clean.match(/^172\.(\d+)\./)
  if (match172) {
    const octet = parseInt(match172[1], 10)
    if (octet >= 16 && octet <= 31) return true
  }
  return false
}

/** Whether a request may read the status payload. Fail-closed. */
export function isTrustedRequest(req) {
  if (!req) return false

  // Fail-closed against cross-site fetches regardless of source IP
  const secFetchSite = header(req, 'sec-fetch-site')
  if (secFetchSite === 'cross-site') return false

  const address = (req.socket && (req.socket.remoteAddress || req.socket.address?.().address)) || ''
  const cleanIp = address.replace(/^::ffff:/, '')
  const loopback = cleanIp === '127.0.0.1' || cleanIp === '::1' || cleanIp.startsWith('127.')

  // If socket remoteAddress is present, it MUST be a trusted local/private IP (never an untrusted remote IP)
  if (cleanIp && !isTrustedHost(cleanIp)) return false

  const host = header(req, 'host')
  const origin = header(req, 'origin') || header(req, 'referer')

  // If host is provided, it MUST be a trusted local/private host (DNS rebinding guard)
  if (host && !isTrustedHost(host)) return false

  // If browser headers (origin/referer/sec-fetch-site) are absent and caller is loopback, allow local caller
  if (!origin && !secFetchSite && loopback) return true

  // If origin/referer is present, verify it matches host or is a trusted local host
  if (origin) {
    try {
      const originUrl = new URL(origin)
      if (!isTrustedHost(originUrl.hostname)) return false
      if (host && originUrl.host.toLowerCase() !== host.toLowerCase()) return false
      return true
    } catch {
      return false
    }
  }

  // Non-loopback caller without origin/referer is refused
  if (!loopback) return false

  return true
}

/** Whether a write/mutating request (e.g. POST /scm) is safe. Strict write guard against CSRF. */
export function isTrustedWriteRequest(req) {
  if (!req) return false
  if (!isTrustedRequest(req)) return false

  const secFetchSite = header(req, 'sec-fetch-site')
  if (secFetchSite && secFetchSite !== 'same-origin' && secFetchSite !== 'none') {
    return false
  }

  const address = (req.socket && (req.socket.remoteAddress || req.socket.address?.().address)) || ''
  const cleanIp = address.replace(/^::ffff:/, '')
  const loopback = cleanIp === '127.0.0.1' || cleanIp === '::1' || cleanIp.startsWith('127.')

  if (cleanIp && !isTrustedHost(cleanIp)) return false

  const host = header(req, 'host')
  const origin = header(req, 'origin') || header(req, 'referer')
  if (origin) {
    try {
      const originUrl = new URL(origin)
      if (host && originUrl.host.toLowerCase() !== host.toLowerCase()) return false
    } catch {
      return false
    }
  } else {
    // Write request without origin: only permit local loopback
    if (!loopback) return false
  }

  return true
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
