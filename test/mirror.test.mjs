import test from 'node:test'
import assert from 'node:assert/strict'

import {
  sanitizePaths,
  allowlistFromManifest,
  planMirror,
  publishMirror,
  DEFAULT_FORBIDDEN,
} from '../lib/tools/mirror.js'

const manifest = { name: 'x', files: ['lib', 'cordis.patch.yml', 'README.md', 'LICENSE'] }

/** Fake git runner: answers from a scripted response map, records every call. */
function fakeGit(responses) {
  const calls = []
  const runner = async (args, opts = {}) => {
    calls.push({ args, opts })
    const key = args.join(' ')
    for (const [pattern, value] of responses) {
      if (typeof pattern === 'string' ? key === pattern : pattern.test(key)) {
        return typeof value === 'function' ? value(args, opts, calls) : value
      }
    }
    return { code: 128, stdout: '', stderr: `no fake response for: ${key}` }
  }
  runner.calls = calls
  return runner
}

const ok = (stdout) => ({ code: 0, stdout, stderr: '' })

test('sanitizePaths keeps the product and drops everything else', () => {
  const { publish, drop } = sanitizePaths([
    'package.json', 'README.md', 'lib/index.js', 'lib/tools/api.js',
    'build.py', 'docs/design/DESIGN.md', 'ru-plugins/01.json', '__pycache__/x.pyc',
    'scripts/publish-github.sh', 'AGENTS.md',
  ], { allow: ['package.json', 'README.md', 'lib'] })
  assert.deepEqual(publish, ['README.md', 'lib/index.js', 'lib/tools/api.js', 'package.json'])
  assert.ok(drop.includes('build.py'))
  assert.ok(drop.includes('docs/design/DESIGN.md'), 'internal documentation never reaches a mirror')
  assert.ok(drop.includes('ru-plugins/01.json'))
  assert.ok(drop.includes('__pycache__/x.pyc'))
  assert.ok(drop.includes('AGENTS.md'), 'agent instructions never reach a mirror')
  assert.ok(drop.includes('scripts/publish-github.sh'), 'not in the allowlist here, so it stays behind')
})

test('sanitizePaths publishes the shipped tooling when the manifest lists it', () => {
  const { publish } = sanitizePaths(['scripts/build-client.mjs', 'lib/index.js'], {
    allow: ['lib', 'scripts'],
  })
  assert.deepEqual(publish, ['lib/index.js', 'scripts/build-client.mjs'],
    'the mirror publishes exactly the npm contents, so a shipped script is allowed')
})

test('allowlistFromManifest merges the package files with the reader-facing files', () => {
  const allow = allowlistFromManifest({ files: ['lib/**', 'cordis.patch.yml', 'LICENSE'] })
  assert.ok(allow.includes('lib'))
  assert.ok(allow.includes('README.md'), 'README trio is always allowed')
  assert.ok(allow.includes('CHANGELOG.md'))
  assert.ok(!allow.includes('lib/**'), 'globs are normalized to their directory')
})

test('planMirror reports what would go and refuses when a required file is missing', async () => {
  const git = fakeGit([
    ['show origin/main:package.json', ok(JSON.stringify(manifest))],
    ['ls-tree -r --name-only origin/main', ok('package.json\nREADME.md\nlib/index.js\nbuild.py\n')],
    ['rev-parse origin/main', ok('abc1234567\n')],
  ])
  const plan = await planMirror({ git, cwd: '/repo' })
  assert.equal(plan.refused, null)
  assert.deepEqual(plan.publish, ['README.md', 'lib/index.js', 'package.json'])
  assert.deepEqual(plan.drop, ['build.py'])
  assert.equal(plan.sha, 'abc1234567')

  const missing = fakeGit([
    ['show origin/main:package.json', ok(JSON.stringify(manifest))],
    ['ls-tree -r --name-only origin/main', ok('package.json\nlib/index.js\n')],
    ['rev-parse origin/main', ok('abc\n')],
  ])
  const refused = await planMirror({ git: missing, cwd: '/repo' })
  assert.match(refused.refused, /required product files are missing: README\.md/)
})

test('planMirror refuses when the allowlist itself contains a forbidden path', async () => {
  const git = fakeGit([
    ['show origin/main:package.json', ok(JSON.stringify({ files: ['lib', 'docs'] }))],
    ['ls-tree -r --name-only origin/main', ok('package.json\nREADME.md\ndocs/design/DESIGN.md\nlib/index.js\n')],
    ['rev-parse origin/main', ok('abc\n')],
  ])
  const plan = await planMirror({ git, cwd: '/repo' })
  assert.deepEqual(plan.allowlistConflicts, ['docs'])
  assert.match(plan.refused, /the allowlist contains forbidden paths: docs/)
  assert.ok(!plan.publish.includes('docs/design/DESIGN.md'), 'internal documentation is dropped, not published')
  assert.ok(DEFAULT_FORBIDDEN.includes('AGENTS.md'))
})

test('planMirror explains a broken ref instead of returning an empty plan', async () => {
  const git = fakeGit([
    ['show origin/main:package.json', { code: 1, stdout: '', stderr: 'missing' }],
    ['ls-tree -r --name-only origin/main', { code: 128, stdout: '', stderr: 'fatal: bad revision' }],
  ])
  await assert.rejects(() => planMirror({ git, cwd: '/repo' }), /cannot read the tree of origin\/main: fatal: bad revision/)
})

test('publishMirror builds one commit on top of the mirror head and pushes a fast-forward', async () => {
  const git = fakeGit([
    ['show origin/main:package.json', ok(JSON.stringify(manifest))],
    ['ls-tree -r --name-only origin/main', ok('package.json\nREADME.md\nlib/index.js\nbuild.py\n')],
    ['rev-parse origin/main', ok('source123456\n')],
    ['rev-parse github/main', ok('mirror98765\n')],
    [/^read-tree/, ok('')],
    [/^rev-parse origin\/main:/, (_args, opts) => {
      // each staged path resolves to a blob of its own
      return ok('blobsha\n')
    }],
    [/^update-index/, ok('')],
    [/^write-tree/, ok('treesha\n')],
    [/^commit-tree/, ok('newcommit123\n')],
    [/^push github/, ok('')],
    [/^update-index --refresh/, ok('')],
  ])
  const result = await publishMirror({ git, cwd: '/repo' })
  assert.equal(result.pushed, true)
  assert.equal(result.commit, 'newcommit123')
  assert.deepEqual(result.correspondence, { source: 'source123456', mirror: 'newcommit123' })

  const commitCall = git.calls.find((c) => c.args[0] === 'commit-tree')
  assert.deepEqual(commitCall.args.slice(0, 4), ['commit-tree', 'treesha', '-p', 'mirror98765'])
  const pushCall = git.calls.find((c) => c.args[0] === 'push')
  assert.deepEqual(pushCall.args, ['push', 'github', 'newcommit123:refs/heads/main'])
  const commitIndexCalls = git.calls.filter((c) => c.args[0] === 'update-index' && c.args[1] === '--add')
  assert.equal(commitIndexCalls.length, 3, 'only the sanitized files are staged')
  assert.ok(commitIndexCalls.every((c) => c.opts.env && c.opts.env.GIT_INDEX_FILE), 'a temporary index is used')
})

test('publishMirror with dryRun writes nothing and returns the plan', async () => {
  const git = fakeGit([
    ['show origin/main:package.json', ok(JSON.stringify(manifest))],
    ['ls-tree -r --name-only origin/main', ok('package.json\nREADME.md\n')],
    ['rev-parse origin/main', ok('src\n')],
    ['rev-parse github/main', ok('mir\n')],
  ])
  const result = await publishMirror({ git, cwd: '/repo', dryRun: true })
  assert.equal(result.pushed, false)
  assert.equal(result.commit, null)
  assert.equal(result.parent, 'mir')
  assert.ok(!git.calls.some((c) => c.args[0] === 'push'), 'dry run never pushes')
})

test('publishMirror refuses to publish a refused plan and reports an unfetched mirror', async () => {
  const refused = fakeGit([
    ['show origin/main:package.json', ok(JSON.stringify(manifest))],
    ['ls-tree -r --name-only origin/main', ok('package.json\nlib/index.js\n')],
    ['rev-parse origin/main', ok('x\n')],
  ])
  await assert.rejects(() => publishMirror({ git: refused, cwd: '/repo' }), /required product files are missing/)

  const noMirror = fakeGit([
    ['show origin/main:package.json', ok(JSON.stringify(manifest))],
    ['ls-tree -r --name-only origin/main', ok('package.json\nREADME.md\n')],
    ['rev-parse origin/main', ok('x\n')],
    ['rev-parse github/main', { code: 128, stdout: '', stderr: 'unknown revision' }],
  ])
  await assert.rejects(() => publishMirror({ git: noMirror, cwd: '/repo' }), /is not available locally/)
})
