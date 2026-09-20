// Access resolution across the sources a GitHub user actually has.
//
// Order (tokenSource: "auto"): the DSH credentials service, then the environment
// variable of the same name, then the `gh` CLI session. The credential service stays
// the recommended source — it is the only one DSH manages and rotates — but a machine
// with `gh auth login` already done should not need a second copy of the same secret.
//
// The value never leaves this module except as the returned string: it is never written
// to logs, error messages, model-visible text or session events.

export const NO_ACCESS_GUIDANCE = 'Configure one of: 1) a DSH credential with this name '
  + '($DSH_HOME/.credentials.yaml) — recommended, 2) the same-named environment variable, '
  + '3) `gh auth login` for the gh CLI. Set tokenSource in the plugin settings to pin one source.'

export const ACCESS_SOURCES = ['credentials', 'env', 'gh']

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
export async function resolveAccess({ credentials, tokenEnv, tokenSource = 'auto', env = process.env, runGh } = {}) {
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
