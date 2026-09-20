// dsh-github-ops — host half.
//
// Gives the agent the GitHub operations the release pipeline needs and the plugin
// ecosystem lacks: releases, tags, a generic API pass-through, workflow runs,
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
import { listReleases, getRelease, createRelease, editRelease, deleteRelease } from './tools/releases.js'
import { listTags, createTag, deleteTag } from './tools/tags.js'
import { callApi } from './tools/api.js'

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

const REPO_PARAM = {
  repository: {
    type: 'string',
    description: 'Repository as "owner/repo". Omit to use the default from settings.',
  },
}

function repositoryParams(extra = {}) {
  return { ...REPO_PARAM, ...extra }
}

function asRepo(args, config) {
  const spec = parseRepoSpec(args && args.repository ? args.repository : config.defaultRepository)
  if (!spec) {
    throw new Error('repository is required: pass "owner/repo" or set a default repository in the plugin settings')
  }
  return spec
}

function ok(value, extra = {}) {
  return { ok: true, ...extra, value }
}

function fail(err) {
  const message = describeError(err)
  const out = { ok: false, error: message }
  if (err instanceof GitHubError) {
    if (err.status) out.status = err.status
    if (err.code) out.code = err.code
    if (err.rateLimit) out.rateLimit = err.rateLimit
  }
  return out
}

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

  /** Wrap an operation so a GitHub failure becomes a value, not a broken turn. */
  function tool(name_, description, parameters, run) {
    ctx.tools.register(defineTool({
      name: name_,
      description,
      parameters,
      execute: async (args) => {
        try {
          return await run(args || {})
        } catch (err) {
          return fail(err)
        }
      },
    }))
  }

  // ---------------------------------------------------------------- releases

  tool(
    'gh_release_list',
    'List GitHub releases of a repository, newest first. Read-only. Use it to check whether a version was already released and which release is marked latest.',
    repositoryParams({
      limit: { type: 'number', description: 'How many releases to return (1-100, default 30).' },
    }),
    async (args) => {
      const { owner, repo } = asRepo(args, liveConfig())
      const result = await listReleases(await client(), { owner, repo, limit: args.limit })
      return ok(result.releases, { count: result.count })
    },
  )

  tool(
    'gh_release_view',
    'Read one GitHub release by tag: name, draft/prerelease flags, notes, assets and URLs. Read-only.',
    repositoryParams({ tag: { type: 'string', description: 'Release tag, e.g. "v1.2.3".' } }),
    async (args) => {
      const { owner, repo } = asRepo(args, liveConfig())
      return ok(await getRelease(await client(), { owner, repo, tag: args.tag }))
    },
  )

  tool(
    'gh_release_create',
    'Create a GitHub release for a tag (the tag may already exist; pass target to create it at a commit). State-changing call for the public release channel: use it only for an approved release.',
    repositoryParams({
      tag: { type: 'string', description: 'Tag to release, e.g. "v1.2.3".' },
      name: { type: 'string', description: 'Release title; defaults to the tag.' },
      body: { type: 'string', description: 'Release notes in markdown.' },
      target: { type: 'string', description: 'Commit SHA or branch to place the tag on.' },
      draft: { type: 'boolean', description: 'Create as a draft (default false).' },
      prerelease: { type: 'boolean', description: 'Mark as a pre-release (default false).' },
      generateNotes: { type: 'boolean', description: 'Let GitHub generate the notes from commits.' },
    }),
    async (args) => {
      const cfg = liveConfig()
      const { owner, repo } = asRepo(args, cfg)
      const release = await createRelease(await client(), {
        owner, repo,
        tag: args.tag,
        name: args.name,
        body: args.body,
        draft: args.draft,
        prerelease: args.prerelease,
        target: args.target,
        generateNotes: args.generateNotes,
      })
      return ok(release)
    },
  )

  tool(
    'gh_release_edit',
    'Edit an existing GitHub release: title, notes, draft/prerelease flags, and which release is marked latest (makeLatest). Use makeLatest: true after publishing a new version so the repository badge does not stay on an older release.',
    repositoryParams({
      tag: { type: 'string', description: 'Release tag to edit.' },
      releaseId: { type: 'number', description: 'Release id, when the tag is unknown.' },
      name: { type: 'string', description: 'New title.' },
      body: { type: 'string', description: 'New notes.' },
      draft: { type: 'boolean', description: 'Draft flag.' },
      prerelease: { type: 'boolean', description: 'Pre-release flag.' },
      makeLatest: { type: 'boolean', description: 'true marks this release as latest; false unmarks it.' },
    }),
    async (args) => {
      const { owner, repo } = asRepo(args, liveConfig())
      return ok(await editRelease(await client(), {
        owner, repo,
        tag: args.tag,
        releaseId: args.releaseId,
        name: args.name,
        body: args.body,
        draft: args.draft,
        prerelease: args.prerelease,
        makeLatest: args.makeLatest,
      }))
    },
  )

  tool(
    'gh_release_delete',
    'Delete a GitHub release. Requires confirm: true. The git tag itself is not removed — use gh_tag_delete for that.',
    repositoryParams({
      tag: { type: 'string', description: 'Release tag to delete.' },
      releaseId: { type: 'number', description: 'Release id, when the tag is unknown.' },
      confirm: { type: 'boolean', description: 'Must be true to actually delete.' },
    }),
    async (args) => {
      if (args.confirm !== true) {
        return { ok: false, error: 'refusing to delete a release without confirm: true' }
      }
      const { owner, repo } = asRepo(args, liveConfig())
      return ok(await deleteRelease(await client(), { owner, repo, tag: args.tag, releaseId: args.releaseId }))
    },
  )

  // -------------------------------------------------------------------- tags

  tool(
    'gh_tag_list',
    'List git tags of a repository with their commit SHAs. Read-only. Use it to check whether the version tag for a release already exists.',
    repositoryParams({ limit: { type: 'number', description: 'How many tags to return (default 100).' } }),
    async (args) => {
      const { owner, repo } = asRepo(args, liveConfig())
      const result = await listTags(await client(), { owner, repo, limit: args.limit })
      return ok(result.tags, { count: result.count })
    },
  )

  tool(
    'gh_tag_create',
    'Create a git tag. Without message it is a lightweight tag; with message GitHub creates an annotated tag object first. Pass sha to tag a specific commit, otherwise HEAD is tagged.',
    repositoryParams({
      tag: { type: 'string', description: 'Tag name, e.g. "v1.2.3".' },
      sha: { type: 'string', description: 'Commit SHA to tag; defaults to HEAD.' },
      message: { type: 'string', description: 'Annotation message; presence makes the tag annotated.' },
    }),
    async (args) => {
      const { owner, repo } = asRepo(args, liveConfig())
      return ok(await createTag(await client(), { owner, repo, tag: args.tag, sha: args.sha, message: args.message }))
    },
  )

  tool(
    'gh_tag_delete',
    'Delete a git tag. Requires confirm: true.',
    repositoryParams({
      tag: { type: 'string', description: 'Tag to delete.' },
      confirm: { type: 'boolean', description: 'Must be true to actually delete.' },
    }),
    async (args) => {
      if (args.confirm !== true) {
        return { ok: false, error: 'refusing to delete a tag without confirm: true' }
      }
      const { owner, repo } = asRepo(args, liveConfig())
      return ok(await deleteTag(await client(), { owner, repo, tag: args.tag }))
    },
  )

  // --------------------------------------------------------------------- api

  tool(
    'gh_api',
    'Call the GitHub API directly for anything the other tools do not cover (refs, rulesets, orgs, gists). Reads are free; POST/PATCH/PUT/DELETE require confirm: true, and deleting a repository, transferring one, or deleting an organization is refused outright. Pass graphql to run a GraphQL query instead of a REST path.',
    {
      method: { type: 'string', description: 'HTTP method: GET (default), POST, PATCH, PUT, DELETE.' },
      path: { type: 'string', description: 'REST path relative to the API base, e.g. "/repos/owner/repo/git/refs".' },
      query: { type: 'object', description: 'Query string parameters.' },
      body: { type: 'object', description: 'JSON body for POST/PATCH/PUT, or GraphQL variables.' },
      graphql: { type: 'string', description: 'GraphQL query; when set, path/method are ignored.' },
      confirm: { type: 'boolean', description: 'Required for state-changing calls.' },
    },
    async (args) => {
      const result = await callApi(await client(), {
        method: args.method,
        path: args.path,
        query: args.query,
        body: args.body,
        confirm: args.confirm,
        graphql: args.graphql,
      })
      return ok(result.data, {
        method: result.method,
        mutating: Boolean(result.mutating),
        status: result.status,
      })
    },
  )
}
