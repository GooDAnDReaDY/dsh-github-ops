// Organization repositories status matrix: releases, npm versions, CI status and issues.
//
// Read-only, concurrency-batched, cached with TTL to preserve GitHub rate limits.

const MATRIX_CACHE = new Map()

export function clearMatrixCache() {
  MATRIX_CACHE.clear()
}

/**
 * Determine health status badge based on CI, releases, issues.
 */
function deriveStatus(release, ci, openIssuesCount) {
  if (ci && (ci.conclusion === 'failure' || ci.conclusion === 'timed_out')) return 'failing'
  if (ci && (ci.status === 'in_progress' || ci.status === 'queued')) return 'building'
  if (ci && ci.conclusion === 'success') return 'healthy'
  if (release) return 'released'
  return 'active'
}

/**
 * Fetch published package metadata from npm registry.
 */
async function fetchNpmVersion(pkgName, fetchFn = globalThis.fetch) {
  if (!pkgName || typeof fetchFn !== 'function') return null
  try {
    const encoded = pkgName.startsWith('@')
      ? `@${encodeURIComponent(pkgName.slice(1))}`
      : encodeURIComponent(pkgName)
    const url = `https://registry.npmjs.org/${encoded}`
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
    const timer = controller ? setTimeout(() => controller.abort(), 4000) : null
    const res = await fetchFn(url, {
      headers: { accept: 'application/json' },
      signal: controller ? controller.signal : undefined,
    })
    if (timer) clearTimeout(timer)
    if (!res.ok) return null
    const data = await res.json()
    const latest = data['dist-tags']?.latest || data.version
    return latest ? { name: pkgName, version: latest } : null
  } catch {
    return null
  }
}

/**
 * Gather organization matrix status.
 */
export async function matrixStatus(client, options = {}, deps = {}) {
  const {
    org = '',
    limit = 30,
    includeNpm = true,
    includeCi = true,
    includeReleases = true,
    cacheTtlMs = 60000,
  } = options
  const { fetchFn = globalThis.fetch } = deps

  const cappedLimit = Math.max(1, Math.min(Number(limit) || 30, 100))

  // Determine target org / user
  let targetOrg = String(org || '').trim()
  if (!targetOrg) {
    try {
      const userRes = await client.get('/user')
      targetOrg = userRes.data?.login || ''
    } catch {
      targetOrg = ''
    }
  }
  if (!targetOrg) {
    throw new Error('an organization or user name is required')
  }

  // Check cache
  const cacheKey = `${targetOrg}:${cappedLimit}:${includeNpm}:${includeCi}:${includeReleases}`
  const cached = MATRIX_CACHE.get(cacheKey)
  if (cached && (Date.now() - cached.timestamp < cacheTtlMs)) {
    return { ...cached.data, cached: true }
  }

  // Fetch repositories
  let rawRepos = []
  try {
    const orgRes = await client.get(`/orgs/${targetOrg}/repos`, {
      query: { per_page: cappedLimit, sort: 'pushed', direction: 'desc' },
    })
    rawRepos = Array.isArray(orgRes.data) ? orgRes.data : []
  } catch (err) {
    // Fallback to user repos if not an org
    try {
      const userRes = await client.get(`/users/${targetOrg}/repos`, {
        query: { per_page: cappedLimit, sort: 'pushed', direction: 'desc' },
      })
      rawRepos = Array.isArray(userRes.data) ? userRes.data : []
    } catch {
      rawRepos = []
    }
  }

  const repos = rawRepos.filter((r) => !r.archived).slice(0, cappedLimit)

  // Concurrency batching: process in chunks of 5
  const matrix = []
  const chunkSize = 5

  for (let i = 0; i < repos.length; i += chunkSize) {
    const chunk = repos.slice(i, i + chunkSize)
    const chunkResults = await Promise.all(
      chunk.map(async (repo) => {
        const owner = repo.owner?.login || targetOrg
        const repoName = repo.name

        let release = null
        let ci = null
        let npm = null
        let repoError = null

        // 1. Release / Tag
        if (includeReleases) {
          try {
            const relRes = await client.get(`/repos/${owner}/${repoName}/releases/latest`)
            if (relRes.data && relRes.data.tag_name) {
              release = {
                tag: relRes.data.tag_name,
                name: relRes.data.name || relRes.data.tag_name,
                publishedAt: relRes.data.published_at,
                prerelease: Boolean(relRes.data.prerelease),
                htmlUrl: relRes.data.html_url,
              }
            }
          } catch {
            // Fallback to tags
            try {
              const tagsRes = await client.get(`/repos/${owner}/${repoName}/tags`, { query: { per_page: 1 } })
              if (Array.isArray(tagsRes.data) && tagsRes.data[0]) {
                const tag = tagsRes.data[0]
                release = {
                  tag: tag.name,
                  name: tag.name,
                  htmlUrl: `${repo.html_url}/releases/tag/${tag.name}`,
                }
              }
            } catch {
              // no release or tag
            }
          }
        }

        // 2. Latest CI Run
        if (includeCi) {
          try {
            const runsRes = await client.get(`/repos/${owner}/${repoName}/actions/runs`, { query: { per_page: 1 } })
            const runs = runsRes.data?.workflow_runs
            if (Array.isArray(runs) && runs[0]) {
              const run = runs[0]
              ci = {
                id: run.id,
                name: run.name || 'CI',
                status: run.status,
                conclusion: run.conclusion,
                htmlUrl: run.html_url,
                createdAt: run.created_at,
              }
            }
          } catch {
            // CI not available or actions disabled
          }
        }

        // 3. npm version
        if (includeNpm) {
          // Check package.json in repo first for exact name
          let pkgName = `@${targetOrg}/${repoName}`
          try {
            const pkgFileRes = await client.get(`/repos/${owner}/${repoName}/contents/package.json`)
            if (pkgFileRes.data && pkgFileRes.data.content) {
              const raw = Buffer.from(pkgFileRes.data.content, 'base64').toString('utf8')
              const parsed = JSON.parse(raw)
              if (parsed.name) pkgName = parsed.name
            }
          } catch {
            // package.json missing or unparseable
          }

          npm = await fetchNpmVersion(pkgName, fetchFn)
          if (!npm && pkgName !== repoName) {
            npm = await fetchNpmVersion(repoName, fetchFn)
          }
        }

        const openIssuesCount = Number(repo.open_issues_count) || 0
        const status = deriveStatus(release, ci, openIssuesCount)

        return {
          name: repoName,
          fullName: repo.full_name || `${owner}/${repoName}`,
          private: Boolean(repo.private),
          description: repo.description || '',
          stars: repo.stargazers_count || 0,
          openIssuesCount,
          defaultBranch: repo.default_branch || 'main',
          pushedAt: repo.pushed_at,
          htmlUrl: repo.html_url,
          release,
          ci,
          npm,
          status,
          error: repoError,
        }
      })
    )
    matrix.push(...chunkResults)
  }

  const resultData = {
    org: targetOrg,
    totalRepos: matrix.length,
    cached: false,
    timestamp: new Date().toISOString(),
    matrix,
  }

  MATRIX_CACHE.set(cacheKey, { timestamp: Date.now(), data: resultData })
  return resultData
}
