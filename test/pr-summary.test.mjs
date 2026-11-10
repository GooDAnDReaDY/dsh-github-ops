import test from 'node:test'
import assert from 'node:assert/strict'

import { generatePrSummary, normalizePrLocale } from '../lib/tools/pr-summary.js'
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

test('normalizePrLocale normalizes language variants', () => {
  assert.equal(normalizePrLocale('en'), 'en')
  assert.equal(normalizePrLocale('EN-US'), 'en')
  assert.equal(normalizePrLocale(''), 'en')
  assert.equal(normalizePrLocale('ru'), 'ru')
  assert.equal(normalizePrLocale('ru-RU'), 'ru')
  assert.equal(normalizePrLocale('zh'), 'zh')
  assert.equal(normalizePrLocale('zh-CN'), 'zh')
  assert.equal(normalizePrLocale('fr'), 'en')
})

test('generatePrSummary defaults to English canonical 5-section markdown', async () => {
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
    title: 'Autogenerate canonical PR description',
  })

  assert.equal(res.branch, 'feat/pr-desc')
  assert.equal(res.issueId, '68')
  assert.equal(res.locale, 'en')
  assert.equal(res.commits.length, 2)
  assert.equal(res.commits[0].hash, 'c6d5769')
  assert.equal(res.files.length, 2)

  const md = res.markdown
  assert.ok(md.includes('### 1. Context and Problem'))
  assert.ok(md.includes('In the context of task #68, implement: Autogenerate canonical PR description.'))
  assert.ok(md.includes('### 2. Reason'))
  assert.ok(md.includes('### 3. What Was Done'))
  assert.ok(md.includes('- **c6d5769**: feat(pulls): add summary generator'))
  assert.ok(md.includes('### 4. Impact and Limitations'))
  assert.ok(md.includes('Touched components: lib, test. Backward compatibility preserved'))
  assert.ok(md.includes('### 5. Checks'))
  assert.ok(md.includes('Added/updated unit tests.'))
  assert.ok(md.includes('npm test passed successfully.'))
  assert.ok(md.includes('### Refs: #68'))
})

test('generatePrSummary supports Russian locale', async () => {
  const git = fakeGit([
    [/^log origin\/main\.\.feat\/pr-desc/, ok('c6d5769|feat(pulls): add summary generator|Initial implementation---COMMIT_END---')],
    [/^diff --name-status origin\/main\.\.feat\/pr-desc/, ok('M\tlib/tools/pulls.js\n')],
    [/^diff --stat origin\/main\.\.feat\/pr-desc/, ok(' 1 file changed, 10 insertions(+)\n')],
  ])

  const res = await generatePrSummary({
    git,
    cwd: '/repo',
    branch: 'feat/pr-desc',
    issueId: '68',
    title: 'Автогенерация описания PR',
    locale: 'ru',
  })

  assert.equal(res.locale, 'ru')
  const md = res.markdown
  assert.ok(md.includes('### 1. Контекст и проблема'))
  assert.ok(md.includes('В рамках задачи #68 требуется реализовать: Автогенерация описания PR.'))
  assert.ok(md.includes('### 2. Причина'))
  assert.ok(md.includes('### 3. Что сделано'))
  assert.ok(md.includes('### 4. Влияние и ограничения'))
  assert.ok(md.includes('### 5. Проверки'))
  assert.ok(md.includes('### Refs: #68'))
})

test('generatePrSummary supports Chinese locale', async () => {
  const git = fakeGit([
    [/^log origin\/main\.\.feat\/pr-desc/, ok('c6d5769|feat(pulls): add summary generator|Initial implementation---COMMIT_END---')],
    [/^diff --name-status origin\/main\.\.feat\/pr-desc/, ok('M\tlib/tools/pulls.js\n')],
    [/^diff --stat origin\/main\.\.feat\/pr-desc/, ok(' 1 file changed, 10 insertions(+)\n')],
  ])

  const res = await generatePrSummary({
    git,
    cwd: '/repo',
    branch: 'feat/pr-desc',
    issueId: '68',
    title: '自动生成 PR 描述',
    locale: 'zh',
  })

  assert.equal(res.locale, 'zh')
  const md = res.markdown
  assert.ok(md.includes('### 1. 上下文与问题'))
  assert.ok(md.includes('在任务 #68 的范围内，需要实现：自动生成 PR 描述。'))
  assert.ok(md.includes('### 2. 原因'))
  assert.ok(md.includes('### 3. 完成的工作'))
  assert.ok(md.includes('### 4. 影响与限制'))
  assert.ok(md.includes('### 5. 验证与测试'))
  assert.ok(md.includes('### Refs: #68'))
})

test('generatePrSummary handles empty commits and diff gracefully in en and ru', async () => {
  const git = fakeGit([
    [/^log/, ok('')],
    [/^diff --name-status/, ok('')],
    [/^diff --stat/, ok('')],
  ])

  const resEn = await generatePrSummary({
    git,
    cwd: '/repo',
    branch: 'feat/empty',
    issueId: '#123',
    locale: 'en',
  })
  assert.equal(resEn.commits.length, 0)
  assert.equal(resEn.files.length, 0)
  assert.equal(resEn.issueId, '123')
  assert.ok(resEn.markdown.includes('### Refs: #123'))
  assert.ok(resEn.markdown.includes('### 1. Context and Problem'))

  const resRu = await generatePrSummary({
    git,
    cwd: '/repo',
    branch: 'feat/empty',
    issueId: '#123',
    locale: 'ru',
  })
  assert.ok(resRu.markdown.includes('### 1. Контекст и проблема'))
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

test('registerCollabTools registers gh_generate_pr_summary with locale parameter', () => {
  const tools = {}
  registerCollabTools({
    tool: (name, desc, schema, fn) => { tools[name] = { desc, schema, fn } },
    asRepo: (args, fn) => fn(args),
    client: async () => ({}),
    liveConfig: () => ({ prSummaryLocale: 'en' }),
    git: fakeGit([]),
    defaultCwd: () => '/repo',
  })
  assert.ok(tools.gh_generate_pr_summary)
  assert.ok(tools.gh_generate_pr_summary.schema.locale)
})
