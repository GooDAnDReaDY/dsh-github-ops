import { createHash } from 'node:crypto'
// Access resolution across the sources a GitHub user actually has.
//
// Order (tokenSource: "auto"): the DSH credentials service, then the environment variable of
// the same name, then the sign-in this plugin stored itself (gh_auth_login), then the `gh` CLI
// session. The credential service stays
// the recommended source — it is the only one DSH manages and rotates — but a machine
// with `gh auth login` already done should not need a second copy of the same secret.
//
// The value never leaves this module except as the returned string: it is never written
// to logs, error messages, model-visible text or session events.

export const NO_ACCESS_GUIDANCE = 'Configure one of: 1) a DSH credential with this name '
  + '($DSH_HOME/.credentials.yaml) — recommended, 2) the same-named environment variable, '
  + '3) gh_auth_login to sign in from here, 4) `gh auth login` for the gh CLI. '
  + 'Set tokenSource in the plugin settings to pin one source.'

export const ACCESS_SOURCES = ['credentials', 'env', 'file', 'gh']

/**
 * Resolve access for one operation. Nothing is cached: a rotated credential reaches the
 * very next call.
 *
 * @param credentials - the credentials service (needs `resolve`)
 * @param tokenEnv - credential / environment-variable name, e.g. GITHUB_TOKEN
 * @param tokenSource - 'auto' | 'credentials' | 'env' | 'gh'
 * @param env - environment map (defaults to process.env)
 * @param runGh - async () => string; returns the gh CLI access value, '' when unavailable
 * @returns {Promise<{ value: string, source: string, guidance: string }>}
 */
export async function resolveAccess({ credentials, tokenEnv, tokenSource = 'auto', env = process.env, runGh, runFile } = {}) {
  const order = tokenSource === 'auto' ? ACCESS_SOURCES : [tokenSource]
  for (const source of order) {
    if (source === 'credentials') {
      try {
        const resolved = credentials && typeof credentials.resolve === 'function'
          ? await credentials.resolve(tokenEnv)
          : null
        const value = resolved && resolved.value ? String(resolved.value) : ''
        if (value) return { value, source, guidance: '' }
      } catch {
        // an unset or unknown credential is a normal miss, not an error
      }
      continue
    }
    if (source === 'env') {
      const value = env && tokenEnv ? String(env[tokenEnv] || '') : ''
      if (value) return { value, source, guidance: '' }
      continue
    }
    if (source === 'file') {
      let value = ''
      try {
        value = runFile ? String((await runFile()) || '').trim() : ''
      } catch {
        value = ''
      }
      if (value) return { value, source, guidance: '' }
      continue
    }
    if (source === 'gh') {
      let value = ''
      try {
        value = runGh ? String((await runGh()) || '').trim() : ''
      } catch {
        value = ''
      }
      if (value) return { value, source, guidance: '' }
    }
  }
  return { value: '', source: '', guidance: NO_ACCESS_GUIDANCE }
}
/**
 * Deterministic non-reversible token fingerprint for client cache keys:
 * differentiates tokens of identical length without leaking token content into logs or keys.
 */
export function tokenFingerprint(value) {
  if (!value || typeof value !== 'string') return ''
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

/**
 * Cache key for shared GitHub client instances.
 * Incorporates the token fingerprint (not length) so rotation between equal-length tokens
 * creates a new client and uses the new Bearer immediately.
 */
export function clientCacheKey(access, cfg = {}) {
  return [
    access?.source || '',
    tokenFingerprint(access?.value),
    cfg?.baseUrl || '',
    cfg?.timeoutMs || '',
    cfg?.cacheTtlMs || '',
    cfg?.maxRetries ?? '',
  ].join('|')
}

/**
 * Manages the shared GitHub client instance:
 * caches the client while the key matches; recreates it when the token or config changes.
 */
export function createClientHolder({ createClient, signalProvider } = {}) {
  let sharedClient = null
  let sharedKey = ''

  return {
    get(access, cfg = {}) {
      if (!access || !access.value) {
        throw new Error(`GitHub access is not configured: ${access?.guidance || NO_ACCESS_GUIDANCE}`)
      }
      const key = clientCacheKey(access, cfg)
      if (!sharedClient || sharedKey !== key) {
        if (typeof createClient !== 'function') {
          throw new Error('createClient factory must be a function')
        }
        sharedClient = createClient({
          token: access.value,
          baseUrl: cfg.baseUrl || 'https://api.github.com',
          timeoutMs: Number(cfg.timeoutMs) || 30000,
          cacheTtlMs: Number.isFinite(Number(cfg.cacheTtlMs)) ? Number(cfg.cacheTtlMs) : 60000,
          maxRetries: Number.isFinite(Number(cfg.maxRetries)) ? Number(cfg.maxRetries) : 2,
          signalProvider,
        })
        sharedKey = key
      }
      return sharedClient
    },
    currentKey: () => sharedKey,
    currentClient: () => sharedClient,
    reset: () => {
      sharedClient = null
      sharedKey = ''
    },
  }
}
