import test from 'node:test'
import assert from 'node:assert/strict'

import {
  parseConventionalCommit,
  calculateBump,
  bumpVersion,
  formatChangelog,
  generateChangelog,
  CATEGORIES,
} from '../lib/tools/changelog.js'

test('parseConventionalCommit parses type, scope, subject and breaking flag', () => {
  const feat = parseConventionalCommit('feat(auth): add device code flow', 'sha1234567')
  assert.equal(feat.type, 'feat')
  assert.equal(feat.scope, 'auth')
  assert.equal(feat.subject, 'add device code flow')
  assert.equal(feat.isBreaking, false)
  assert.equal(feat.category, 'feat')
  assert.equal(feat.sha, 'sha1234')

  const fix = parseConventionalCommit('fix: handle 401 unauthorized gracefully')
  assert.equal(fix.type, 'fix')
  assert.equal(fix.scope, '')
  assert.equal(fix.subject, 'handle 401 unauthorized gracefully')
  assert.equal(fix.isBreaking, false)
  assert.equal(fix.category, 'fix')

  const breakingExcl = parseConventionalCommit('feat(core)!: drop legacy node 18 support')
  assert.equal(breakingExcl.type, 'feat')
  assert.equal(breakingExcl.scope, 'core')
  assert.equal(breakingExcl.isBreaking, true)
  assert.equal(breakingExcl.category, 'breaking')

  const breakingFooter = parseConventionalCommit(
    'refactor: overhaul route options\n\nBREAKING CHANGE: route signature now takes context object'
  )
  assert.equal(breakingFooter.isBreaking, true)
  assert.equal(breakingFooter.category, 'breaking')
  assert.equal(breakingFooter.breakingNote, 'route signature now takes context object')

  const prMerge = parseConventionalCommit(
    'Merge pull request #42 from goodandready/fix-auth\n\nfix(token): auto refresh expired token'
  )
  assert.equal(prMerge.type, 'fix')
  assert.equal(prMerge.scope, 'token')
  assert.ok(prMerge.subject.includes('auto refresh expired token'))
  assert.ok(prMerge.subject.includes('#42'))
})

test('calculateBump determines major, minor, patch or none', () => {
  assert.equal(calculateBump([]), 'none')
  assert.equal(calculateBump([{ type: 'chore', category: 'maintenance' }]), 'patch')
  assert.equal(calculateBump([{ type: 'fix', category: 'fix' }]), 'patch')
  assert.equal(calculateBump([{ type: 'fix', category: 'fix' }, { type: 'feat', category: 'feat' }]), 'minor')
  assert.equal(calculateBump([{ type: 'feat', category: 'feat' }, { isBreaking: true, category: 'breaking' }]), 'major')
})

test('bumpVersion bumps semver versions correctly preserving v prefix', () => {
  assert.equal(bumpVersion('v0.6.8', 'patch'), 'v0.6.9')
  assert.equal(bumpVersion('v0.6.8', 'minor'), 'v0.7.0')
  assert.equal(bumpVersion('v0.6.8', 'major'), 'v1.0.0')
  assert.equal(bumpVersion('1.2.3', 'patch'), '1.2.4')
  assert.equal(bumpVersion('1.2.3', 'minor'), '1.3.0')
  assert.equal(bumpVersion('1.2.3', 'major'), '2.0.0')
  assert.equal(bumpVersion('v0.6.8', 'none'), 'v0.6.8')
})

test('formatChangelog renders markdown categorized sections', () => {
  const sections = {
    breaking: [{ scope: 'api', subject: 'drop v1', sha: 'a1b2c3d', breakingNote: 'requires v2 client' }],
    feat: [{ scope: 'auth', subject: 'device flow', sha: 'e4f5a6b' }],
    fix: [{ scope: '', subject: 'fix crash on reload', sha: 'c7d8e9f' }],
  }
  const md = formatChangelog({ version: 'v0.7.0', date: '2026-10-21', sections })
  assert.ok(md.includes('## [v0.7.0] - 2026-10-21'))
  assert.ok(md.includes('### ⚠️ Breaking Changes'))
  assert.ok(md.includes('### 🚀 Features'))
  assert.ok(md.includes('### 🐛 Bug Fixes'))
  assert.ok(md.includes('- **auth**: device flow (e4f5a6b)'))
  assert.ok(md.includes('- fix crash on reload (c7d8e9f)'))
})

test('generateChangelog with custom commits array', async () => {
  const custom = [
    'feat(scm): add cherry-pick and revert',
    'fix(routes): keep strict header',
    'chore: release v0.6.8',
  ]
  const res = await generateChangelog(null, {
    version: 'v0.7.0',
    commits: custom,
  })
  assert.equal(res.version, 'v0.7.0')
  assert.equal(res.recommendedBump, 'minor')
  assert.equal(res.summary.feat, 1)
  assert.equal(res.summary.fix, 1)
  assert.equal(res.summary.maintenance, 1)
  assert.ok(res.markdown.includes('### 🚀 Features'))
})

test('generateChangelog queries client compare endpoint when client is provided', async () => {
  const fakeCommits = [
    { sha: '11111112222222', commit: { message: 'feat: add changelog generator' }, author: { login: 'vadim' } },
    { sha: '33333334444444', commit: { message: 'fix: resolve edge case' }, author: { login: 'vadim' } },
  ]
  const client = {
    get: async (path) => {
      if (path.includes('/compare/')) {
        return { data: { html_url: 'https://github.com/o/r/compare/v0.6.8...HEAD', commits: fakeCommits } }
      }
      if (path.endsWith('/tags')) {
        return { data: [{ name: 'v0.6.8' }] }
      }
      return { data: [] }
    },
  }

  const res = await generateChangelog(client, {
    owner: 'goodandready',
    repo: 'dsh-github-ops',
    base: 'v0.6.8',
    head: 'HEAD',
  })

  assert.equal(res.previousTag, 'v0.6.8')
  assert.equal(res.recommendedBump, 'minor')
  assert.equal(res.version, 'v0.7.0')
  assert.equal(res.summary.feat, 1)
  assert.equal(res.summary.fix, 1)
  assert.ok(res.markdown.includes('[Full Diff](https://github.com/o/r/compare/v0.6.8...HEAD)'))
})
