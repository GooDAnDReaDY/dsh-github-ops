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

import { z } from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { credentialRef } from '@deepseek-ai/dsh-credentials'

import { createGitHubClient, parseRepoSpec, describeError, GitHubError } from './github.js'
import { registerCoreTools } from './tools/register-core.js'
import { registerCollabTools } from './tools/register-collab.js'

export const name = 'dsh-github-ops'
export const inject = ['tools', 'credentials', 'settings']

export const Config = z.object({
  tokenEnv: z.string().role('credential-ref').default('GITHUB_TOKEN')
    .description('Name of the DSH credential that holds the GitHub token (the token itself is never stored in settings).'),
  defaultRepository: z.string().default('')
    .description('Default repository as "owner/repo"; used when a tool call omits the repository.'),
  baseUrl: z.string().default('https://api.github.com')
    .description('GitHub API base URL; change it for GitHub Enterprise.'),
  timeoutMs: z.number().default(30000)
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

  /** Register one tool whose failures become values: a GitHub error never breaks a turn. */
  function tool(toolName, description, parameters, run) {
    ctx.tools.register(defineTool({
      name: toolName,
      description,
      parameters,
      execute: async (args) => {
        try {
          const value = await run(args || {})
          return { ok: true, value }
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
}
