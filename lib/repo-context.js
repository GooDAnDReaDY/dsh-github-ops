// Which repository a call is about.
//
// A tool call may name a repository, fall back to the configured default, or — inside a
// checkout — simply mean "the repository I am in": the origin remote already says which
// one it is, so demanding it again on every call is noise. Pure functions here; the caller
// supplies the remote URL, which keeps this testable without a working copy.

/** Parse `owner/repo`, `owner/repo#123`, `#123` or `123`. */
export function parseRef(input) {
  if (typeof input !== 'string') return null
  const text = input.trim()
  if (!text) return null

  const bare = text.match(/^#?(\d+)$/)
  if (bare) return { owner: '', repo: '', number: Number(bare[1]) }

  const match = text.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:#(\d+))?$/)
  if (!match) return null
  return { owner: match[1], repo: match[2], number: match[3] ? Number(match[3]) : null }
}

/**
 * Extract `owner/repo` from any git remote URL a GitHub checkout uses:
 * `git@github.com:owner/repo.git`, `ssh://git@github.com/owner/repo.git`,
 * `https://github.com/owner/repo.git`, `https://user@host/owner/repo`.
 * The host is not checked: a mirror remote pointing elsewhere still names a repository.
 */
export function parseRemoteUrl(url) {
  if (typeof url !== 'string') return null
  const text = url.trim()
  if (!text) return null

  const scp = text.match(/^[A-Za-z0-9_.-]+@[^:]+:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/)
  if (scp) return { owner: scp[1], repo: scp[2], number: null, host: text.split(':')[0].split('@')[1] || '' }

  try {
    const parsed = new URL(text)
    const parts = parsed.pathname.replace(/^\/+/, '').replace(/\.git$/, '').split('/')
    if (parts.length >= 2 && parts[0] && parts[1]) {
      return { owner: parts[0], repo: parts[1], number: null, host: parsed.hostname }
    }
  } catch {
    // not a URL and not an scp-style remote
  }
  return null
}

/**
 * Decide the repository for one call.
 *
 * Order: an explicit reference, then the configured default, then the origin remote of the
 * working copy. `number` (a pull request or issue) is carried through so a caller can pass
 * "123" and keep the repository it was already talking to.
 */
export function resolveRepoContext({ explicit, fallback, remoteUrl, remotes = {} } = {}) {
  const fromExplicit = parseRef(explicit)
  if (fromExplicit && fromExplicit.owner && fromExplicit.repo) return { ...fromExplicit, source: 'explicit' }

  const fromFallback = parseRef(fallback)
  if (fromFallback && fromFallback.owner && fromFallback.repo) {
    return { ...fromFallback, number: fromExplicit && fromExplicit.number ? fromExplicit.number : null, source: 'settings' }
  }

  const fromRemote = parseRemoteUrl(remoteUrl) || parseRemoteUrl(remotes.origin) || parseRemoteUrl(remotes.github)
  if (fromRemote) {
    return { ...fromRemote, number: fromExplicit && fromExplicit.number ? fromExplicit.number : null, source: 'remote' }
  }
  if (fromExplicit && fromExplicit.number) {
    throw new Error('a pull request or issue number needs a repository: pass "owner/repo#N", set a default repository in the plugin settings, or run inside a checkout with an origin remote')
  }
  return null
}
