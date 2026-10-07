import test from 'node:test'
import assert from 'node:assert/strict'

import { generatePrSummary } from '../lib/tools/pr-summary.js'
import { registerCollabTools } from '../lib/tools/register-collab.js'

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
    return { code: 0, stdout: '', stderr: '' }
  }
  runner.calls = calls
  return runner
}

const ok = (stdout) => ({ code: 0, stdout, stderr: '' })

test('generatePrSummary parses log and diff to produce canonical 5-section markdown', async () => {
  const git = fakeGit([
    [/^log origin\/main\.\.feat\/pr-desc/, ok('c6d5769|feat(pulls): add summary generator|Initial implementation---COMMIT_END---7063720|test(pulls): add unit tests|Unit tests---COMMIT_END---')],
    [/^diff --name-status origin\/main\.\.feat\/pr-desc/, ok('M\tlib/tools/pulls.js\nA\ttest/pr-summary.test.mjs\n')],
    [/^diff --stat origin\/main\.\.feat\/pr-desc/, ok(' 2 files changed, 120 insertions(+)\n')],
  ])

  const res = await generatePrSummary({
    git,
    cwd: '/repo',
    branch: 'feat/pr-desc',
    base: 'origin/main',
    issueId: '68',
    title: 'Автогенерация канонического PR-описания',
  })

  assert.equal(res.branch, 'feat/pr-desc')
  assert.equal(res.issueId, '68')
  assert.equal(res.commits.length, 2)
  assert.equal(res.commits[0].hash, 'c6d5769')
  assert.equal(res.files.length, 2)

  const md = res.markdown
  assert.ok(md.includes('### 1. Контекст и проблема'))
  assert.ok(md.includes('### 2. Причина'))
  assert.ok(md.includes('### 3. Что сделано'))
  assert.ok(md.includes('### 4. Влияние и ограничения'))
  assert.ok(md.includes('### 5. Проверки'))
  assert.ok(md.includes('### Refs: #68'))
  assert.ok(md.includes('c6d5769'))
  assert.ok(md.includes('Автогенерация канонического PR-описания'))
  assert.ok(md.includes('npm test'))
})

test('generatePrSummary handles empty commits and diff gracefully', async () => {
  const git = fakeGit([
    [/^log/, ok('')],
    [/^diff --name-status/, ok('')],
    [/^diff --stat/, ok('')],
  ])

  const res = await generatePrSummary({
    git,
    cwd: '/repo',
    branch: 'feat/empty',
    issueId: '#123',
  })

  assert.equal(res.commits.length, 0)
  assert.equal(res.files.length, 0)
  assert.equal(res.issueId, '123')
  assert.ok(res.markdown.includes('### Refs: #123'))
  assert.ok(res.markdown.includes('### 1. Контекст и проблема'))
})

test('generatePrSummary rejects option injection and requires git runner', async () => {
  await assert.rejects(
    () => generatePrSummary({ git: null }),
    /git runner is required/,
  )

  const git = fakeGit([])
  await assert.rejects(
    () => generatePrSummary({ git, branch: '-b' }),
    /invalid branch or base ref/,
  )
  await assert.rejects(
    () => generatePrSummary({ git, base: '--upload-pack=x' }),
    /invalid branch or base ref/,
  )
})

test('registerCollabTools registers gh_generate_pr_summary', () => {
  const tools = {}
  registerCollabTools({
    tool: (name, desc, schema, fn) => { tools[name] = { desc, schema, fn } },
    asRepo: (args, fn) => fn(args),
    client: async () => ({}),
    liveConfig: () => ({}),
    git: fakeGit([]),
    defaultCwd: () => '/repo',
  })
  assert.ok(tools.gh_generate_pr_summary)
})
