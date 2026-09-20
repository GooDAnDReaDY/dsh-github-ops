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
    .description('Name of the DSH credential that holds the GitHub token (the token itself is never stored in settings).'),
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

  async function resolveToken(credentialName) {
    const refName = credentialName || liveConfig().tokenEnv
    if (!refName) return ''
    try {
      const resolved = await ctx.credentials.resolve(credentialRef(refName))
      return (resolved && resolved.value) || ''
    } catch {
      return ''
    }
  }

  async function client() {
    const cfg = liveConfig()
    const token = await resolveToken(cfg.tokenEnv)
    if (!token) {
      throw new Error(`GitHub token is not configured: add the credential "${cfg.tokenEnv}" in DSH credentials`)
    }
    return createGitHubClient({
      token,
      baseUrl: cfg.baseUrl || 'https://api.github.com',
      timeoutMs: Number(cfg.timeoutMs) || 30000,
    })
  }

  function asRepo(args, cfg) {
    const spec = parseRepoSpec(args && args.repository ? args.repository : cfg.defaultRepository)
    if (!spec) {
      throw new Error('repository is required: pass "owner/repo" or set a default repository in the plugin settings')
    }
    return spec
  }

  /**
   * Register one tool whose failures become values: a GitHub error never breaks a turn.
   * The tool contract requires an output schema plus a renderer, so both are supplied
   * here once instead of in every definition.
   */
  function tool(toolName, description, parameters, run) {
    ctx.tools.register(defineTool({
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
    }))
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
}
