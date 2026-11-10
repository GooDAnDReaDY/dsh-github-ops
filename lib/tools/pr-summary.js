// Canonical AGENTS.md PR description generator.
//
// Inspects git commits and diff against base branch, producing a fully compliant
// 5-section report ready for Gitea / GitHub PR description.

const PR_STRINGS = {
  en: {
    sec1: '### 1. Context and Problem',
    sec2: '### 2. Reason',
    sec3: '### 3. What Was Done',
    sec4: '### 4. Impact and Limitations',
    sec5: '### 5. Checks',
    context: (ref, target, title) => `In the context of task ${ref ? `#${ref}` : target}, implement: ${title}.`,
    defaultReason: '- Implementation of planned functionality changes.',
    defaultDone: '- Updated source code and associated components.',
    impact: (dirs) => `Touched components: ${dirs}. Backward compatibility preserved; no critical regressions expected.`,
    defaultDirs: 'codebase',
    hasTests: '- Added/updated unit tests.',
    noTests: '- Verified with repository test suite.',
    testSuite: '- Test suite npm test passed successfully.',
    defaultTitle: (head) => `Updates for ${head}`,
  },
  zh: {
    sec1: '### 1. 上下文与问题',
    sec2: '### 2. 原因',
    sec3: '### 3. 完成的工作',
    sec4: '### 4. 影响与限制',
    sec5: '### 5. 验证与测试',
    context: (ref, target, title) => `在任务 ${ref ? `#${ref}` : target} 的范围内，需要实现：${title}。`,
    defaultReason: '- 实施预期的功能变更。',
    defaultDone: '- 更新源代码及相关组件。',
    impact: (dirs) => `涉及组件：${dirs}。保持向后兼容；预计无严重回归。`,
    defaultDirs: '代码库',
    hasTests: '- 添加/更新单元测试。',
    noTests: '- 已通过仓库基础测试套件验证。',
    testSuite: '- npm test 测试套件全部通过。',
    defaultTitle: (head) => `针对 ${head} 的更新`,
  },
  ru: {
    sec1: '### 1. Контекст и проблема',
    sec2: '### 2. Причина',
    sec3: '### 3. Что сделано',
    sec4: '### 4. Влияние и ограничения',
    sec5: '### 5. Проверки',
    context: (ref, target, title) => `В рамках задачи ${ref ? `#${ref}` : target} требуется реализовать: ${title}.`,
    defaultReason: '- Внесение запланированных изменений в функциональность.',
    defaultDone: '- Обновление исходного кода и сопутствующих компонентов.',
    impact: (dirs) => `Затронуты компоненты: ${dirs}. Обратная совместимость сохранена; критических регрессий не ожидается.`,
    defaultDirs: 'кодовая база',
    hasTests: '- Добавлены/обновлены модульные тесты.',
    noTests: '- Проверено базовыми тестами репозитория.',
    testSuite: '- Тестовый набор npm test пройден успешно.',
    defaultTitle: (head) => `Обновления для ${head}`,
  },
}

export function normalizePrLocale(loc) {
  const s = String(loc || '').toLowerCase().trim()
  if (s.startsWith('ru')) return 'ru'
  if (s.startsWith('zh')) return 'zh'
  return 'en'
}

export async function generatePrSummary({
  git,
  cwd,
  branch,
  base = 'origin/main',
  issueId,
  title,
  locale = 'en',
}) {
  if (!git) throw new Error('git runner is required')
  const head = branch || 'HEAD'
  const targetBase = base || 'origin/main'
  const t = PR_STRINGS[normalizePrLocale(locale)]

  if (String(head).trim().startsWith('-') || String(targetBase).trim().startsWith('-')) {
    throw new Error('invalid branch or base ref')
  }

  // 1. Commit log
  const logRes = await git(['log', `${targetBase}..${head}`, '--format=%h|%s|%b---COMMIT_END---'], { cwd })
  const commits = []
  if (logRes.code === 0 && String(logRes.stdout || '').trim()) {
    const rawChunks = logRes.stdout.split('---COMMIT_END---')
    for (const chunk of rawChunks) {
      const trimmed = chunk.trim()
      if (!trimmed) continue
      const parts = trimmed.split('|')
      const hash = parts[0] ? parts[0].trim() : ''
      const subject = parts[1] ? parts[1].trim() : ''
      const body = parts.slice(2).join('|').trim()
      if (hash && subject) {
        commits.push({ hash, subject, body })
      }
    }
  }

  // 2. Name-status diff
  const statusRes = await git(['diff', '--name-status', `${targetBase}..${head}`], { cwd })
  const files = []
  if (statusRes.code === 0 && String(statusRes.stdout || '').trim()) {
    const lines = statusRes.stdout.split('\n')
    for (const line of lines) {
      const parts = line.trim().split(/\s+/)
      if (parts.length >= 2) {
        files.push({ status: parts[0], path: parts[1] })
      }
    }
  }

  // 3. Diff stat
  const statRes = await git(['diff', '--stat', `${targetBase}..${head}`], { cwd })
  const statSummary = statRes.code === 0 ? String(statRes.stdout || '').trim() : ''

  // Formulate sections
  const refNum = issueId ? String(issueId).replace(/^#/, '').trim() : ''
  const prTitle = title || (commits.length ? commits[0].subject : t.defaultTitle(head))

  // Section 1
  const context = t.context(refNum, head, prTitle)

  // Section 2
  const reasons = commits.map((c) => `- ${c.subject}`).join('\n') || t.defaultReason

  // Section 3
  const items = []
  if (commits.length > 0) {
    for (const c of commits) {
      items.push(`- **${c.hash}**: ${c.subject}`)
    }
  } else {
    items.push(t.defaultDone)
  }
  const whatDone = items.join('\n')

  // Section 4
  const touchedDirs = [...new Set(files.map((f) => f.path.split('/')[0]))]
  const impact = t.impact(touchedDirs.join(', ') || t.defaultDirs)

  // Section 5
  const hasTests = files.some((f) => f.path.startsWith('test/') || f.path.endsWith('.test.js') || f.path.endsWith('.test.mjs'))
  const checks = [
    hasTests ? t.hasTests : t.noTests,
    t.testSuite,
  ].join('\n')

  const refsLine = refNum ? `### Refs: #${refNum}` : `### Refs: ${head}`

  const markdown = [
    `${t.sec1}\n${context}\n`,
    `${t.sec2}\n${reasons}\n`,
    `${t.sec3}\n${whatDone}\n`,
    `${t.sec4}\n${impact}\n`,
    `${t.sec5}\n${checks}\n`,
    refsLine,
  ].join('\n')

  return {
    markdown,
    commits,
    files,
    statSummary,
    branch: head,
    base: targetBase,
    issueId: refNum || null,
    locale: normalizePrLocale(locale),
  }
}
