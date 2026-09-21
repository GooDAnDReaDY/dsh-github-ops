// Content and account tools: writing files without a checkout, and signing in without a
// terminal.
//
// Nothing here stores a value in a tool result: the sign-in writes its file and reports only
// the account and the scope. Destructive calls (deleting a file or a branch, signing out,
// forcing a ref) need `confirm: true`.

import {
  repoTree,
  pushFiles,
  uploadProject,
  deleteFile,
  deleteBranch,
} from './write-files.js'
import {
  startDeviceFlow,
  pollDeviceFlow,
  writeAccessFile,
  readAccessFile,
  clearAccessFile,
  accessFilePath,
  DEFAULT_CLIENT_ID,
  DEFAULT_SCOPE,
} from '../auth-device.js'

const REPOSITORY = {
  repository: { type: 'string', description: 'Repository as "owner/repo". Omit to use the default from settings or the checkout.' },
}

const FILES_PARAM = {
  type: 'array',
  description: 'Files to publish: [{ path, content, base64? }]. `path` is relative to the repository root.',
  items: { type: 'object', additionalProperties: true },
}

export function registerWriteTools({ tool, asRepo, client, liveConfig, auth }) {
  const repoParams = (extra = {}) => ({ ...REPOSITORY, ...extra })
  const authConfig = () => auth.config()

  tool(
    'gh_repo_tree',
    'List the file tree of a repository at a ref, recursively by default. Read-only, and much cheaper than walking directories one by one.',
    repoParams({
      ref: { type: 'string', description: 'Branch, tag or commit; defaults to HEAD.' },
      path: { type: 'string', description: 'Only the subtree under this path.' },
      recursive: { type: 'boolean', description: 'Walk the whole tree (default true).' },
      limit: { type: 'number', description: 'How many entries (default 500).' },
    }),
    async (args) => {
      const { owner, repo } = await asRepo(args, liveConfig())
      return repoTree(await client(), {
        owner, repo, ref: args.ref, path: args.path, recursive: args.recursive !== false, limit: args.limit,
      })
    },
  )

  tool(
    'gh_push_files',
    'Commit one or more files to a branch without a local checkout: blobs, a tree on top of the branch tree, a commit, then the ref moves. Creates the branch when it does not exist. Read the branch first if you need to preserve its current content.',
    repoParams({
      branch: { type: 'string', description: 'Branch to write to.' },
      message: { type: 'string', description: 'Commit message.' },
      files: FILES_PARAM,
      base: { type: 'string', description: 'Branch to start from when the target branch does not exist.' },
      force: { type: 'boolean', description: 'Move the ref backwards. Requires confirm: true and is never implied.' },
      confirm: { type: 'boolean', description: 'Required when force is true.' },
    }),
    async (args) => {
      if (args.force === true && args.confirm !== true) {
        throw new Error('refusing to force a ref without confirm: true')
      }
      const { owner, repo } = await asRepo(args, liveConfig())
      return pushFiles(await client(), {
        owner, repo, branch: args.branch, message: args.message, files: args.files, base: args.base, force: args.force === true,
      })
    },
  )

  tool(
    'gh_upload_project',
    'Create a repository, publish files into it and optionally open a pull request — the whole "upload this project" flow in one call. An existing repository is used as is instead of failing.',
    {
      repository: { type: 'string', description: 'Target repository as "owner/repo"; the owner is used for the default account.' },
      org: { type: 'string', description: 'Organization to create the repository in.' },
      description: { type: 'string', description: 'Repository description.' },
      private: { type: 'boolean', description: 'Private repository (default true).' },
      files: FILES_PARAM,
      branch: { type: 'string', description: 'Branch to publish into; defaults to the default branch.' },
      base: { type: 'string', description: 'Base branch for the pull request.' },
      title: { type: 'string', description: 'Commit message and pull request title.' },
      body: { type: 'string', description: 'Pull request body.' },
      createPullRequest: { type: 'boolean', description: 'Open a pull request after publishing.' },
    },
    async (args) => {
      const cfg = liveConfig()
      let owner = args.org || ''
      let repo = args.repository || ''
      if (repo.includes('/')) {
        const [ownerPart, repoPart] = repo.split('/')
        owner = args.org || ownerPart
        repo = repoPart
      } else if (!owner) {
        const resolved = await asRepo({ repository: cfg.defaultRepository }, cfg).catch(() => null)
        owner = resolved ? resolved.owner : ''
      }
      return uploadProject(await client(), {
        owner,
        repo,
        org: args.org,
        description: args.description,
        private: args.private !== false,
        files: args.files,
        branch: args.branch,
        base: args.base,
        title: args.title,
        body: args.body,
        createPullRequest: args.createPullRequest === true,
      })
    },
  )

  tool(
    'gh_delete_file',
    'Delete one file from a branch. Requires confirm: true.',
    repoParams({
      path: { type: 'string', description: 'File path inside the repository.' },
      message: { type: 'string', description: 'Commit message.' },
      branch: { type: 'string', description: 'Branch; defaults to the default branch.' },
      confirm: { type: 'boolean', description: 'Must be true to delete.' },
    }),
    async (args) => {
      if (args.confirm !== true) throw new Error('refusing to delete a file without confirm: true')
      const { owner, repo } = await asRepo(args, liveConfig())
      return deleteFile(await client(), { owner, repo, path: args.path, message: args.message, branch: args.branch })
    },
  )

  tool(
    'gh_delete_branch',
    'Delete a branch. Requires confirm: true.',
    repoParams({
      branch: { type: 'string', description: 'Branch to delete.' },
      confirm: { type: 'boolean', description: 'Must be true to delete.' },
    }),
    async (args) => {
      if (args.confirm !== true) throw new Error('refusing to delete a branch without confirm: true')
      const { owner, repo } = await asRepo(args, liveConfig())
      return deleteBranch(await client(), { owner, repo, branch: args.branch })
    },
  )

  // ------------------------------------------------------------------ account

  tool(
    'gh_auth_login',
    'Start a GitHub sign-in without a terminal: returns a short code and a URL for the human. Approve it in the browser, then call gh_auth_finish to collect the access. Stored in this plugin\'s own file with mode 0600; the value is never returned.',
    {
      scope: { type: 'string', description: `OAuth scope to request (default "${DEFAULT_SCOPE}").` },
      clientId: { type: 'string', description: `OAuth app id (default: the public gh CLI application ${DEFAULT_CLIENT_ID}).` },
    },
    async (args) => {
      const cfg = authConfig()
      const flow = await startDeviceFlow({
        clientId: args.clientId || cfg.clientId || DEFAULT_CLIENT_ID,
        scope: args.scope || cfg.scope || DEFAULT_SCOPE,
        fetchImpl: globalThis.fetch,
      })
      auth.remember(flow)
      return {
        userCode: flow.userCode,
        verificationUri: flow.verificationUri,
        expiresInSeconds: flow.expiresInSeconds,
        pollIntervalSeconds: flow.intervalSeconds,
        next: 'ask the human to approve, then call gh_auth_finish',
      }
    },
  )

  tool(
    'gh_auth_finish',
    'Collect a started sign-in. Polls while the human is approving, then stores the access in this plugin\'s file and reports the sign-in name only.',
    {
      maxWaitMs: { type: 'number', description: 'How long to keep polling (default 120000).' },
    },
    async (args) => {
      const pending = auth.pending()
      if (!pending) throw new Error('no sign-in is in progress: call gh_auth_login first')
      const cfg = authConfig()
      const outcome = await pollDeviceFlow({
        clientId: cfg.clientId || DEFAULT_CLIENT_ID,
        clientSecret: auth.secret(),
        deviceCode: pending.deviceCode,
        intervalSeconds: pending.intervalSeconds,
        maxWaitMs: args.maxWaitMs,
        fetchImpl: globalThis.fetch,
      })
      if (outcome.status !== 'authorized') return { status: outcome.status, message: outcome.message }
      const saved = await writeAccessFile(auth.path(), {
        token: outcome.token,
        scope: outcome.scope || pending.scope,
        source: 'device-flow',
      })
      auth.forget()
      return { status: 'authorized', stored: saved.path, login: saved.login || '', scope: saved.scope }
    },
  )

  tool(
    'gh_auth_status',
    'Report where the current access comes from and whether it works: the source (credential, environment, this plugin\'s sign-in, gh CLI), the account, and the remaining API rate limit. The value itself is never shown. Read-only.',
    {},
    async () => {
      const cfg = liveConfig()
      const access = await auth.resolve()
      if (!access.value) return { configured: false, guidance: access.guidance }
      const github = await client()
      const { data, rateLimit } = await github.get('/user')
      return {
        configured: true,
        source: access.source,
        login: data && data.login,
        name: data && data.name,
        scopes: github.lastScopes ? github.lastScopes() : undefined,
        rateLimit: rateLimit || undefined,
        accessFile: auth.path(),
      }
    },
  )

  tool(
    'gh_auth_logout',
    'Forget the sign-in stored by this plugin (gh_auth_login). Other sources (a DSH credential, the environment, the gh CLI) are untouched. Requires confirm: true.',
    { confirm: { type: 'boolean', description: 'Must be true to sign out.' } },
    async (args) => {
      if (args.confirm !== true) throw new Error('refusing to sign out without confirm: true')
      const file = auth.path()
      const stored = await readAccessFile(file)
      const result = await clearAccessFile(file)
      return { ...result, had: Boolean(stored), note: result.removed ? 'the stored sign-in is gone' : 'nothing was stored' }
    },
  )

  // keep the imports honest for callers that compose their own flows
  return { accessFilePath, readAccessFile }
}
