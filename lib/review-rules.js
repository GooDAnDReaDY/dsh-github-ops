// Deterministic review rules.
//
// These are rules, not a model: they point a reader at what needs human attention and are
// never presented as a verdict on correctness. Every threshold and path pattern is
// configurable, because what deserves attention differs per repository — a `.gitea/**`
// directory matters here and nowhere else.
//
// Patterns are globs: one without a `/` matches a basename at any depth (`.env` matches
// `config/.env`), one with a `/` matches the whole repository path (`lib/**/*.js`).

export const DEFAULT_RULES = {
  /** Paths that must not change without a human reading the diff. */
  sensitivePaths: [
    '.env', '.env.*', '**/*.pem', '**/*.key', '**/*.p12', '**/*.pfx',
    '.npmrc', '.credentials.yaml', '.credentials.yml',
    'id_rsa', 'id_ed25519', 'id_ecdsa',
    '**/secrets/**', 'AGENTS.md',
  ],
  sensitiveSeverity: 'critical',
  /** Paths that need attention: infrastructure and internal documents. */
  attentionPaths: [
    '.github/workflows/*', '.gitea/workflows/*', 'docs/**', 'index.md', 'deploy.sh',
  ],
  /** Database migrations. */
  migrationPaths: ['migrations/**', '**/migrations/**', '**/migration/**'],
  /** A source change with no test change is worth a look. */
  testsRequired: true,
  sourcePatterns: ['**/*.js', '**/*.mjs', '**/*.cjs', '**/*.ts', '**/*.tsx', '**/*.py', '**/*.go', '**/*.rs', '**/*.java'],
  testPatterns: ['test/**', 'tests/**', '**/*.test.*', '**/*_test.*', '**/test_*'],
  /** A diff larger than this gets a note. */
  largeDiffLines: 800,
}

function escapeLiteral(ch) {
  return ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')
}

/** Translate one glob into a regular expression. `**` crosses directories, `*` does not. */
export function globToRegExp(pattern) {
  const text = String(pattern || '').trim()
  const anchored = text.includes('/')
  const prefix = anchored ? '^' : '^(?:.*/)?'
  let source = prefix
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index]
    if (ch === '*') {
      if (text[index + 1] === '*') {
        // `**/` matches any depth including none
        if (text[index + 2] === '/') {
          source += '(?:.*/)?'
          index += 2
          continue
        }
        source += '.*'
        index += 1
        continue
      }
      source += '[^/]*'
      continue
    }
    if (ch === '?') {
      source += '[^/]'
      continue
    }
    source += escapeLiteral(ch)
  }
  return new RegExp(`${source}$`)
}

/** Whether a repository path matches any of the globs. */
export function matchesAnyGlob(path, patterns = []) {
  const value = String(path || '')
  return patterns.some((pattern) => globToRegExp(pattern).test(value))
}

/** Normalize a caller-supplied rule set over the defaults. */
export function normalizeRules(rules) {
  const merged = { ...DEFAULT_RULES, ...(rules && typeof rules === 'object' ? rules : {}) }
  for (const key of ['sensitivePaths', 'attentionPaths', 'migrationPaths', 'sourcePatterns', 'testPatterns']) {
    if (!Array.isArray(merged[key])) merged[key] = DEFAULT_RULES[key]
  }
  if (!['critical', 'attention', 'info'].includes(merged.sensitiveSeverity)) {
    merged.sensitiveSeverity = DEFAULT_RULES.sensitiveSeverity
  }
  if (!Number.isFinite(merged.largeDiffLines) || merged.largeDiffLines <= 0) {
    merged.largeDiffLines = DEFAULT_RULES.largeDiffLines
  }
  return merged
}

/** Top-level areas touched by a diff, used for a one-line summary. */
export function areasFor(files = []) {
  const areas = new Set()
  for (const file of files) {
    const parts = String(file.filename || file.path || '').split('/')
    areas.add(parts.length > 1 ? parts[0] : (parts[0] || '').replace(/\.[^.]+$/, ''))
  }
  return [...areas].filter(Boolean).sort()
}

/**
 * Findings for one pull request, deterministic and ordered: critical first, then
 * attention, then info, and within a severity by area.
 */
export function analyzePull({ files = [], rules } = {}) {
  const r = normalizeRules(rules)
  const findings = []
  const paths = files.map((f) => f.filename || f.path || '')

  const sensitive = paths.filter((p) => matchesAnyGlob(p, r.sensitivePaths))
  if (sensitive.length) {
    findings.push({ level: r.sensitiveSeverity, area: 'sensitive-paths', detail: `paths that need a human eye: ${sensitive.join(', ')}` })
  }

  const attention = paths.filter((p) => matchesAnyGlob(p, r.attentionPaths))
  if (attention.length) {
    findings.push({ level: 'attention', area: 'attention-paths', detail: `infrastructure or internal documents changed: ${attention.join(', ')}` })
  }

  const migrations = paths.filter((p) => matchesAnyGlob(p, r.migrationPaths))
  if (migrations.length) {
    findings.push({ level: 'attention', area: 'migration', detail: `database migrations touched: ${migrations.join(', ')}` })
  }

  if (r.testsRequired) {
    const sources = paths.filter((p) => matchesAnyGlob(p, r.sourcePatterns))
    const tests = paths.filter((p) => matchesAnyGlob(p, r.testPatterns))
    if (sources.length && !tests.length) {
      findings.push({ level: 'attention', area: 'tests', detail: `${sources.length} source file(s) changed with no test change` })
    }
  }

  const changed = files.reduce((sum, f) => sum + (Number(f.additions) || 0) + (Number(f.deletions) || 0), 0)
  if (changed > r.largeDiffLines) {
    findings.push({ level: 'attention', area: 'size', detail: `large diff: ${changed} changed lines` })
  }
  if (!files.length) findings.push({ level: 'info', area: 'empty', detail: 'no files in the diff' })

  const rank = { critical: 0, attention: 1, info: 2 }
  return findings.sort((a, b) => (rank[a.level] - rank[b.level]) || a.area.localeCompare(b.area))
}

/** Whether the findings and the CI rollup must block a merge. */
export function verdictFor({ findings = [], checkRollup = 'unknown' } = {}) {
  const blocking = findings.filter((f) => f.level === 'critical')
  return blocking.length || checkRollup === 'failure' ? 'needs-changes' : 'success'
}
