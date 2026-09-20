import test from 'node:test'
import assert from 'node:assert/strict'

import {
  globToRegExp,
  matchesAnyGlob,
  normalizeRules,
  analyzePull,
  areasFor,
  verdictFor,
  DEFAULT_RULES,
} from '../lib/review-rules.js'

test('a glob without a slash matches a basename at any depth', () => {
  assert.ok(matchesAnyGlob('config/.env', ['.env']))
  assert.ok(matchesAnyGlob('.env', ['.env']))
  assert.ok(matchesAnyGlob('certs/server.pem', ['**/*.pem']))
  assert.ok(matchesAnyGlob('server.pem', ['*.pem']))
  assert.ok(!matchesAnyGlob('lib/server.pem/readme', ['*.pem']))
  assert.ok(!matchesAnyGlob('env.example', ['.env']))
})

test('a glob with a slash is anchored to the repository root', () => {
  assert.ok(matchesAnyGlob('lib/a.js', ['lib/**/*.js']))
  assert.ok(matchesAnyGlob('lib/deep/a.js', ['lib/**/*.js']))
  assert.ok(matchesAnyGlob('lib/a.js', ['lib/*.js']))
  assert.ok(!matchesAnyGlob('src/lib/a.js', ['lib/*.js']), 'an anchored pattern does not float')
  assert.ok(matchesAnyGlob('.github/workflows/ci.yml', ['.github/workflows/*']))
})

test('globToRegExp handles **, * and ?', () => {
  assert.ok(globToRegExp('a/**/b').test('a/b'))
  assert.ok(globToRegExp('a/**/b').test('a/x/y/b'))
  assert.ok(!globToRegExp('a/*/b').test('a/x/y/b'))
  assert.ok(globToRegExp('file?.js').test('file1.js'))
  assert.ok(!globToRegExp('file?.js').test('file12.js'))
  assert.ok(globToRegExp('literal.name.js').test('literal.name.js'), 'dots are literal')
})

test('normalizeRules fills gaps and repairs nonsense', () => {
  const merged = normalizeRules({ sensitivePaths: ['custom/**'], largeDiffLines: -5, sensitiveSeverity: 'nonsense' })
  assert.deepEqual(merged.sensitivePaths, ['custom/**'])
  assert.equal(merged.largeDiffLines, DEFAULT_RULES.largeDiffLines)
  assert.equal(merged.sensitiveSeverity, DEFAULT_RULES.sensitiveSeverity)
  assert.ok(Array.isArray(merged.attentionPaths), 'missing lists fall back to the defaults')
  assert.deepEqual(normalizeRules(undefined).sensitivePaths, DEFAULT_RULES.sensitivePaths)
})

test('sensitive paths are critical, and custom patterns are honoured', () => {
  const findings = analyzePull({
    files: [{ filename: '.env', additions: 1, deletions: 0 }, { filename: 'lib/a.js', additions: 2, deletions: 0 }],
    rules: { testsRequired: false },
  })
  const sensitive = findings.find((f) => f.area === 'sensitive-paths')
  assert.equal(sensitive.level, 'critical')
  assert.match(sensitive.detail, /\.env/)

  const custom = analyzePull({
    files: [{ filename: 'private/stuff.txt', additions: 1, deletions: 0 }],
    rules: { sensitivePaths: ['private/**'], testsRequired: false },
  })
  assert.equal(custom.find((f) => f.area === 'sensitive-paths').level, 'critical')

  const softened = analyzePull({
    files: [{ filename: '.env', additions: 1, deletions: 0 }],
    rules: { sensitiveSeverity: 'attention', testsRequired: false },
  })
  assert.equal(softened.find((f) => f.area === 'sensitive-paths').level, 'attention')
})

test('infrastructure, migrations and missing tests are attention, never critical', () => {
  const findings = analyzePull({
    files: [
      { filename: '.github/workflows/ci.yml', additions: 1, deletions: 1 },
      { filename: 'migrations/001.sql', additions: 3, deletions: 0 },
      { filename: 'lib/a.js', additions: 5, deletions: 1 },
    ],
  })
  const areas = findings.map((f) => f.area)
  assert.ok(areas.includes('attention-paths'))
  assert.ok(areas.includes('migration'))
  assert.ok(areas.includes('tests'))
  assert.ok(findings.every((f) => f.level !== 'critical'), 'nothing here is critical')
})

test('a change that touches tests is not nagged about tests', () => {
  const findings = analyzePull({
    files: [
      { filename: 'lib/a.js', additions: 5, deletions: 0 },
      { filename: 'test/a.test.mjs', additions: 5, deletions: 0 },
    ],
  })
  assert.ok(!findings.some((f) => f.area === 'tests'))
})

test('a large diff and an empty diff are both reported, and findings are ordered', () => {
  const large = analyzePull({ files: [{ filename: 'lib/big.js', additions: 900, deletions: 10 }] })
  assert.ok(large.some((f) => f.area === 'size'))
  const empty = analyzePull({ files: [] })
  assert.deepEqual(empty, [{ level: 'info', area: 'empty', detail: 'no files in the diff' }])

  const ordered = analyzePull({
    files: [{ filename: '.env', additions: 1, deletions: 0 }, { filename: 'migrations/x.sql', additions: 1, deletions: 0 }],
  })
  assert.equal(ordered[0].level, 'critical', 'critical findings come first')
})

test('areasFor groups paths into top-level areas', () => {
  assert.deepEqual(
    areasFor([{ filename: 'lib/a.js' }, { filename: 'lib/b.js' }, { filename: 'test/c.test.mjs' }, { filename: 'README.md' }]),
    ['README', 'lib', 'test'],
  )
})

test('verdictFor blocks on a critical finding or a failed rollup', () => {
  assert.equal(verdictFor({ findings: [{ level: 'critical' }] }), 'needs-changes')
  assert.equal(verdictFor({ findings: [], checkRollup: 'failure' }), 'needs-changes')
  assert.equal(verdictFor({ findings: [{ level: 'attention' }], checkRollup: 'success' }), 'success')
  assert.equal(verdictFor({ findings: [{ level: 'attention' }], checkRollup: 'pending' }), 'success', 'pending is not a failure')
})
