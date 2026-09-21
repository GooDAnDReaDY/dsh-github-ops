// HTTP routes the plugin's own user surfaces read.
//
// Three read-only endpoints, each behind the same rules: GET only, a local or same-origin
// caller only, and no access value anywhere in the payload. They live here so the host half
// stays a composition: the card, the Source Control tab and the sidebar panel each need one
// endpoint, and none of them needs a tool.

import { existsSync, statSync } from 'node:fs'
import { join as joinPath } from 'node:path'

import { statusPayload, isTrustedRequest, sendJson } from './status.js'
import { buildAction, validateCwd } from './scm-write.js'
import { parseStatus, parseBranches, parseStashes, parseCount, scmPayload, mergeStateFrom } from './scm.js'
import { listIssues } from './tools/issues.js'
import { listRuns } from './tools/actions.js'
import { listNotifications, repoTreeView } from './tools/panel-data.js'

/** Where the settings card reads the access status from. */
export const STATUS_PATH = '/dsh-github-ops/status'

/** Where the Source Control tab reads the working copy from. */
export const SCM_PATH = '/dsh-github-ops/scm'

/** Where the sidebar panel reads its data from (read-only). */
export const PANEL_PATH = '/dsh-github-ops/panel'

/**
 * Register the three routes.
 *
 * @param ctx - the cordis context
 * @param deps - resolveToken, client, liveConfig, describeError, makeGitRunner and cacheStats,
 *               injected so this module stays free of the host's own composition.
 */
export function registerRoutes(ctx, deps) {
  // The card reads the access status from here instead of from a tool result: the model has
  // no business holding the access value, and the payload describes this machine's account,
  // so only a local or same-origin caller is answered.
  ctx.inject(['webServer'], (wctx) => {
    try {
      const register = () => wctx.webServer.register({
        kind: 'exact',
        path: STATUS_PATH,
        handler: async (req, res) => {
          if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' })
          if (!isTrustedRequest(req)) return sendJson(res, 403, { error: 'forbidden' })
          const access = await resolveToken()
          let identity = null
          let rateLimit = null
          let scopes = ''
          let error = ''
          if (access.value) {
            try {
              const github = await client()
              const answer = await github.get('/user')
              identity = answer.data
              rateLimit = answer.rateLimit
              scopes = typeof github.lastScopes === 'function' ? github.lastScopes() : ''
            } catch (err) {
              error = describeError(err)
            }
          }
          sendJson(res, 200, statusPayload({
            access,
            identity,
            rateLimit,
            scopes,
            cache: deps.cacheStats ? deps.cacheStats() : null,
            interceptLinks: liveConfig().interceptLinks === true,
            error,
          }))
        },
      })
      if (typeof wctx.effect === 'function') wctx.effect(register, 'dsh-github-ops: status route')
      else register()
    } catch (err) {
      ctx.logger?.warn?.('[dsh-github-ops] status route not registered:', err && err.message)
    }
  })

  // The Source Control tab reads the working copy through here: git is called on the session
  // workspace, and only a local caller is answered. Nothing in this route writes.
  ctx.inject(['webServer'], (wctx) => {
    try {
      const register = () => wctx.webServer.register({
        kind: 'exact',
        path: SCM_PATH,
        handler: async (req, res) => {
          if (req.method !== 'GET' && req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
          if (!isTrustedRequest(req)) return sendJson(res, 403, { error: 'forbidden' })
          const git = makeGitRunner()
          // The tab may look at another directory than the session workspace; the value is
          // validated, must exist and must be a directory.
          const requested = validateCwd(url.searchParams.get('cwd') || '')
          let cwd = (typeof ctx.cwd === 'string' && ctx.cwd) || process.cwd()
          if (requested) {
            if (!existsSync(requested) || !statSync(requested).isDirectory()) {
              return sendJson(res, 400, { error: `not a directory: ${requested}` })
            }
            cwd = requested
          }
          const url = new URL(req.url || '/', 'http://localhost')
          const file = url.searchParams.get('file') || ''
          const staged = url.searchParams.get('staged') === '1'

          if (req.method === 'POST') {
            // A write always comes from a click in the panel. The body names one action; the
            // argv it becomes is built and validated in lib/scm-write.js, and every step is
            // run on its own — never through a shell.
            let body = {}
            try {
              body = await readJsonBody(req)
            } catch (err) {
              return sendJson(res, 400, { ok: false, error: String((err && err.message) || err) })
            }
            if (body.cwd) {
              try {
                const wanted = validateCwd(body.cwd)
                if (wanted) {
                  if (!existsSync(wanted) || !statSync(wanted).isDirectory()) {
                    return sendJson(res, 400, { ok: false, error: `not a directory: ${wanted}` })
                  }
                  cwd = wanted
                }
              } catch (err) {
                return sendJson(res, 400, { ok: false, error: String((err && err.message) || err) })
              }
            }
            let built
            try {
              built = buildAction(body.action, body.args || body)
            } catch (err) {
              return sendJson(res, 400, { ok: false, error: String((err && err.message) || err) })
            }
            const steps = []
            for (const argv of built.steps) {
              const answer = await git(argv, { cwd, timeoutMs: 120000 })
              steps.push({
                argv,
                code: answer.code,
                stdout: String(answer.stdout || '').slice(0, 4000),
                stderr: String(answer.stderr || '').slice(0, 4000),
              })
              if (answer.code !== 0) {
                return sendJson(res, 200, { ok: false, action: built.action, summary: built.summary, steps, error: 'git refused the step' })
              }
            }
            return sendJson(res, 200, { ok: true, action: built.action, summary: built.summary, steps })
          }

          if (file) {
            // a single diff, capped: the tab shows a file at a time
            const args = staged ? ['diff', '--cached', '--', file] : ['diff', '--', file]
            const diff = await git(args, { cwd })
            const text = diff.code === 0 ? diff.stdout : diff.stderr
            return sendJson(res, 200, { file, staged, diff: String(text || '').slice(0, 200000) })
          }

          const branchAnswer = await git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd })
          if (branchAnswer.code !== 0) {
            return sendJson(res, 200, scmPayload({ cwd, error: 'not a git repository (or no commits yet)' }))
          }
          const branch = branchAnswer.stdout.trim()
          const upstreamAnswer = await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { cwd })
          const upstream = upstreamAnswer.code === 0 ? upstreamAnswer.stdout.trim() : ''
          let ahead = null
          let behind = null
          if (upstream) {
            const aheadAnswer = await git(['rev-list', '--count', `${upstream}..HEAD`], { cwd })
            const behindAnswer = await git(['rev-list', '--count', `HEAD..${upstream}`], { cwd })
            ahead = aheadAnswer.code === 0 ? parseCount(aheadAnswer.stdout) : null
            behind = behindAnswer.code === 0 ? parseCount(behindAnswer.stdout) : null
          }
          const [statusAnswer, branchesAnswer, tagsAnswer, stashesAnswer] = await Promise.all([
            git(['status', '--porcelain=v1'], { cwd }),
            git(['branch', '--format=%(refname:short)\t%(HEAD)'], { cwd }),
            git(['tag', '--list'], { cwd }),
            git(['stash', 'list', '--format=%gd\t%gs'], { cwd }),
          ])
          const gitDirAnswer = await git(['rev-parse', '--absolute-git-dir'], { cwd })
          const gitDir = gitDirAnswer.code === 0 ? gitDirAnswer.stdout.trim() : joinPath(cwd, '.git')
          const merge = mergeStateFrom({
            mergeHead: existsSync(joinPath(gitDir, 'MERGE_HEAD')),
            rebaseDir: existsSync(joinPath(gitDir, 'rebase-merge')) || existsSync(joinPath(gitDir, 'rebase-apply')),
            cherryPickHead: existsSync(joinPath(gitDir, 'CHERRY_PICK_HEAD')),
            revertHead: existsSync(joinPath(gitDir, 'REVERT_HEAD')),
          })
          sendJson(res, 200, scmPayload({
            cwd,
            branch,
            upstream,
            ahead,
            behind,
            status: parseStatus(statusAnswer.code === 0 ? statusAnswer.stdout : ''),
            branches: parseBranches(branchesAnswer.code === 0 ? branchesAnswer.stdout : ''),
            tags: tagsAnswer.code === 0 ? tagsAnswer.stdout.split('\n').map((t) => t.trim()).filter(Boolean).slice(0, 50) : [],
            stashes: parseStashes(stashesAnswer.code === 0 ? stashesAnswer.stdout : ''),
            merge,
          }))
        },
      })
      if (typeof wctx.effect === 'function') wctx.effect(register, 'dsh-github-ops: scm route')
      else register()
    } catch (err) {
      ctx.logger?.warn?.('[dsh-github-ops] scm route not registered:', err && err.message)
    }
  })

  // The sidebar panel reads through here: one read-only endpoint with a `what` switch, so the
  // panel needs a single contract instead of one route per screen. Only a local caller is
  // answered, and nothing here writes.
  ctx.inject(['webServer'], (wctx) => {
    try {
      const register = () => wctx.webServer.register({
        kind: 'exact',
        path: PANEL_PATH,
        handler: async (req, res) => {
          if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' })
          if (!isTrustedRequest(req)) return sendJson(res, 403, { error: 'forbidden' })
          const access = await resolveToken()
          if (!access.value) return sendJson(res, 200, { configured: false, guidance: access.guidance })
          const url = new URL(req.url || '/', 'http://localhost')
          const what = url.searchParams.get('what') || 'repos'
          const repoSpec = url.searchParams.get('repo') || ''
          const [repoOwner, repoName] = repoSpec.split('/')
          const ref = url.searchParams.get('ref') || ''
          const path = url.searchParams.get('path') || ''
          const state = url.searchParams.get('state') || 'open'
          const query = url.searchParams.get('q') || ''
          try {
            const github = await client()
            if (what === 'repos') {
              if (query) {
                const { data } = await github.get('/search/repositories', { query: { q: query, per_page: 20, sort: 'stars' } })
                return sendJson(res, 200, { configured: true, repos: (data.items || []).map((r) => ({ fullName: r.full_name, private: r.private, pushedAt: r.pushed_at, description: r.description || '', stars: r.stargazers_count })) })
              }
              const { data } = await github.get('/user/repos', { query: { per_page: 50, sort: 'pushed', affiliation: 'owner,collaborator,organization_member' } })
              return sendJson(res, 200, { configured: true, repos: (data || []).filter((r) => !r.archived).map((r) => ({ fullName: r.full_name, private: r.private, pushedAt: r.pushed_at, description: r.description || '', stars: r.stargazers_count })) })
            }
            if (!repoOwner || !repoName) return sendJson(res, 200, { configured: true, error: 'a repository is required for this view' })
            const repo = { owner: repoOwner, repo: repoName }
            if (what === 'tree') {
              const view = await repoTreeView(github, { ...repo, ref, path })
              return sendJson(res, 200, { configured: true, ...view })
            }
            if (what === 'blob') {
              const { data } = await github.get(`/repos/${repoOwner}/${repoName}/contents/${path}`, { query: ref ? { ref } : undefined })
              if (Array.isArray(data)) return sendJson(res, 200, { configured: true, entries: data.map((e) => ({ name: e.name, type: e.type, size: e.size, path: e.path })) })
              const encoded = String((data && data.content) || '').replace(/\n/g, '')
              const text = encoded ? Buffer.from(encoded, 'base64').toString('utf8') : ''
              return sendJson(res, 200, { configured: true, path: data.path, size: data.size, text: text.slice(0, 200000), truncated: text.length > 200000 })
            }
            if (what === 'issues' || what === 'pulls') {
              const result = await listIssues(github, { ...repo, state, limit: 30, kind: what === 'pulls' ? 'pr' : 'issue' })
              return sendJson(res, 200, { configured: true, items: result.issues })
            }
            if (what === 'runs') {
              const result = await listRuns(github, { ...repo, limit: 20 })
              return sendJson(res, 200, { configured: true, items: result.runs })
            }
            if (what === 'inbox') {
              const result = await listNotifications(github, { limit: 30 })
              return sendJson(res, 200, { configured: true, ...result })
            }
            return sendJson(res, 200, { configured: true, error: `unknown view "${what}"` })
          } catch (err) {
            return sendJson(res, 200, { configured: true, error: describeError(err) })
          }
        },
      })
      if (typeof wctx.effect === 'function') wctx.effect(register, 'dsh-github-ops: panel route')
      else register()
    } catch (err) {
      ctx.logger?.warn?.('[dsh-github-ops] panel route not registered:', err && err.message)
    }
  })

}

/**
 * Read a small JSON body, bounded, so a POST that names an action cannot exhaust memory.
 * The panel sends a few hundred bytes; anything larger is refused rather than buffered.
 */
function readJsonBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('the request body is too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim()
      if (!text) return resolve({})
      try {
        const parsed = JSON.parse(text)
        if (!parsed || typeof parsed !== 'object') return reject(new Error('the request body must be a JSON object'))
        resolve(parsed)
      } catch {
        reject(new Error('the request body is not valid JSON'))
      }
    })
    req.on('error', (err) => reject(err))
  })
}
