import { auditTokenScopes } from './token-audit.js'
// What the settings card is allowed to know.
//
// The status of the access — where it comes from, which account, what the rate limit looks
// like — belongs in the card, not in a tool result: the model has no business holding a token,
// and a status block explains "not configured" far better than an error at the first call.
//
// The payload never contains the access value. The route answers only a local or same-origin
// caller, because the payload describes the machine's account.

/** Whether an address or host string represents local loopback. */
export function isLoopbackAddress(val) {
  if (!val || typeof val !== 'string') return false
  let h = val.trim().toLowerCase()
  if (h.startsWith('[')) {
    const end = h.indexOf(']')
    if (end > 0) h = h.slice(1, end)
  } else if (h.includes(':')) {
    const colons = h.split(':').length - 1
    if (colons === 1) h = h.split(':')[0]
  }
  const clean = h.replace(/^::ffff:/, '')
  return clean === '127.0.0.1' || clean === '::1' || clean.startsWith('127.') || clean === 'localhost' || clean === 'localhost.' || clean === '[::1]'
}
export const isLoopback = isLoopbackAddress

/** Whether an address or host string represents a private LAN network. */
export function isLanAddress(ip) {
  if (!ip || typeof ip !== 'string') return false
  let h = ip.trim().toLowerCase()
  if (h.startsWith('[')) {
    const end = h.indexOf(']')
    if (end > 0) h = h.slice(1, end)
  } else if (h.includes(':')) {
    const colons = h.split(':').length - 1
    if (colons === 1) h = h.split(':')[0]
  }
  const clean = h.replace(/^::ffff:/, '')
  if (isLoopbackAddress(clean)) return true
  if (clean.startsWith('10.') || clean.startsWith('192.168.')) return true
  const match172 = clean.match(/^172\.(\d+)\./)
  if (match172) {
    const octet = parseInt(match172[1], 10)
    if (octet >= 16 && octet <= 31) return true
  }
  return false
}

/** Whether a host header passes DNS-rebinding guards. Fail-closed. */
export function isTrustedHost(host) {
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
  return isLoopbackAddress(hostname) || isLanAddress(hostname)
}

/** Resolves remote client IP from socket or request metadata. */
export function getClientIp(req) {
  return (
    req?.socket?.remoteAddress ||
    req?.socket?.address?.()?.address ||
    req?.connection?.remoteAddress ||
    req?.info?.remoteAddress ||
    ''
  )
}

/**
 * Evaluates whether an incoming HTTP request is trusted and authenticated (#129).
 *
 * Requirements:
 * 1. If DSH connection service is available (options.connection), requestRejection(req)
 *    is the authoritative gate for browser session authentication and trusted network access.
 *    If rejection is returned, the numeric status (e.g. 401 or 403) is returned.
 * 2. Host header, if present, must pass isTrustedHost (prevents DNS rebinding).
 * 3. Cross-site requests (sec-fetch-site: cross-site) are strictly rejected with 403.
 * 4. Origin & Referer headers (if present) must match Host or a trusted host.
 * 5. Fallback when connection service is absent (unit tests, standalone runner):
 *    - Loopback callers (127.0.0.1, ::1) are allowed.
 *    - Remote / LAN callers without connection authentication are rejected with 403 (fail closed).
 *    - Unknown remote address (socket present but empty remoteAddress) fails closed with 403.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {{ connection?: { requestRejection?: (req: any) => number | undefined } }} [options]
 * @returns {number|undefined} Rejection HTTP status code (401, 403), or undefined if allowed.
 */
export function getRejectionStatus(req, options = {}) {
  if (!req) return 403

  const connection = options?.connection
  if (connection && typeof connection.requestRejection === 'function') {
    try {
      const rejection = connection.requestRejection(req)
      if (rejection !== undefined) {
        if (typeof rejection === 'number' && Number.isInteger(rejection) && rejection >= 400 && rejection < 600) {
          return rejection
        }
        return rejection === 401 ? 401 : 403
      }
    } catch {
      // Fail closed if connection service throws
      return 403
    }
  }

  const host = header(req, 'host')

  // 1. Host header must be present and trusted if provided
  if (host && !isTrustedHost(host)) {
    return 403
  }

  // 2. Strict rejection of cross-site requests
  const site = header(req, 'sec-fetch-site')
  if (site === 'cross-site') {
    return 403
  }

  // 3. Origin header validation if present
  const origin = header(req, 'origin')
  if (origin) {
    if (origin === 'null') return 403
    try {
      const originUrl = new URL(origin)
      if (!isTrustedHost(originUrl.hostname)) return 403
      if (host && originUrl.host.toLowerCase() !== host.toLowerCase()) return 403
    } catch {
      return 403
    }
  }

  // 4. Referer header validation if present
  const referer = header(req, 'referer')
  if (referer) {
    try {
      const refUrl = new URL(referer)
      if (refUrl.protocol === 'http:' || refUrl.protocol === 'https:') {
        if (!isTrustedHost(refUrl.hostname)) return 403
        if (host && refUrl.host.toLowerCase() !== host.toLowerCase()) return 403
      } else {
        // Non-http custom scheme referer (e.g. dsh-app://app/ in DSH Desktop Electron):
        // Permitted only from local loopback
        const ip = getClientIp(req)
        const hostIsLoopback = host ? isLoopbackAddress(host) : false
        const isLocal = ip ? isLoopbackAddress(ip) : hostIsLoopback
        if (!isLocal) return 403
      }
    } catch {
      return 403
    }
  }

  // 5. Network boundary validation when connection service is absent:
  const hasSocket = !!(req.socket || req.connection)
  const ip = getClientIp(req)

  if (hasSocket) {
    // Fail closed on missing/unknown remoteAddress
    if (!ip) {
      return 403
    }
    // Remote / LAN callers without connection authentication are rejected (fail closed!)
    if (!isLoopbackAddress(ip)) {
      if (!connection) {
        return 403
      }
    }
  } else if (!connection) {
    // Synthetic mock request without socket: allow loopback host for unit tests
    if (host && !isLoopbackAddress(host)) {
      return 403
    }
  }

  // If browser headers are absent and caller is non-loopback without connection
  if (!connection) {
    const isLocal = ip ? isLoopbackAddress(ip) : (host ? isLoopbackAddress(host) : false)
    if (!isLocal) return 403
  }

  return undefined
}

/**
 * Evaluates whether an incoming HTTP write request is safe for mutation (#129).
 *
 * Additional Write Requirements:
 * 1. Must satisfy all getRejectionStatus checks (including connection.requestRejection).
 * 2. If Origin header is present:
 *    - must match Host exactly (same-origin).
 * 3. If Referer header is present:
 *    - must match Host exactly (same-origin).
 * 4. If Sec-Fetch-Site header is present:
 *    - must be "same-origin" or "none" (same-site and cross-site are rejected).
 * 5. If connection service is absent, only local loopback callers are allowed for writes.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {{ connection?: { requestRejection?: (req: any) => number | undefined } }} [options]
 * @returns {number|undefined} Rejection HTTP status code (401, 403), or undefined if allowed.
 */
export function getWriteRejectionStatus(req, options = {}) {
  const readStatus = getRejectionStatus(req, options)
  if (readStatus !== undefined) {
    return readStatus
  }

  const site = header(req, 'sec-fetch-site')
  if (site && site !== 'same-origin' && site !== 'none') {
    return 403
  }

  const host = header(req, 'host')
  const origin = header(req, 'origin')
  const referer = header(req, 'referer')
  const ip = getClientIp(req)
  const connection = options?.connection

  if (origin) {
    if (origin === 'null') return 403
    try {
      const originUrl = new URL(origin)
      if (host && originUrl.host.toLowerCase() !== host.toLowerCase()) return 403
    } catch {
      return 403
    }
  } else if (referer) {
    try {
      const refUrl = new URL(referer)
      if (refUrl.protocol === 'http:' || refUrl.protocol === 'https:') {
        if (host && refUrl.host.toLowerCase() !== host.toLowerCase()) return 403
      } else {
        const hostIsLoopback = host ? isLoopbackAddress(host) : false
        const isLocal = ip ? isLoopbackAddress(ip) : hostIsLoopback
        if (!isLocal) return 403
      }
    } catch {
      return 403
    }
  } else {
    // Write request without origin/referer: only permit local loopback
    const hostIsLoopback = host ? isLoopbackAddress(host) : false
    const isLocal = ip ? isLoopbackAddress(ip) : hostIsLoopback
    if (!isLocal) return 403
  }

  // If connection service is absent, only local loopback callers are allowed for writes
  if (!connection) {
    const hasSocket = !!(req.socket || req.connection)
    if (hasSocket) {
      if (!ip || !isLoopbackAddress(ip)) {
        return 403
      }
    } else {
      if (!host || !isLoopbackAddress(host)) {
        return 403
      }
    }
  }

  return undefined
}

/** Whether a request may read the status payload. Fail-closed. */
export function isTrustedRequest(req, options = {}) {
  return getRejectionStatus(req, options) === undefined
}

/** Whether a write/mutating request (e.g. POST /scm) is safe. Strict write guard against CSRF. */
export function isTrustedWriteRequest(req, options = {}) {
  return getWriteRejectionStatus(req, options) === undefined
}

export function header(req, name) {
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
  const audit = auditTokenScopes(scopes)
  return {
    configured,
    source: configured ? access.source || '' : '',
    login: (identity && identity.login) || '',
    name: (identity && identity.name) || '',
    scopes: scopes || '',
    scopeWarnings: audit.warnings,
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
