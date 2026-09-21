import test from 'node:test'
import assert from 'node:assert/strict'

import {
  repoTree,
  pushFiles,
  uploadProject,
  deleteFile,
  deleteBranch,
  repoDefaultBranch,
} from '../lib/tools/write-files.js'

/** Client double recording every call, answering from a route table of functions. */
function clientDouble(routes = {}) {
  const calls = []
  const answer = (method, path, body) => {
    calls.push({ method, path, body })
    // the most specific fragment wins: a generic '/repos/o/r' must not shadow
    // '/repos/o/r/git/ref/heads/main'
    let best = null
    let bestLength = -1
    for (const [key, value] of Object.entries(routes)) {
      const [routeMethod, fragment] = key.split(' ')
      if (routeMethod !== method || !path.includes(fragment)) continue
      if (fragment.length > bestLength) {
        best = value
        bestLength = fragment.length
      }
    }
    return typeof best === 'function' ? best(path, body) : (best || { data: {} })
  }
  return {
    calls,
    get: async (path, opts) => answer('GET', path, opts),
    post: async (path, body) => answer('POST', path, body),
    patch: async (path, body) => answer('PATCH', path, body),
    del: async (path, opts) => answer('DELETE', path, opts),
  }
}

const blob = (sha) => ({ data: { sha } })

test('repoTree lists a recursive tree and reports truncation', async () => {
  const client = clientDouble({
    'GET /git/trees/': { data: { truncated: true, tree: [{ path: 'lib/a.js', type: 'blob', size: 10, sha: 's1' }, { path: 'lib', type: 'tree', sha: 's2' }] } },
  })
  const tree = await repoTree(client, { owner: 'o', repo: 'r', ref: 'main' })
  assert.equal(tree.count, 2)
  assert.equal(tree.truncated, true)
  assert.equal(tree.entries[0].path, 'lib/a.js')
  assert.equal(client.calls[0].path, '/repos/o/r/git/trees/main')
  assert.equal(client.calls[0].body.query.recursive, '1')
})

test('pushFiles builds blob, tree, commit and moves an existing branch', async () => {
  const client = clientDouble({
    'GET /git/ref/heads/main': { data: { object: { sha: 'parent1' } } },
    'GET /git/commits/parent1': { data: { tree: { sha: 'tree1' } } },
    'POST /git/blobs': (path, body) => blob(body.content === 'hello' ? 'blobA' : 'blobB'),
    'POST /git/trees': { data: { sha: 'tree2' } },
    'POST /git/commits': { data: { sha: 'commit2' } },
    'PATCH /git/refs/heads/main': { data: { object: { sha: 'commit2' } } },
  })
  const result = await pushFiles(client, {
    owner: 'o', repo: 'r', branch: 'main', message: 'feat: two files',
    files: [{ path: 'a.txt', content: 'hello' }, { path: 'b.txt', content: 'world' }],
  })
  assert.deepEqual(result, { commit: 'commit2', branch: 'main', files: 2, created: false })

  const tree = client.calls.find((c) => c.method === 'POST' && c.path.includes('/git/trees'))
  assert.equal(tree.body.base_tree, 'tree1', 'the new tree is built on the branch tree')
  assert.equal(tree.body.tree.length, 2)
  assert.equal(tree.body.tree[0].sha, 'blobA')
  const commit = client.calls.find((c) => c.method === 'POST' && c.path.includes('/git/commits'))
  assert.deepEqual(commit.body.parents, ['parent1'])
  const ref = client.calls.find((c) => c.method === 'PATCH')
  assert.equal(ref.body.sha, 'commit2')
  assert.equal(ref.body.force, false, 'force is never implied')
})

test('pushFiles creates a branch when it does not exist, from the base', async () => {
  const client = clientDouble({
    'GET /git/ref/heads/feat': { data: undefined, status: 404, __notFound: true },
    'GET /repos/o/r': { data: { default_branch: 'main' } },
    'GET /git/ref/heads/main': { data: { object: { sha: 'base1' } } },
    'GET /git/commits/base1': { data: { tree: { sha: 'treeBase' } } },
    'POST /git/blobs': blob('blobX'),
    'POST /git/trees': { data: { sha: 'treeNew' } },
    'POST /git/commits': { data: { sha: 'commitNew' } },
    'POST /git/refs': { data: { ref: 'refs/heads/feat' } },
  })
  // the first ref lookup answers 404 the way the real client does
  const originalGet = client.get
  client.get = async (path, opts) => {
    if (path.includes('/git/ref/heads/feat')) {
      const err = new Error('Not Found')
      err.status = 404
      throw err
    }
    return originalGet(path, opts)
  }
  const result = await pushFiles(client, { owner: 'o', repo: 'r', branch: 'feat', message: 'init', files: [{ path: 'a', content: 'x' }] })
  assert.equal(result.created, true)
  const created = client.calls.find((c) => c.method === 'POST' && c.path.includes('/git/refs'))
  assert.equal(created.body.ref, 'refs/heads/feat')
})

test('pushFiles validates its inputs and passes force through only when asked', async () => {
  const client = clientDouble({ 'GET /git/ref/heads/b': { data: { object: { sha: 'p' } } }, 'GET /git/commits/p': { data: { tree: { sha: 't' } } }, 'POST /git/blobs': blob('b'), 'POST /git/trees': { data: { sha: 't2' } }, 'POST /git/commits': { data: { sha: 'c2' } }, 'PATCH /git/refs/heads/b': { data: {} } })
  await assert.rejects(() => pushFiles(client, { owner: 'o', repo: 'r', branch: 'b', message: 'm', files: [] }), /non-empty/)
  await assert.rejects(() => pushFiles(client, { owner: 'o', repo: 'r', branch: 'b', files: [{ path: 'a', content: 'x' }] }), /message is required/)
  await pushFiles(client, { owner: 'o', repo: 'r', branch: 'b', message: 'm', files: [{ path: 'a', content: 'x' }], force: true })
  assert.equal(client.calls.find((c) => c.method === 'PATCH').body.force, true)
})

test('uploadProject creates the repository, publishes files and opens a pull request', async () => {
  const client = clientDouble({
    'POST /user/repos': { data: { full_name: 'o/new', default_branch: 'main' } },
    'GET /repos/o/new': { data: { default_branch: 'main' } },
    'GET /git/ref/heads/main': { data: { object: { sha: 'p1' } } },
    'GET /git/ref/heads/feat/init': { data: { object: { sha: 'p1' } } },
    'GET /git/commits/p1': { data: { tree: { sha: 't1' } } },
    'POST /git/blobs': blob('blobA'),
    'POST /git/trees': { data: { sha: 't2' } },
    'POST /git/commits': { data: { sha: 'c2' } },
    'PATCH /git/refs/heads/feat/init': { data: {} },
    'POST /pulls': { data: { number: 1, html_url: 'https://github.com/o/new/pull/1' } },
  })
  const result = await uploadProject(client, {
    owner: 'o', repo: 'new', description: 'demo', files: [{ path: 'README.md', content: 'hi' }],
    branch: 'feat/init', createPullRequest: true, sleep: async () => {},
  })
  assert.equal(result.repository, 'o/new')
  assert.equal(result.branch, 'feat/init')
  assert.equal(result.commit, 'c2')
  assert.equal(result.pullRequest.number, 1)
  assert.ok(client.calls.some((c) => c.method === 'POST' && c.path === '/user/repos'))
})

test('uploadProject continues with an existing repository instead of failing', async () => {
  const notFound = new Error('Validation Failed')
  notFound.status = 422
  const client = clientDouble({
    'GET /repos/o/existing': { data: { full_name: 'o/existing', default_branch: 'main' } },
    'GET /git/ref/heads/main': { data: { object: { sha: 'p' } } },
    'GET /git/commits/p': { data: { tree: { sha: 't' } } },
    'POST /git/blobs': blob('b'),
    'POST /git/trees': { data: { sha: 't2' } },
    'POST /git/commits': { data: { sha: 'c2' } },
    'PATCH /git/refs/heads/main': { data: {} },
  })
  client.post = async (path, body) => {
    client.calls.push({ method: 'POST', path, body })
    if (path === '/user/repos') throw notFound
    if (path.includes('/git/blobs')) return blob('b')
    if (path.includes('/git/trees')) return { data: { sha: 't2' } }
    if (path.includes('/git/commits')) return { data: { sha: 'c2' } }
    return { data: {} }
  }
  const result = await uploadProject(client, { owner: 'o', repo: 'existing', files: [{ path: 'a', content: 'x' }], sleep: async () => {} })
  assert.equal(result.repository, 'o/existing')
  assert.equal(result.commit, 'c2')
})

test('deleteFile resolves the sha first and sends the deletion', async () => {
  const client = clientDouble({
    'GET /contents/lib/a.js': { data: { sha: 'fileSha' } },
    'DELETE /contents/lib/a.js': { data: { commit: { sha: 'delCommit' } } },
  })
  const result = await deleteFile(client, { owner: 'o', repo: 'r', path: '/lib/a.js', message: 'chore: drop it', branch: 'main' })
  assert.deepEqual(result, { deleted: true, path: '/lib/a.js', commit: 'delCommit' })
  const deletion = client.calls.find((c) => c.method === 'DELETE')
  assert.equal(deletion.body.body.sha, 'fileSha')
  assert.equal(deletion.body.body.branch, 'main')
})

test('deleteFile refuses a missing path or message', async () => {
  const client = clientDouble({})
  await assert.rejects(() => deleteFile(client, { owner: 'o', repo: 'r', message: 'm' }), /path is required/)
  await assert.rejects(() => deleteFile(client, { owner: 'o', repo: 'r', path: 'a' }), /message is required/)
})

test('deleteBranch deletes the encoded ref and requires a branch', async () => {
  const client = clientDouble({ 'DELETE /git/refs/heads/': { data: {} } })
  const result = await deleteBranch(client, { owner: 'o', repo: 'r', branch: 'feat/x' })
  assert.deepEqual(result, { deleted: true, branch: 'feat/x' })
  assert.ok(client.calls[0].path.includes('feat%2Fx'))
  await assert.rejects(() => deleteBranch(client, { owner: 'o', repo: 'r' }), /branch is required/)
})

test('repoDefaultBranch retries a fresh repository and gives up with the last error', async () => {
  let attempts = 0
  const flaky = {
    get: async () => {
      attempts += 1
      if (attempts < 3) {
        const err = new Error('Not Found')
        err.status = 404
        throw err
      }
      return { data: { default_branch: 'main' } }
    },
  }
  assert.equal(await repoDefaultBranch(flaky, { owner: 'o', repo: 'r', attempts: 5, sleep: async () => {} }), 'main')
  assert.equal(attempts, 3)

  const broken = { get: async () => { const err = new Error('boom'); err.status = 500; throw err } }
  await assert.rejects(() => repoDefaultBranch(broken, { owner: 'o', repo: 'r', attempts: 2, sleep: async () => {} }), /boom/)
})
