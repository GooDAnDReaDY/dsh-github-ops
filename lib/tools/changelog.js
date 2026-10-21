// Conventional changelog generation and SemVer recommendation tools.
// Pure functions over GitHub client or commit arrays.

export const CATEGORIES = {
  breaking: { key: 'breaking', title: '⚠️ Breaking Changes', order: 1 },
  feat: { key: 'feat', title: '🚀 Features', order: 2 },
  fix: { key: 'fix', title: '🐛 Bug Fixes', order: 3 },
  perf: { key: 'perf', title: '⚡ Performance Improvements', order: 4 },
  refactor: { key: 'refactor', title: '♻️ Code Refactoring', order: 5 },
  docs: { key: 'docs', title: '📚 Documentation', order: 6 },
  test: { key: 'test', title: '🧪 Tests', order: 7 },
  maintenance: { key: 'maintenance', title: '🛠️ Maintenance', order: 8 },
  other: { key: 'other', title: '📦 Other Changes', order: 9 },
}

const TYPE_TO_CATEGORY = {
  feat: 'feat',
  feature: 'feat',
  fix: 'fix',
  bugfix: 'fix',
  perf: 'perf',
  refactor: 'refactor',
  docs: 'docs',
  doc: 'docs',
  test: 'test',
  tests: 'test',
  chore: 'maintenance',
  ci: 'maintenance',
  build: 'maintenance',
  deps: 'maintenance',
  style: 'maintenance',
}

const CONVENTIONAL_RE = /^([a-zA-Z]+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/

/** Parse a single commit message into conventional commit structure. */
export function parseConventionalCommit(rawMessage, sha = '') {
  const full = String(rawMessage || '').trim()
  const lines = full.split('\n').map((l) => l.trim())
  const header = lines[0] || ''
  const body = lines.slice(1).join('\n')

  let type = 'other'
  let scope = ''
  let isBreaking = false
  let subject = header
  let breakingNote = ''

  // Check for BREAKING CHANGE in body or footer
  const breakingMatch = body.match(/BREAKING[- ]CHANGE:\s*([^\n]+)/i)
  if (breakingMatch) {
    isBreaking = true
    breakingNote = breakingMatch[1].trim()
  }

  const match = header.match(CONVENTIONAL_RE)
  if (match) {
    type = match[1].toLowerCase()
    scope = match[2] ? match[2].trim() : ''
    if (match[3] === '!') isBreaking = true
    subject = match[4].trim()
  } else {
    // Handle typical merge pull request headers e.g. "Merge pull request #123 from org/branch"
    const prMatch = header.match(/^Merge pull request #(\d+)/i)
    if (prMatch) {
      const candidateLine = lines.slice(1).find((l) => l.trim().length > 0)
      if (candidateLine) {
        const subMatch = candidateLine.match(CONVENTIONAL_RE)
        if (subMatch) {
          type = subMatch[1].toLowerCase()
          scope = subMatch[2] ? subMatch[2].trim() : ''
          if (subMatch[3] === '!') isBreaking = true
          subject = `${subMatch[4].trim()} (#${prMatch[1]})`
        }
      }
    }
  }

  const categoryKey = isBreaking
    ? 'breaking'
    : (TYPE_TO_CATEGORY[type] || 'other')

  return {
    sha: sha ? sha.slice(0, 7) : '',
    fullSha: sha || '',
    raw: full,
    header,
    type,
    scope,
    subject,
    isBreaking,
    breakingNote,
    category: categoryKey,
  }
}

/** Calculate recommended SemVer bump from parsed commits. */
export function calculateBump(commits = []) {
  if (!Array.isArray(commits) || commits.length === 0) return 'none'
  if (commits.some((c) => c.isBreaking || c.category === 'breaking')) return 'major'
  if (commits.some((c) => c.type === 'feat' || c.category === 'feat')) return 'minor'
  return 'patch'
}

/** Bump a SemVer version string according to bump type ('major', 'minor', 'patch'). */
export function bumpVersion(version, bump) {
  if (!version || bump === 'none') return version || '0.1.0'
  const hasV = version.startsWith('v')
  const clean = hasV ? version.slice(1) : version
  const parts = clean.split('-')[0].split('.').map(Number)
  let [major = 0, minor = 0, patch = 0] = parts

  if (bump === 'major') {
    major += 1
    minor = 0
    patch = 0
  } else if (bump === 'minor') {
    minor += 1
    patch = 0
  } else if (bump === 'patch') {
    patch += 1
  }

  const res = `${major}.${minor}.${patch}`
  return hasV ? `v${res}` : res
}

/** Format parsed commits into structured markdown changelog. */
export function formatChangelog({ version = '', date = '', sections = {}, compareUrl = '' } = {}) {
  const headerDate = date || new Date().toISOString().slice(0, 10)
  const lines = []
  if (version) {
    lines.push(`## [${version}] - ${headerDate}`)
  } else {
    lines.push(`## Changelog - ${headerDate}`)
  }
  lines.push('')

  const sortedCategories = Object.values(CATEGORIES).sort((a, b) => a.order - b.order)

  let hasEntries = false
  for (const cat of sortedCategories) {
    const list = sections[cat.key] || []
    if (list.length === 0) continue
    hasEntries = true
    lines.push(`### ${cat.title}`)
    for (const item of list) {
      const scopePart = item.scope ? `**${item.scope}**: ` : ''
      const shaPart = item.sha ? ` (${item.sha})` : ''
      const breakingPrefix = (cat.key === 'breaking' && item.breakingNote) ? `*${item.breakingNote}* — ` : ''
      lines.push(`- ${scopePart}${breakingPrefix}${item.subject}${shaPart}`)
    }
    lines.push('')
  }

  if (!hasEntries) {
    lines.push('*No significant user-facing changes.*')
    lines.push('')
  }

  if (compareUrl) {
    lines.push(`[Full Diff](${compareUrl})`)
    lines.push('')
  }

  return lines.join('\n').trim()
}

/** High level changelog generator. */
export async function generateChangelog(client, {
  owner, repo, base, head = 'HEAD', version, date, commits: customCommits,
} = {}) {
  let commitList = []
  let compareUrl = ''
  let previousTag = base || ''

  if (Array.isArray(customCommits)) {
    commitList = customCommits.map((c) => {
      if (typeof c === 'string') return { message: c, sha: '' }
      return { message: c.message || c.commit?.message || '', sha: c.sha || '' }
    })
  } else if (client && owner && repo) {
    if (!previousTag) {
      try {
        const { data: tags } = await client.get(`/repos/${owner}/${repo}/tags`, { query: { per_page: 1 } })
        if (Array.isArray(tags) && tags.length > 0) {
          previousTag = tags[0].name
        }
      } catch {
        // ignore tag fetch failure
      }
    }

    if (previousTag) {
      try {
        const { data } = await client.get(`/repos/${owner}/${repo}/compare/${encodeURIComponent(previousTag)}...${encodeURIComponent(head)}`)
        compareUrl = data?.html_url || ''
        const rawCommits = data?.commits || []
        commitList = rawCommits.map((c) => ({
          message: c.commit?.message || '',
          sha: c.sha || '',
          author: c.author?.login || c.commit?.author?.name || '',
        }))
      } catch {
        commitList = []
      }
    } else {
      try {
        const { data } = await client.get(`/repos/${owner}/${repo}/commits`, { query: { per_page: 50, sha: head } })
        const rawCommits = Array.isArray(data) ? data : []
        commitList = rawCommits.map((c) => ({
          message: c.commit?.message || '',
          sha: c.sha || '',
          author: c.author?.login || c.commit?.author?.name || '',
        }))
      } catch {
        commitList = []
      }
    }
  }

  const parsed = commitList.map((c) => parseConventionalCommit(c.message, c.sha))
  const sections = {}
  for (const catKey of Object.keys(CATEGORIES)) {
    sections[catKey] = []
  }
  for (const item of parsed) {
    const key = item.category in sections ? item.category : 'other'
    sections[key].push(item)
    if (item.isBreaking && item.type in sections && item.type !== 'breaking') {
      sections[item.type].push(item)
    }
  }

  const recommendedBump = calculateBump(parsed)
  const nextVersion = version || (previousTag ? bumpVersion(previousTag, recommendedBump) : bumpVersion('0.1.0', recommendedBump))
  const markdown = formatChangelog({ version: nextVersion, date, sections, compareUrl })

  return {
    version: nextVersion,
    previousTag: previousTag || null,
    head,
    recommendedBump,
    commitsCount: parsed.length,
    summary: {
      breaking: sections.breaking.length,
      feat: sections.feat.length,
      fix: sections.fix.length,
      perf: sections.perf.length,
      refactor: sections.refactor.length,
      docs: sections.docs.length,
      test: sections.test.length,
      maintenance: sections.maintenance.length,
      other: sections.other.length,
      total: parsed.length,
    },
    sections,
    markdown,
    commits: parsed,
  }
}
