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
import { registerCoreTools } from './tools/register-core.js'
import { registerCollabTools } from './tools/register-collab.js'
import { registerMirrorTools } from './tools/register-mirror.js'
import { registerOpsTools } from './tools/register-ops.js'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

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

  function liveConfig() {
    try {
      const fromScope = settingsScope && settingsScope.get && settingsScope.get()
      return { ...config, ...(fromScope || {}) }
    } catch {
      return config
    }
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

  async function client() {
    const cfg = liveConfig()
    const access = await resolveToken()
    if (!access.value) {
      throw new Error(`GitHub access is not configured: ${access.guidance || NO_ACCESS_GUIDANCE}`)
    }
    return createGitHubClient({
      token: access.value,
      baseUrl: cfg.baseUrl || 'https://api.github.com',
      timeoutMs: Number(cfg.timeoutMs) || 30000,
    })
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
  function tool(toolName, description, parameters, run) {
    const definition = defineTool({
      name: toolName,
      description,
      parameters,
      output: {
        schema: OUTPUT_SCHEMA,
        render: (_args, value) => renderToolResult(toolName, value),
      },
      execute: async (args) => {
        try {
          const value = await run(args || {})
          return { ok: true, data: value }
        } catch (err) {
          const out = { ok: false, error: describeError(err) }
          if (err instanceof GitHubError) {
            if (err.status) out.status = err.status
            if (err.code) out.code = err.code
            if (err.rateLimit) out.rateLimit = err.rateLimit
          }
          return out
        }
      },
    })
    try {
      ctx.tools.register(definition)
    } catch (err) {
      if (!/is already registered/.test(String((err && err.message) || err))) throw err
      skippedTools.push(toolName)
      ctx.logger?.warn?.(`[dsh-github-ops] tool "${toolName}" is already provided by another plugin; skipping it`)
    }
  }

  const deps = { tool, asRepo, client, liveConfig }
  registerCoreTools(deps)
  registerCollabTools(deps)
  registerOpsTools(deps)
  registerMirrorTools({
    tool,
    git: makeGitRunner(),
    defaultCwd: () => (typeof ctx.cwd === 'string' && ctx.cwd) || process.cwd(),
  })

  if (skippedTools.length) {
    ctx.logger?.warn?.(
      `[dsh-github-ops] ${skippedTools.length} tool(s) left to the plugin that already provides them: `
      + skippedTools.join(', '),
    )
  }
}
