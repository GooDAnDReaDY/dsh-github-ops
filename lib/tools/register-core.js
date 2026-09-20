// Core tool registrations: repository and file reads, releases, tags, the guarded
// generic API pass-through, and repository creation/edits.
//
// Everything here takes its dependencies as arguments, so the host half stays thin
// and the definitions are reusable in tests.

import { listReleases, getRelease, createRelease, editRelease, deleteRelease } from './releases.js'
import { listTags, createTag, deleteTag } from './tags.js'
import { callApi } from './api.js'
import { getRepo, getFile, searchRepos, createRepo, editRepo } from './repos.js'

const REPOSITORY = {
  repository: { type: 'string', description: 'Repository as "owner/repo". Omit to use the default from settings.' },
}

export function registerCoreTools({ tool, asRepo, client, liveConfig }) {
  const repoParams = (extra = {}) => ({ ...REPOSITORY, ...extra })

  // ------------------------------------------------------------------ repository

  tool(
    'gh_repo',
    'Read GitHub repository metadata: description, default branch, stars, topics, license, open issue count. Read-only.',
    repoParams(),
    async (args) => {
      const { owner, repo } = asRepo(args, liveConfig())
      return getRepo(await client(), { owner, repo })
    },
  )

  tool(
    'gh_file',
    'Read one file from a GitHub repository at a branch, tag or commit (content is decoded for you). A directory path returns its entries. Read-only.',
    repoParams({
      path: { type: 'string', description: 'File path inside the repository, e.g. "lib/index.js" or "lib".' },
      ref: { type: 'string', description: 'Branch, tag or commit; defaults to the default branch.' },
    }),
    async (args) => {
      const { owner, repo } = asRepo(args, liveConfig())
      return getFile(await client(), { owner, repo, path: args.path, ref: args.ref })
    },
  )

  tool(
    'gh_repo_search',
    'Search GitHub repositories by name, description or README (GitHub search syntax, e.g. "dsh-plugin in:name,description"). Uses the separate search quota. Read-only.',
    {
      query: { type: 'string', description: 'Search query in GitHub search syntax.' },
      limit: { type: 'number', description: 'How many repositories to return (max 100, default 20).' },
    },
    async (args) => searchRepos(await client(), { query: args.query, limit: args.limit }),
  )

  tool(
    'gh_repo_create',
    'Create a GitHub repository for the authenticated user, or inside an organization when org is given. Defaults to private.',
    {
      name: { type: 'string', description: 'Repository name.' },
      org: { type: 'string', description: 'Organization to create it in; omit for the authenticated user.' },
      description: { type: 'string', description: 'Repository description.' },
      private: { type: 'boolean', description: 'Private repository (default true).' },
      autoInit: { type: 'boolean', description: 'Initialize with a README (default false).' },
    },
    async (args) => createRepo(await client(), {
      name: args.name,
      org: args.org,
      description: args.description,
      private: args.private,
      autoInit: args.autoInit,
    }),
  )

  tool(
    'gh_repo_edit',
    'Edit repository settings: description, homepage, visibility, archived flag and topics (topics replace the whole list).',
    repoParams({
      description: { type: 'string', description: 'New description.' },
      homepage: { type: 'string', description: 'New homepage URL.' },
      private: { type: 'boolean', description: 'Change visibility.' },
      archived: { type: 'boolean', description: 'Archive or unarchive.' },
      topics: { type: 'array', items: { type: 'string' }, description: 'Full replacement list of topics.' },
    }),
    async (args) => {
      const { owner, repo } = asRepo(args, liveConfig())
      return editRepo(await client(), {
        owner, repo,
        description: args.description,
        homepage: args.homepage,
        private: args.private,
        archived: args.archived,
        topics: args.topics,
      })
    },
  )

  // -------------------------------------------------------------------- releases

  tool(
    'gh_release_list',
    'List GitHub releases of a repository, newest first. Read-only. Use it to check whether a version was already released and which release is marked latest.',
    repoParams({ limit: { type: 'number', description: 'How many releases to return (1-100, default 30).' } }),
    async (args) => {
      const { owner, repo } = asRepo(args, liveConfig())
      const result = await listReleases(await client(), { owner, repo, limit: args.limit })
      return { releases: result.releases, count: result.count }
    },
  )

  tool(
    'gh_release_view',
    'Read one GitHub release by tag: name, draft/prerelease flags, notes, assets and URLs. Read-only.',
    repoParams({ tag: { type: 'string', description: 'Release tag, e.g. "v1.2.3".' } }),
    async (args) => {
      const { owner, repo } = asRepo(args, liveConfig())
      return getRelease(await client(), { owner, repo, tag: args.tag })
    },
  )

  tool(
    'gh_release_create',
    'Create a GitHub release for a tag (the tag may already exist; pass target to place it on a commit). This is a public-channel write: use it only for an approved release.',
    repoParams({
      tag: { type: 'string', description: 'Tag to release, e.g. "v1.2.3".' },
      name: { type: 'string', description: 'Release title; defaults to the tag.' },
      body: { type: 'string', description: 'Release notes in markdown.' },
      target: { type: 'string', description: 'Commit SHA or branch to place the tag on.' },
      draft: { type: 'boolean', description: 'Create as a draft (default false).' },
      prerelease: { type: 'boolean', description: 'Mark as a pre-release (default false).' },
      generateNotes: { type: 'boolean', description: 'Let GitHub generate notes from commits.' },
    }),
    async (args) => {
      const { owner, repo } = asRepo(args, liveConfig())
      return createRelease(await client(), {
        owner, repo,
        tag: args.tag,
        name: args.name,
        body: args.body,
        draft: args.draft,
        prerelease: args.prerelease,
        target: args.target,
        generateNotes: args.generateNotes,
      })
    },
  )

  tool(
    'gh_release_edit',
    'Edit a GitHub release: title, notes, draft/prerelease flags, and which release is marked latest (makeLatest). Use makeLatest: true after publishing a new version so the repository badge does not stay on an older release.',
    repoParams({
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
      return editRelease(await client(), {
        owner, repo,
        tag: args.tag,
        releaseId: args.releaseId,
        name: args.name,
        body: args.body,
        draft: args.draft,
        prerelease: args.prerelease,
        makeLatest: args.makeLatest,
      })
    },
  )

  tool(
    'gh_release_delete',
    'Delete a GitHub release. Requires confirm: true. The git tag itself is not removed — use gh_tag_delete for that.',
    repoParams({
      tag: { type: 'string', description: 'Release tag to delete.' },
      releaseId: { type: 'number', description: 'Release id, when the tag is unknown.' },
      confirm: { type: 'boolean', description: 'Must be true to actually delete.' },
    }),
    async (args) => {
      if (args.confirm !== true) throw new Error('refusing to delete a release without confirm: true')
      const { owner, repo } = asRepo(args, liveConfig())
      return deleteRelease(await client(), { owner, repo, tag: args.tag, releaseId: args.releaseId })
    },
  )

  // ------------------------------------------------------------------------ tags

  tool(
    'gh_tag_list',
    'List git tags of a repository with their commit SHAs. Read-only. Use it to check whether the tag for a release already exists.',
    repoParams({ limit: { type: 'number', description: 'How many tags to return (default 100).' } }),
    async (args) => {
      const { owner, repo } = asRepo(args, liveConfig())
      const result = await listTags(await client(), { owner, repo, limit: args.limit })
      return { tags: result.tags, count: result.count }
    },
  )

  tool(
    'gh_tag_create',
    'Create a git tag. Without message it is lightweight; with message GitHub creates an annotated tag object first. Pass sha to tag a specific commit, otherwise HEAD is tagged.',
    repoParams({
      tag: { type: 'string', description: 'Tag name, e.g. "v1.2.3".' },
      sha: { type: 'string', description: 'Commit SHA to tag; defaults to HEAD.' },
      message: { type: 'string', description: 'Annotation message; presence makes the tag annotated.' },
    }),
    async (args) => {
      const { owner, repo } = asRepo(args, liveConfig())
      return createTag(await client(), { owner, repo, tag: args.tag, sha: args.sha, message: args.message })
    },
  )

  tool(
    'gh_tag_delete',
    'Delete a git tag. Requires confirm: true.',
    repoParams({
      tag: { type: 'string', description: 'Tag to delete.' },
      confirm: { type: 'boolean', description: 'Must be true to actually delete.' },
    }),
    async (args) => {
      if (args.confirm !== true) throw new Error('refusing to delete a tag without confirm: true')
      const { owner, repo } = asRepo(args, liveConfig())
      return deleteTag(await client(), { owner, repo, tag: args.tag })
    },
  )

  // ------------------------------------------------------------------------- api

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
      return {
        method: result.method || 'GRAPHQL',
        mutating: Boolean(result.mutating),
        status: result.status,
        data: result.data,
      }
    },
  )
}
