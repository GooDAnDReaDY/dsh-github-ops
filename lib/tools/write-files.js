// Writing files without a local checkout.
//
// A commit is built the way git builds it: blobs, a tree on top of the branch's tree, a
// commit, then the ref moves. Nothing here needs a working copy, so the agent can create a
// repository, publish files and open a pull request from a conversation alone.
//
// `force` is never implied: moving a ref backwards is an explicit request, and the tool layer
// asks for `confirm: true` on top of it.

function ensureRepo({ owner, repo }) {
  if (!owner || !repo) throw new Error('owner and repo are required (pass "owner/repo")')
}

/** Files of a tree, one level or recursive, with the truncation flag GitHub returns. */
export async function repoTree(client, { owner, repo, ref, path, recursive = true, limit = 500 } = {}) {
  ensureRepo({ owner, repo })
  const capped = Math.max(1, Math.min(Number(limit) || 500, 2000))
  const target = ref || 'HEAD'
  const suffix = path ? `/${String(path).replace(/^\/+|\/+$/g, '')}` : ''
  const { data } = await client.get(`/repos/${owner}/${repo}/git/trees/${encodeURIComponent(target)}${suffix}`, {
    query: recursive ? { recursive: '1' } : undefined,
  })
  const entries = (data && Array.isArray(data.tree) ? data.tree : []).slice(0, capped).map((entry) => {
    // a directory has no size in the API: say nothing rather than claiming undefined
    const row = { path: entry.path, type: entry.type, sha: entry.sha }
    if (typeof entry.size === 'number') row.size = entry.size
    return row
  })
  return {
    ref: target,
    path: path || '',
    truncated: Boolean(data && data.truncated),
    count: entries.length,
    entries,
  }
}

async function refSha(client, owner, repo, branch) {
  try {
    const { data } = await client.get(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`)
    return data && data.object && data.object.sha ? data.object.sha : ''
  } catch (err) {
    if (err && err.status === 404) return ''
    throw err
  }
}

/** Encode one file the way the API wants it. */
function fileBlob(file) {
  const path = String(file.path || '').replace(/^\/+/, '')
  if (!path) throw new Error('every file needs a path')
  const base64 = file.base64 === true || file.encoding === 'base64'
  return { path, content: String(file.content ?? ''), encoding: base64 ? 'base64' : 'utf-8' }
}

/**
 * Commit one or more files to a branch, creating the branch when it does not exist.
 *
 * @returns {{commit: string, branch: string, files: number, created: boolean}}
 */
export async function pushFiles(client, { owner, repo, branch, message, files = [], base, force = false } = {}) {
  ensureRepo({ owner, repo })
  if (!branch) throw new Error('branch is required')
  if (!message) throw new Error('message is required')
  if (!Array.isArray(files) || files.length === 0) throw new Error('files must be a non-empty array')

  const head = await refSha(client, owner, repo, branch)
  let parent = head
  let parentTree = ''
  const created = !head
  if (!head) {
    const from = base || (await repoDefaultBranch(client, { owner, repo }))
    parent = await refSha(client, owner, repo, from)
    if (!parent) throw new Error(`cannot start branch "${branch}": "${from}" has no commit yet`)
  }
  const { data: commitData } = await client.get(`/repos/${owner}/${repo}/git/commits/${parent}`)
  parentTree = commitData && commitData.tree ? commitData.tree.sha : ''

  const tree = []
  for (const file of files) {
    const { path, content, encoding } = fileBlob(file)
    const { data: blob } = await client.post(`/repos/${owner}/${repo}/git/blobs`, { content, encoding })
    if (!blob || !blob.sha) throw new Error(`cannot create a blob for ${path}`)
    tree.push({ path, mode: '100644', type: 'blob', sha: blob.sha })
  }

  const treePayload = { tree }
  if (parentTree) treePayload.base_tree = parentTree
  const { data: newTree } = await client.post(`/repos/${owner}/${repo}/git/trees`, treePayload)
  if (!newTree || !newTree.sha) throw new Error('cannot create the tree')

  const { data: newCommit } = await client.post(`/repos/${owner}/${repo}/git/commits`, {
    message,
    tree: newTree.sha,
    parents: [parent],
  })
  if (!newCommit || !newCommit.sha) throw new Error('cannot create the commit')

  if (head) {
    await client.patch(`/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
      sha: newCommit.sha,
      force: Boolean(force),
    })
  } else {
    await client.post(`/repos/${owner}/${repo}/git/refs`, {
      ref: `refs/heads/${branch}`,
      sha: newCommit.sha,
    })
  }
  return { commit: newCommit.sha, branch, files: tree.length, created }
}

/** Default branch of a repository (a fresh repository may not answer immediately). */
export async function repoDefaultBranch(client, { owner, repo, attempts = 5, sleep = defaultSleep } = {}) {
  ensureRepo({ owner, repo })
  let lastError = null
  for (let attempt = 1; attempt <= Math.max(1, attempts); attempt += 1) {
    try {
      const { data } = await client.get(`/repos/${owner}/${repo}`)
      if (data && data.default_branch) return data.default_branch
    } catch (err) {
      lastError = err
    }
    if (attempt < attempts) await sleep(1000)
  }
  if (lastError) throw lastError
  throw new Error(`cannot read the default branch of ${owner}/${repo} yet`)
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Create a repository, publish files into it and optionally open a pull request — the
 * "upload this project" flow in one call.
 */
export async function uploadProject(client, {
  owner, repo, description, private: isPrivate = true, files = [], branch, base, title, body,
  createPullRequest = false, org, attempts = 5, sleep = defaultSleep,
} = {}) {
  if (!repo) throw new Error('repository name is required')
  if (!Array.isArray(files) || files.length === 0) throw new Error('files must be a non-empty array')

  let repository = null
  try {
    repository = await client.post(org ? `/orgs/${org}/repos` : '/user/repos', {
      name: repo,
      description: description || '',
      private: Boolean(isPrivate),
      auto_init: true,
    })
  } catch (err) {
    if (!err || err.status !== 422) throw err
    // already exists: continue with it, the caller asked to publish into it
    const full = org ? `${org}/${repo}` : `${owner}/${repo}`
    const [foundOwner, foundRepo] = full.split('/')
    const { data } = await client.get(`/repos/${foundOwner}/${foundRepo}`)
    repository = data
  }
  const fullName = (repository && repository.full_name) || `${org || owner}/${repo}`
  const [repoOwner, repoName] = fullName.split('/')
  const target = branch || (await repoDefaultBranch(client, { owner: repoOwner, repo: repoName, attempts, sleep }))

  const pushed = await pushFiles(client, {
    owner: repoOwner, repo: repoName, branch: target, message: title || 'Initial commit', files, base,
  })

  let pullRequest = null
  if (createPullRequest) {
    const baseBranch = base || (await repoDefaultBranch(client, { owner: repoOwner, repo: repoName, attempts, sleep }))
    if (baseBranch !== target) {
      const { data } = await client.post(`/repos/${repoOwner}/${repoName}/pulls`, {
        title: title || 'Initial commit',
        head: target,
        base: baseBranch,
        body: body || '',
      })
      pullRequest = data ? { number: data.number, url: data.html_url } : null
    }
  }
  return { repository: fullName, branch: target, commit: pushed.commit, files: pushed.files, pullRequest }
}

/** Delete one file, resolving its blob sha first (the contents API requires it). */
export async function deleteFile(client, { owner, repo, path, message, branch } = {}) {
  ensureRepo({ owner, repo })
  if (!path) throw new Error('path is required')
  if (!message) throw new Error('message is required')
  const { data: current } = await client.get(`/repos/${owner}/${repo}/contents/${String(path).replace(/^\/+/, '')}`, {
    query: branch ? { ref: branch } : undefined,
  })
  const sha = current && current.sha
  if (!sha) throw new Error(`cannot resolve ${path}`)
  const { data } = await client.del(`/repos/${owner}/${repo}/contents/${String(path).replace(/^\/+/, '')}`, {
    body: { message, sha, ...(branch ? { branch } : {}) },
  })
  return { deleted: true, path, commit: data && data.commit ? data.commit.sha : null }
}

/** Delete a branch. */
export async function deleteBranch(client, { owner, repo, branch } = {}) {
  ensureRepo({ owner, repo })
  if (!branch) throw new Error('branch is required')
  await client.del(`/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`)
  return { deleted: true, branch }
}
