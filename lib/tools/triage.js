// Triage external GitHub issues into the local Gitea project registry.
//
// Reads public GitHub issues, identifies whether they have already been triaged
// into Gitea, drafts canonical issues conforming to the project standard, and optionally
// creates missing issues when sync: true and confirm: true are supplied.

import { existsSync, readFileSync } from 'node:fs'

export function resolveGiteaToken(explicitToken) {
  if (explicitToken) return explicitToken
  if (typeof process !== 'undefined' && process.env?.GITEA_TOKEN) {
    return process.env.GITEA_TOKEN
  }
  try {
    const credPath = '/mnt/external/Project/DEV/.gitea-agent-credentials.json'
    if (existsSync(credPath)) {
      const data = JSON.parse(readFileSync(credPath, 'utf8'))
      return data.agents?.antigravity?.token || ''
    }
  } catch {
    // ignore
  }
  return ''
}

export function formatGiteaDraft({ owner, repo, issue }) {
  const isBug = (issue.labels || []).some((l) => {
    const name = (typeof l === 'string' ? l : l.name || '').toLowerCase()
    return name.includes('bug') || name.includes('fix') || name.includes('error')
  })
  const isHigh = (issue.labels || []).some((l) => {
    const name = (typeof l === 'string' ? l : l.name || '').toLowerCase()
    return name.includes('critical') || name.includes('urgent') || name.includes('security')
  })

  const priorityPrefix = isHigh ? 'H:' : 'M:'
  const priorityLabel = isHigh ? 'priority/high' : 'priority/medium'
  const typeLabel = isBug ? 'type/bug' : 'type/feature'
  const typeStr = isBug ? 'fix' : 'feat'

  const title = `${priorityPrefix} ${typeStr}(ext): ${issue.title} (GH#${issue.number})`

  const body = [
    '### 1. Источник и контекст',
    `Входящая внешняя issue: [${owner}/${repo}#${issue.number}](${issue.html_url})`,
    `Автор: @${(issue.user && issue.user.login) || 'unknown'}`,
    `Создана: ${issue.created_at || 'unknown'}`,
    '',
    '### 2. Описание проблемы',
    issue.body ? issue.body.trim() : 'Описание отсутствует.',
    '',
    '### 3. Что должно быть сделано',
    '- Проанализировать входящий сигнал из внешнего GitHub-репозитория.',
    '- Определить применимость в локальном проекте Gitea.',
    '- Реализовать решение или сформировать обоснованный ответ.',
    '',
    '### 4. Критерии приёмки',
    '- Решение протестировано при внедрении.',
    '- Первоисточник связан и закрыт после релиза.',
  ].join('\n')

  return {
    title,
    body,
    labels: [priorityLabel, typeLabel, 'status/confirmed'],
  }
}

export function isAlreadyTriaged(ghIssue, giteaIssues, { owner, repo }) {
  const ghNumber = Number(ghIssue.number)
  const ghUrl = `github.com/${owner}/${repo}/issues/${ghNumber}`
  const ghMarker = `GH#${ghNumber}`
  const ghTag = `[GH-${ghNumber}]`
  const ghAlt = `(GH#${ghNumber})`

  for (const gi of giteaIssues) {
    const title = gi.title || ''
    const body = gi.body || ''
    if (
      body.includes(ghUrl) ||
      title.includes(ghMarker) ||
      title.includes(ghTag) ||
      title.includes(ghAlt) ||
      body.includes(ghMarker) ||
      body.includes(ghTag)
    ) {
      return { triaged: true, giteaIssueNumber: gi.number, giteaIssueUrl: gi.html_url }
    }
  }
  return { triaged: false, giteaIssueNumber: null, giteaIssueUrl: null }
}

export async function triageExternalIssues(client, options = {}, deps = {}) {
  const {
    repository = '',
    giteaOwner = 'goodandready',
    giteaRepo = '',
    state = 'open',
    limit = 20,
    sync = false,
    confirm = false,
    giteaBaseUrl = 'http://127.0.0.1:3005',
    giteaToken = '',
  } = options
  const { fetchFn = globalThis.fetch, giteaClient = null } = deps

  if (!repository || !repository.includes('/')) {
    throw new Error('repository must be in "owner/repo" format')
  }
  const [owner, repo] = repository.split('/')
  const targetGiteaRepo = giteaRepo || repo

  if (sync && confirm !== true) {
    throw new Error('confirm: true is required when sync is true to create issues in Gitea')
  }

  const cappedLimit = Math.max(1, Math.min(Number(limit) || 20, 50))

  // 1. Fetch GitHub issues
  const { data: rawIssues } = await client.get(`/repos/${owner}/${repo}/issues`, {
    query: { state, per_page: cappedLimit, sort: 'created', direction: 'desc' },
  })
  const ghIssues = (Array.isArray(rawIssues) ? rawIssues : [])
    .filter((i) => !i.pull_request)
    .slice(0, cappedLimit)

  // 2. Fetch Gitea issues
  let giteaIssues = []
  const token = resolveGiteaToken(giteaToken)

  if (giteaClient && typeof giteaClient.getIssues === 'function') {
    giteaIssues = await giteaClient.getIssues({ owner: giteaOwner, repo: targetGiteaRepo })
  } else if (typeof fetchFn === 'function') {
    try {
      const giteaUrl = `${giteaBaseUrl.replace(/\/$/, '')}/api/v1/repos/${giteaOwner}/${targetGiteaRepo}/issues?state=all&limit=100`
      const headers = { accept: 'application/json' }
      if (token) headers.authorization = `token ${token}`
      const res = await fetchFn(giteaUrl, { headers })
      if (res.ok) {
        giteaIssues = await res.json()
      }
    } catch {
      giteaIssues = []
    }
  }

  // 3. Process each issue
  const items = []
  for (const ghIssue of ghIssues) {
    const match = isAlreadyTriaged(ghIssue, giteaIssues, { owner, repo })
    const draft = formatGiteaDraft({ owner, repo, issue: ghIssue })

    let synced = false
    let createdIssue = null

    if (!match.triaged && sync && confirm) {
      if (giteaClient && typeof giteaClient.createIssue === 'function') {
        createdIssue = await giteaClient.createIssue({
          owner: giteaOwner,
          repo: targetGiteaRepo,
          draft,
        })
        synced = true
      } else if (typeof fetchFn === 'function') {
        try {
          const postUrl = `${giteaBaseUrl.replace(/\/$/, '')}/api/v1/repos/${giteaOwner}/${targetGiteaRepo}/issues`
          const headers = {
            'content-type': 'application/json',
            accept: 'application/json',
          }
          if (token) headers.authorization = `token ${token}`
          const postRes = await fetchFn(postUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              title: draft.title,
              body: draft.body,
            }),
          })
          if (postRes.ok) {
            createdIssue = await postRes.json()
            synced = true
          }
        } catch (err) {
          createdIssue = { error: String((err && err.message) || err) }
        }
      }
    }

    items.push({
      githubIssueNumber: ghIssue.number,
      title: ghIssue.title,
      htmlUrl: ghIssue.html_url,
      state: ghIssue.state,
      alreadyTriaged: match.triaged,
      giteaIssueNumber: match.giteaIssueNumber || (createdIssue && createdIssue.number) || null,
      giteaIssueUrl: match.giteaIssueUrl || (createdIssue && createdIssue.html_url) || null,
      draft,
      synced,
      createdIssue,
    })
  }

  return {
    repository: `${owner}/${repo}`,
    giteaRepository: `${giteaOwner}/${targetGiteaRepo}`,
    totalExternalIssues: items.length,
    triagedCount: items.filter((i) => i.alreadyTriaged).length,
    pendingCount: items.filter((i) => !i.alreadyTriaged).length,
    syncedCount: items.filter((i) => i.synced).length,
    items,
  }
}
