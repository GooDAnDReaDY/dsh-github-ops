// dsh-github-ops — host half.
//
// Gives the agent the GitHub operations the release pipeline needs and the plugin
// ecosystem lacks: releases, tags, a guarded generic API pass-through, repository and
// file reads, issues, pull requests with a review pack, CI checks, workflow runs,
// secrets/variables, rulesets and sanitized mirror publication.
//
// Security model: the token lives in the DSH credential service (settings hold only
// the credential NAME), reads are free, and every state-changing call must carry
// `confirm: true`. A small deny list refuses the calls a single confirmation cannot
// undo (deleting a repository, transferring ownership, deleting an organization).

import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { credentialRef } from '@deepseek-ai/dsh-credentials'

import { createGitHubClient, parseRepoSpec, describeError, GitHubError } from './github.js'
import { resolveAccess, NO_ACCESS_GUIDANCE } from './auth.js'
import { resolveRepoContext } from './repo-context.js'
import { presentationFor } from './present.js'
import { createRecords, startReviewJob } from './jobs.js'
import { registerCommands } from './commands.js'
import { registerJobTools } from './tools/register-jobs.js'
import { registerCoreTools } from './tools/register-core.js'
import { registerCollabTools } from './tools/register-collab.js'
import { registerMirrorTools } from './tools/register-mirror.js'
import { registerOpsTools } from './tools/register-ops.js'
import { registerInsightTools } from './tools/register-insights.js'
import { registerWriteTools } from './tools/register-write.js'
import { accessFilePath, readAccessFile } from './auth-device.js'
import { DEFAULT_CLIENT_ID, DEFAULT_SCOPE } from './auth-device.js'
import { GUIDANCE_SECTION, GUIDANCE_ORDER, guidanceText } from './guidance.js'
import { registerRoutes, STATUS_PATH, SCM_PATH, PANEL_PATH } from './routes.js'
import { lossless } from './lossless.js'
import { AsyncLocalStorage } from 'node:async_hooks'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

// Carries the current tool call's cancellation signal to the shared client.
const callContext = new AsyncLocalStorage()

/** git runner: never throws, always answers with a code and both streams. */
function makeGitRunner() {
  return async (args, { cwd, env } = {}) => {
    try {
      const { stdout, stderr } = await execFileAsync('git', args, {
        cwd: cwd || process.cwd(),
        env: { ...process.env, ...(env || {}) },
        maxBuffer: 8 * 1024 * 1024,
      })
      return { code: 0, stdout, stderr }
    } catch (err) {
      return {
        code: typeof err.code === 'number' ? err.code : 1,
        stdout: err.stdout || '',
        stderr: err.stderr || String((err && err.message) || err),
      }
    }
  }
}

export const name = 'dsh-github-ops'
export const inject = ['tools', 'credentials', 'settings']

/** Output contract shared by every tool: a value or a described failure. */
export const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  properties: {
    ok: { type: 'boolean' },
    error: { type: 'string' },
    data: { type: 'json' },
  },
}

/** Which area a tool belongs to, derived from its name so a new tool lands somewhere sane. */
export function groupOf(toolName) {
  const name = String(toolName || '')
  const rules = [
    [/^gh_release_/, 'releases'],
    [/^gh_tag_/, 'tags'],
    [/^gh_run_/, 'runs'],
    [/^gh_secret_/, 'secrets'],
    [/^gh_variable_/, 'variables'],
    [/^gh_ruleset_/, 'rulesets'],
    [/^gh_branch_protection_/, 'branch-protection'],
    [/^gh_mirror_/, 'mirror'],
    [/^gh_review_job|^gh_review$|^review_post$|^ci_run$|^gh_checks$|^pr_/, 'pull-requests'],
    [/^issue_|^gh_issue$|^gh_search$/, 'issues'],
    [/^gh_repo_report|^gh_weekly_digest|^gh_notifications|^gh_repo_health|^gh_compare|^gh_trending|^gh_contributors|^gh_user_repos|^gh_commits/, 'insights'],
    [/^gh_repo|^gh_file/, 'repositories'],
    [/^gh_push_|^gh_upload_|^gh_delete_/, 'write-files'],
    [/^gh_auth_/, 'auth'],
    [/^gh_api$/, 'api'],
    [/^gh_help$/, 'meta'],
  ]
  for (const [pattern, group] of rules) if (pattern.test(name)) return group
  return 'other'
}

const MAX_RENDER_CHARS = 20000

/** Render a tool result for the model: readable text, bounded so one call cannot flood the turn. */
export function renderToolResult(toolName, value) {
  if (!value || value.ok !== true) {
    const error = (value && value.error) || 'unknown error'
    return [{ type: 'text', text: `${toolName} failed: ${error}` }]
  }
  const data = value.data
  let text
  if (typeof data === 'string') text = data
  else if (data === undefined || data === null) text = `${toolName}: done`
  else {
    try {
      text = JSON.stringify(data, null, 2)
    } catch {
      text = String(data)
    }
  }
  if (text.length > MAX_RENDER_CHARS) {
    text = `${text.slice(0, MAX_RENDER_CHARS)}\n… output truncated (${text.length} characters total)`
  }
  return [{ type: 'text', text }]
}

export const Config = Schema.object({
  tokenEnv: Schema.string().role('credential-ref').default('GITHUB_TOKEN')
    .description('Name used to look up access: the DSH credential, then the environment variable, then the gh CLI. The value itself is never stored in settings.'),
  tokenSource: Schema.string().default('auto')
    .description('Where access comes from: "auto" tries the DSH credential, then the environment variable, then the gh CLI; pin it to "credentials", "env" or "gh" to use one source only.'),
  defaultRepository: Schema.string().default('')
    .description('Default repository as "owner/repo"; used when a tool call omits the repository.'),
  baseUrl: Schema.string().default('https://api.github.com')
    .description('GitHub API base URL; change it for GitHub Enterprise.'),
  timeoutMs: Schema.number().default(30000)
    .description('Per-request timeout in milliseconds.'),
  maxRetries: Schema.number().default(2)
    .description('Retries for a read (GET/HEAD) on a network failure, a timeout or a 5xx. Writes are never retried automatically.'),
  reviewRulesJson: Schema.string().default('')
    .description('Optional review-rule overrides as JSON: sensitivePaths, sensitiveSeverity, attentionPaths, migrationPaths, testsRequired, sourcePatterns, testPatterns, largeDiffLines.'),
  oauthClientId: Schema.string().default(DEFAULT_CLIENT_ID)
    .description('OAuth application id used by gh_auth_login. The default is the public GitHub CLI application.'),
  oauthScope: Schema.string().default(DEFAULT_SCOPE)
    .description('OAuth scope requested by gh_auth_login.'),
  oauthClientSecretRef: Schema.string().role('credential-ref').default('')
    .description('Optional credential holding the OAuth client secret, for apps that require one.'),
  accessFile: Schema.string().default('')
    .description('Where gh_auth_login stores its sign-in (default: $DSH_HOME/github-ops-auth.json, mode 0600).'),
  interceptLinks: Schema.boolean().default(false)
    .description('Let a github.com link clicked in the conversation also select that repository for the Source control tab and the sidebar panel. Off by default: the link always opens in the browser either way.'),
  guidance: Schema.boolean().default(true)
    .description('Add a short paragraph about this plugin to the system prompt: which tool for which question, when the repository argument can be omitted, and that approvals belong to the host.'),
  guidanceText: Schema.string().default('')
    .description('Replace the default guidance paragraph with your own text.'),
  cacheTtlMs: Schema.number().default(60000)
    .description('How long a read stays cached, in milliseconds. A composed report then costs one request set instead of many; writes always go to the network.'),
  reviewJobTimeoutMs: Schema.number().default(120000)
    .description('How long a background review job may run before it is cancelled.'),
})

export function apply(ctx, rawConfig) {
  const config = { ...Config(), ...(rawConfig || {}) }
  let settingsScope = null

  ctx.inject(['settings'], (sctx) => {
    try {
      settingsScope = sctx.settings.register(name, Config, { base: config })
    } catch (err) {
      ctx.logger?.warn?.('[dsh-github-ops] settings namespace unavailable:', err && err.message)
    }
  })

  /** Review-rule overrides from settings; a broken value is reported, never silently ignored. */
  function reviewRules() {
    const raw = liveConfig().reviewRulesJson
    if (!raw || typeof raw !== 'string' || !raw.trim()) return undefined
    try {
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' ? parsed : undefined
    } catch (err) {
      ctx.logger?.warn?.('[dsh-github-ops] reviewRulesJson is not valid JSON and was ignored:', err && err.message)
      return undefined
    }
  }

  function liveConfig() {
    try {
      const fromScope = settingsScope && settingsScope.get && settingsScope.get()
      return { ...config, ...(fromScope || {}) }
    } catch {
      return config
    }
  }

  /** Where the plugin's own sign-in lives. */
  function accessPath() {
    const configured = liveConfig().accessFile
    return configured && String(configured).trim() ? String(configured).trim() : accessFilePath()
  }

  /** The gh CLI session, when the machine already has `gh auth login` done. */
  async function ghCliAccess() {
    const { stdout } = await execFileAsync('gh', ['auth', 'token'], { timeout: 10000, maxBuffer: 1024 * 1024 })
    return stdout
  }

  /** Resolve access for one operation; nothing is cached, so a rotation lands immediately. */
  async function resolveToken() {
    const cfg = liveConfig()
    return resolveAccess({
      // the sign-in this plugin stored itself (gh_auth_login) is one of the sources
      runFile: async () => {
        const stored = await readAccessFile(accessPath())
        return stored && stored.token ? stored.token : ''
      },
      // the credentials service takes a branded reference, not a bare name
      credentials: {
        resolve: async (name) => {
          try {
            return await ctx.credentials.resolve(credentialRef(name))
          } catch {
            return null
          }
        },
      },
      tokenEnv: cfg.tokenEnv,
      tokenSource: cfg.tokenSource || 'auto',
      env: process.env,
      runGh: ghCliAccess,
    })
  }

  // One client per configuration: the read cache lives in it, and the signal for the
  // current tool call arrives through the async context.
  let sharedClient = null
  let sharedKey = ''

  async function client() {
    const cfg = liveConfig()
    const access = await resolveToken()
    if (!access.value) {
      throw new Error(`GitHub access is not configured: ${access.guidance || NO_ACCESS_GUIDANCE}`)
    }
    const key = [
      access.source,
      access.value.length,
      cfg.baseUrl || '',
      cfg.timeoutMs || '',
      cfg.cacheTtlMs || '',
      cfg.maxRetries ?? '',
    ].join('|')
    if (!sharedClient || sharedKey !== key) {
      sharedClient = createGitHubClient({
        token: access.value,
        baseUrl: cfg.baseUrl || 'https://api.github.com',
        timeoutMs: Number(cfg.timeoutMs) || 30000,
        cacheTtlMs: Number.isFinite(Number(cfg.cacheTtlMs)) ? Number(cfg.cacheTtlMs) : 60000,
        maxRetries: Number.isFinite(Number(cfg.maxRetries)) ? Number(cfg.maxRetries) : 2,
        signalProvider: () => {
          const store = callContext.getStore()
          return store && store.signal ? store.signal : undefined
        },
      })
      sharedKey = key
    }
    return sharedClient
  }

  /**
   * Which repository a call is about: the one it names, the configured default, or — inside
   * a checkout — the one the origin remote already identifies. A bare "#12" keeps talking to
   * the repository the previous call used.
   */
  async function asRepo(args, cfg) {
    const explicit = args && args.repository ? String(args.repository) : ''
    const fallback = cfg.defaultRepository || ''
    let remoteUrl = ''
    if (!(explicit && explicit.includes('/')) && !fallback) {
      const cwd = (typeof ctx.cwd === 'string' && ctx.cwd) || process.cwd()
      const git = makeGitRunner()
      const origin = await git(['remote', 'get-url', 'origin'], { cwd })
      if (origin.code === 0) remoteUrl = origin.stdout.trim()
    }
    const resolved = resolveRepoContext({ explicit, fallback, remoteUrl })
    if (!resolved) {
      throw new Error('repository is required: pass "owner/repo", set a default repository in the plugin settings, or run inside a checkout with an origin remote')
    }
    return resolved
  }

  /**
   * Register one tool whose failures become values: a GitHub error never breaks a turn.
   * The tool contract requires an output schema plus a renderer, so both are supplied
   * here once instead of in every definition.
   *
   * A tool name already claimed in this scope is a hard error in the core, and an error
   * thrown from apply() takes the whole plugin tree — and therefore the harness — down.
   * Another GitHub plugin may legitimately own the same name (the reference plugin
   * exposes several of them), so a taken name is skipped and reported instead: this
   * plugin must never be the reason a deployment cannot start.
   */
  const skippedTools = []
  /** Every registered tool, so gh_help never drifts from reality. */
  const catalog = []
  const WRITE_PREFIXES = ['pr_', 'issue_', 'review_post', 'gh_api', 'gh_run_rerun', 'gh_run_cancel', 'gh_mirror_publish', 'gh_release_', 'gh_tag_', 'gh_repo_create', 'gh_repo_edit', 'gh_secret_', 'gh_variable_', 'gh_ruleset_', 'gh_branch_protection_set', 'gh_branch_protection_delete', 'gh_push_']

  function tool(toolName, description, parameters, run) {
    const definition = defineTool({
      name: toolName,
      description,
      parameters,
      output: {
        schema: OUTPUT_SCHEMA,
        render: (_args, value) => renderToolResult(toolName, value),
      },
      ...presentationFor(toolName),
      execute: async (args, exec) => {
        try {
          const value = await callContext.run({ signal: exec && exec.signal }, () => run(args || {}))
          // A write may invalidate what a cached read returned.
          if (WRITE_PREFIXES.some((prefix) => toolName === prefix || toolName.startsWith(prefix))) {
            try {
              sharedClient?.cacheClear?.()
            } catch {
              // a cache reset must never fail a successful call
            }
          }
          // One place decides what a result may contain: the harness refuses a value that
          // cannot be serialised losslessly, and it refuses the whole call for one undefined.
          return { ok: true, data: lossless(value) }
        } catch (err) {
          const out = { ok: false, error: describeError(err) }
          if (err instanceof GitHubError) {
            if (err.status) out.status = err.status
            if (err.code) out.code = err.code
            if (err.rateLimit) out.rateLimit = err.rateLimit
          }
          return lossless(out)
        }
      },
    })
    try {
      ctx.tools.register(definition)
      catalog.push({ name: toolName, description, group: groupOf(toolName) })
    } catch (err) {
      if (!/is already registered/.test(String((err && err.message) || err))) throw err
      skippedTools.push(toolName)
      ctx.logger?.warn?.(`[dsh-github-ops] tool "${toolName}" is already provided by another plugin; skipping it`)
    }
  }

  const pendingFlow = { current: null }
  const authSeam = {
    config: () => {
      const cfg = liveConfig()
      return { clientId: cfg.oauthClientId || DEFAULT_CLIENT_ID, scope: cfg.oauthScope || DEFAULT_SCOPE, secretRef: cfg.oauthClientSecretRef || '' }
    },
    path: accessPath,
    remember: (flow) => { pendingFlow.current = flow },
    pending: () => pendingFlow.current,
    forget: () => { pendingFlow.current = null },
    resolve: resolveToken,
    secret: async () => {
      const ref = liveConfig().oauthClientSecretRef
      if (!ref) return ''
      try {
        const resolved = await ctx.credentials.resolve(credentialRef(ref))
        return (resolved && resolved.value) || ''
      } catch {
        return ''
      }
    },
  }

  const deps = { tool, asRepo, client, liveConfig, reviewRules, auth: authSeam }
  registerCoreTools(deps)
  registerCollabTools(deps)
  registerOpsTools(deps)
  registerInsightTools(deps)
  registerWriteTools(deps)
  registerMirrorTools({
    tool,
    git: makeGitRunner(),
    defaultCwd: () => (typeof ctx.cwd === 'string' && ctx.cwd) || process.cwd(),
  })

  // Background reviews: the host registry when the composition has one, our own records
  // otherwise, so the tool works in both worlds.
  const records = createRecords()
  let hostJobs = null
  try {
    hostJobs = ctx.get ? ctx.get('jobs') : undefined
  } catch {
    hostJobs = null
  }
  registerJobTools({
    tool,
    asRepo,
    client,
    liveConfig,
    reviewRules,
    jobs: {
      start: (spec) => startReviewJob({ registry: hostJobs, records, ...spec }),
      get: (id) => records.get(id),
      list: () => records.list(),
    },
  })

  registerRoutes(ctx, {
    resolveToken,
    client,
    liveConfig,
    describeError,
    makeGitRunner,
    cacheStats: () => (sharedClient && typeof sharedClient.cacheStats === 'function' ? sharedClient.cacheStats() : null),
  })

  // One short paragraph in the system prompt: 50+ tools otherwise leave the model guessing.
  ctx.inject(['systemPrompt'], (sctx) => {
    try {
      const cfg = liveConfig()
      if (cfg.guidance === false) return
      sctx.systemPrompt.section({
        name: GUIDANCE_SECTION,
        order: GUIDANCE_ORDER,
        text: guidanceText(cfg.guidanceText),
      })
    } catch (err) {
      ctx.logger?.warn?.('[dsh-github-ops] system prompt guidance not registered:', err && err.message)
    }
  })

  // Slash commands are a fast path for a human: they only hand the model an instruction, so
  // the write still passes through the host approval contour.
  ctx.inject(['commands'], (cctx) => {
    try {
      const git = makeGitRunner()
      const readGitState = async () => {
        const cwd = (typeof ctx.cwd === 'string' && ctx.cwd) || process.cwd()
        const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd })
        const remote = await git(['remote', 'get-url', 'origin'], { cwd })
        const resolved = remote.code === 0
          ? resolveRepoContext({ remoteUrl: remote.stdout.trim() })
          : null
        return {
          branch: branch.code === 0 ? branch.stdout.trim() : undefined,
          repo: resolved ? `${resolved.owner}/${resolved.repo}` : undefined,
          remoteUrl: remote.code === 0 ? remote.stdout.trim() : undefined,
        }
      }
      registerCommands(cctx.commands, { readGitState })
    } catch (err) {
      ctx.logger?.warn?.('[dsh-github-ops] slash commands not registered:', err && err.message)
    }
  })


  // The catalog is built from the registrations above, so it cannot go stale.
  tool(
    'gh_help',
    'Catalog of every tool this plugin provides, grouped by area, with one line each. Call it when unsure which tool fits — it lists what exists instead of guessing.',
    { group: { type: 'string', description: 'Optional: only this group (repositories, releases, tags, issues, pull-requests, runs, secrets, variables, rulesets, branch-protection, mirror, jobs, api, meta).' } },
    async (args) => {
      const groups = {}
      for (const entry of catalog) {
        if (entry.name === 'gh_help') continue
        groups[entry.group] = groups[entry.group] || []
        groups[entry.group].push({ name: entry.name, description: entry.description })
      }
      if (args.group) {
        const only = groups[args.group]
        if (!only) return { error: `unknown group "${args.group}"`, groups: Object.keys(groups).sort() }
        return { group: args.group, count: only.length, tools: only }
      }
      return {
        count: Object.values(groups).reduce((sum, list) => sum + list.length, 0),
        groups: Object.keys(groups).sort().map((name) => ({ name, count: groups[name].length })),
        tools: groups,
      }
    },
  )

  if (skippedTools.length) {
    ctx.logger?.warn?.(
      `[dsh-github-ops] ${skippedTools.length} tool(s) left to the plugin that already provides them: `
      + skippedTools.join(', '),
    )
  }
}
