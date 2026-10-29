import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { normalizeRepo } from './repos.js'
import { normalizeIssue } from './issues.js'

/**
 * Normalizes user-supplied axes definition into an array of { name, query }.
 */
export function normalizeAxes(rawAxes) {
  if (!rawAxes) return []
  if (!Array.isArray(rawAxes)) {
    if (typeof rawAxes === 'object') {
      return Object.entries(rawAxes).map(([name, query]) => ({ name: String(name).trim(), query: String(query).trim() }))
    }
    return []
  }
  return rawAxes.map((item) => {
    if (typeof item === 'string') {
      const idx = item.indexOf('|')
      if (idx !== -1) {
        return { name: item.slice(0, idx).trim(), query: item.slice(idx + 1).trim() }
      }
      return { name: item.trim(), query: item.trim() }
    }
    if (item && typeof item === 'object') {
      return {
        name: String(item.name || item.axis || item.title || '').trim(),
        query: String(item.query || item.q || '').trim(),
      }
    }
    return { name: '', query: '' }
  }).filter((a) => Boolean(a.name && a.query))
}

/**
 * Check if a repository is an awesome-* or curated list.
 */
export function isCuratedList(repo) {
  if (!repo) return false
  const fullName = String(repo.fullName || repo.name || '').toLowerCase()
  const repoName = fullName.includes('/') ? fullName.split('/')[1] : fullName
  const desc = String(repo.description || '').toLowerCase()
  const topics = Array.isArray(repo.topics) ? repo.topics.map((t) => String(t).toLowerCase()) : []

  if (repoName.includes('awesome') || fullName.includes('/awesome')) return true
  if (topics.includes('awesome') || topics.includes('awesome-list') || topics.includes('curated-list')) return true
  if (desc.startsWith('a curated list') || desc.startsWith('curated list') || desc.includes('awesome list of') || desc.includes('curated list of')) return true
  return false
}

/**
 * Smart repository search with default exclusions of forks/archived and minStars threshold.
 */
export async function findRepos(client, {
  query,
  minStars = 10,
  includeForks = false,
  includeArchived = false,
  language,
  topic,
  scope = 'all',
  sort = 'stars',
  order = 'desc',
  limit = 20,
} = {}) {
  if (!query || typeof query !== 'string' || !query.trim()) {
    throw new Error('query is required for findRepos')
  }

  const parts = [query.trim()]
  if (!includeForks && !query.includes('fork:')) parts.push('fork:false')
  if (!includeArchived && !query.includes('archived:')) parts.push('archived:false')
  if (minStars !== undefined && minStars !== null && Number(minStars) > 0 && !query.includes('stars:')) {
    parts.push(`stars:>=${Number(minStars)}`)
  }
  if (language && !query.includes('language:')) parts.push(`language:${language}`)
  if (topic && !query.includes('topic:')) parts.push(`topic:${topic}`)
  if (scope === 'readme' && !query.includes('in:readme')) parts.push('in:readme')

  const q = parts.join(' ')
  const capped = Math.max(1, Math.min(Number(limit) || 20, 100))

  const { data } = await client.get('/search/repositories', {
    query: { q, sort, order, per_page: capped },
  })

  const rawItems = (data && data.items) || []
  // Deduplicate by full_name
  const seen = new Set()
  const repos = []
  for (const item of rawItems) {
    const normalized = normalizeRepo(item)
    if (normalized && normalized.fullName && !seen.has(normalized.fullName)) {
      seen.add(normalized.fullName)
      repos.push(normalized)
    }
  }

  return {
    total: (data && data.total_count) || repos.length,
    count: repos.length,
    query: q,
    repos,
  }
}

/**
 * Compute multi-axis relevance score for a repository.
 */
export function calculateRepoScore(repo, matchedAxesCount, totalAxesCount) {
  const stars = Number(repo.stars) || 0
  const forks = Number(repo.forks) || 0

  // 1. Star base (logarithmic)
  const starScore = Math.log10(Math.max(stars, 1)) * 12

  // 2. Fork bonus
  const forkScore = Math.log10(Math.max(forks, 1)) * 3

  // 3. Recency bonus
  let recencyBonus = 0
  if (repo.pushedAt) {
    const daysSincePush = (Date.now() - new Date(repo.pushedAt).getTime()) / (1000 * 60 * 60 * 24)
    if (daysSincePush <= 90) recencyBonus = 8
    else if (daysSincePush <= 365) recencyBonus = 4
  }

  let baseScore = starScore + forkScore + recencyBonus

  // 4. Cross-axis multiplier & bonus
  // Cross-axis hits are the primary relevance signal (a project relevant to multiple aspects of a problem)
  if (matchedAxesCount >= 4) {
    baseScore = baseScore * 5.0 + 100
  } else if (matchedAxesCount === 3) {
    baseScore = baseScore * 3.5 + 60
  } else if (matchedAxesCount === 2) {
    baseScore = baseScore * 2.2 + 30
  }

  // 5. Awesome-list penalty: demote curated lists so real software/frameworks lead the results
  const isCurated = isCuratedList(repo)
  if (isCurated) {
    baseScore = Math.max(1, baseScore * 0.3 - 25)
  }

  return {
    score: Math.round(baseScore * 10) / 10,
    isCuratedList: isCurated,
  }
}

/**
 * Multi-axis GitHub topic investigation with cross-axis scoring, awesome-list penalty,
 * and context-saving summary (<= 3 KB) with disk dump.
 */
export async function exploreTopic(client, {
  axes: rawAxes,
  minStars = 10,
  limitPerAxis = 20,
  writeReport = true,
  reportPath,
} = {}) {
  const axes = normalizeAxes(rawAxes)
  if (axes.length < 2) {
    throw new Error('exploreTopic requires at least 2 axes (e.g. [{ name: "frameworks", query: "..." }, { name: "protocols", query: "..." }])')
  }
  if (axes.length > 5) {
    throw new Error('exploreTopic supports up to 5 axes')
  }

  const cappedPerAxis = Math.max(5, Math.min(Number(limitPerAxis) || 20, 50))

  // Run searches in parallel
  const axisResults = await Promise.all(
    axes.map(async (axis) => {
      try {
        const res = await findRepos(client, {
          query: axis.query,
          minStars,
          limit: cappedPerAxis,
        })
        return { axis: axis.name, query: axis.query, ok: true, repos: res.repos || [] }
      } catch (err) {
        return { axis: axis.name, query: axis.query, ok: false, error: String((err && err.message) || err), repos: [] }
      }
    }),
  )

  // Aggregate repos across all axes
  const repoMap = new Map() // fullName -> { repo, matchedAxes: Set<string> }

  for (const { axis, repos } of axisResults) {
    for (const repo of repos) {
      if (!repo || !repo.fullName) continue
      if (!repoMap.has(repo.fullName)) {
        repoMap.set(repo.fullName, {
          ...repo,
          matchedAxes: new Set([axis]),
        })
      } else {
        repoMap.get(repo.fullName).matchedAxes.add(axis)
      }
    }
  }

  // Score all unique repositories
  const allScored = []
  for (const entry of repoMap.values()) {
    const matchedAxes = Array.from(entry.matchedAxes)
    const { score, isCuratedList: isCurated } = calculateRepoScore(entry, matchedAxes.length, axes.length)
    allScored.push({
      ...entry,
      matchedAxes,
      matchedCount: matchedAxes.length,
      score,
      isCuratedList: isCurated,
    })
  }

  // Sort by score desc
  allScored.sort((a, b) => b.score - a.score)

  // Identify cross-axis leaders (matched >= 2 axes)
  const crossAxisLeaders = allScored.filter((r) => r.matchedCount >= 2 && !r.isCuratedList)

  // Top repositories per axis
  const topByAxis = {}
  for (const axis of axes) {
    const forAxis = allScored.filter((r) => r.matchedAxes.includes(axis.name) && !r.isCuratedList)
    topByAxis[axis.name] = forAxis.slice(0, 3).map((r) => ({
      fullName: r.fullName,
      score: r.score,
      stars: r.stars,
      language: r.language || 'Unknown',
      description: r.description ? r.description.slice(0, 90) : '',
      url: r.url,
    }))
  }

  // Curated lists
  const curatedLists = allScored.filter((r) => r.isCuratedList)

  // Full detailed report structure
  const fullReport = {
    generatedAt: new Date().toISOString(),
    axes: axes.map((a) => a.name),
    totalUnique: allScored.length,
    crossAxisCount: crossAxisLeaders.length,
    axisBreakdown: axisResults.map((ar) => ({
      axis: ar.axis,
      query: ar.query,
      foundCount: ar.repos.length,
      error: ar.error || null,
    })),
    crossAxisLeaders: crossAxisLeaders.map((r) => ({
      fullName: r.fullName,
      score: r.score,
      matchedAxes: r.matchedAxes,
      stars: r.stars,
      forks: r.forks,
      language: r.language,
      topics: r.topics,
      description: r.description,
      pushedAt: r.pushedAt,
      url: r.url,
    })),
    topByAxis,
    curatedLists: curatedLists.map((r) => ({
      fullName: r.fullName,
      score: r.score,
      stars: r.stars,
      description: r.description,
      url: r.url,
    })),
    allRepositories: allScored.map((r) => ({
      fullName: r.fullName,
      score: r.score,
      matchedAxes: r.matchedAxes,
      stars: r.stars,
      forks: r.forks,
      language: r.language,
      description: r.description,
      url: r.url,
    })),
  }

  let fullReportPath = null
  if (writeReport !== false) {
    const targetDir = os.tmpdir()
    fullReportPath = reportPath || path.join(targetDir, `dsh-explore-${Date.now()}.json`)
    try {
      await fs.writeFile(fullReportPath, JSON.stringify(fullReport, null, 2), 'utf8')
    } catch {
      // degrade gracefully if filesystem write fails
      fullReportPath = null
    }
  }

  // Context economy: compact summary guaranteed <= 3 KB
  const compactSummary = {
    summary: `Explored ${axes.length} axes (${axes.map((a) => a.name).join(', ')}). Discovered ${allScored.length} unique repositories, ${crossAxisLeaders.length} cross-axis leaders.`,
    axes: axes.map((a) => a.name),
    totalUnique: allScored.length,
    crossAxisLeaders: crossAxisLeaders.slice(0, 5).map((r) => ({
      fullName: r.fullName,
      score: r.score,
      matchedAxes: r.matchedAxes,
      stars: r.stars,
      language: r.language,
      description: r.description ? r.description.slice(0, 80) : '',
      url: r.url,
    })),
    topByAxis,
    curatedLists: curatedLists.slice(0, 3).map((r) => ({
      fullName: r.fullName,
      stars: r.stars,
      url: r.url,
    })),
    awesomeLists: curatedLists.slice(0, 3).map((r) => ({
      fullName: r.fullName,
      stars: r.stars,
      url: r.url,
    })),
    fullReportPath,
  }

  return compactSummary
}

/**
 * Global and scoped issue & PR search with rich filters.
 */
export async function searchIssuesAdvanced(client, {
  query = '',
  repo,
  org,
  author,
  assignee,
  state = 'open',
  type = 'all',
  labels,
  sort = 'updated',
  order = 'desc',
  limit = 25,
} = {}) {
  const parts = []
  if (query && typeof query === 'string' && query.trim()) {
    parts.push(query.trim())
  }
  if (repo && typeof repo === 'string' && repo.trim()) {
    parts.push(`repo:${repo.trim()}`)
  }
  if (org && typeof org === 'string' && org.trim()) {
    parts.push(`org:${org.trim()}`)
  }
  if (state && state !== 'all') {
    parts.push(`is:${state}`)
  }
  if (type === 'issue') {
    parts.push('is:issue')
  } else if (type === 'pr' || type === 'pull') {
    parts.push('is:pr')
  }
  if (author && typeof author === 'string' && author.trim()) {
    parts.push(`author:${author.trim()}`)
  }
  if (assignee && typeof assignee === 'string' && assignee.trim()) {
    parts.push(`assignee:${assignee.trim()}`)
  }
  if (labels) {
    const list = Array.isArray(labels)
      ? labels
      : String(labels).split(',').map((s) => s.trim()).filter(Boolean)
    for (const l of list) {
      parts.push(l.includes(' ') ? `label:"${l}"` : `label:${l}`)
    }
  }

  const q = parts.join(' ').trim()
  if (!q) {
    throw new Error('at least one filter (query, repo, org, author, labels, etc.) is required for issue search')
  }

  const capped = Math.max(1, Math.min(Number(limit) || 25, 100))
  const { data } = await client.get('/search/issues', {
    query: { q, sort, order, per_page: capped },
  })

  const rawItems = (data && data.items) || []
  const issues = rawItems.slice(0, capped).map((i) => ({
    ...normalizeIssue(i),
    repository: i.repository_url ? String(i.repository_url).replace(/^.*\/repos\//, '') : undefined,
  }))

  return {
    total: (data && data.total_count) || issues.length,
    count: issues.length,
    query: q,
    issues,
  }
}
