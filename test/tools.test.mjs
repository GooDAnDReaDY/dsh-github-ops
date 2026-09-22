import test from 'node:test'
import assert from 'node:assert/strict'

import { listTags, createTag, deleteTag, getTag } from '../lib/tools/tags.js'
import { validateApiCall, callApi } from '../lib/tools/api.js'

function clientDouble({ refs = [], head = 'abc123', tagObject = { sha: 'tag-sha' } } = {}) {
  const calls = []
  return {
    calls,
    get: async (path) => {
      calls.push({ method: 'GET', path })
      if (path.endsWith('/commits/HEAD')) return { data: { sha: head } }
      if (path.includes('/git/ref/tags/')) return { data: { object: { sha: 'tag-sha', type: 'commit' } } }
      return { data: refs }
    },
    post: async (path, body) => {
      calls.push({ method: 'POST', path, body })
      if (path.endsWith('/git/tags')) return { data: tagObject }
      return { data: { url: 'https://api.github.com/x', ...body } }
    },
    del: async (path) => { calls.push({ method: 'DELETE', path }); return { data: null } },
    request: async (method, path, opts) => {
      calls.push({ method, path, opts })
      return { data: { method, path }, status: 200 }
    },
    graphql: async (query, variables) => {
      calls.push({ method: 'GRAPHQL', path: query, opts: variables })
      return { viewer: { login: 'octocat' } }
    },
    paginate: async (path, opts) => {
      calls.push({ method: 'PAGINATE', path, opts })
      return refs
    },
  }
}

test('listTags maps refs to tag names and SHAs', async () => {
  const client = clientDouble({
    refs: [
      { ref: 'refs/tags/v1.0.0', object: { sha: 'a1', type: 'commit' } },
      { ref: 'refs/tags/v1.1.0', object: { sha: 'b2', type: 'tag' } },
    ],
  })
  const result = await listTags(client, { owner: 'o', repo: 'r' })
  assert.equal(result.count, 2)
  assert.deepEqual(result.tags[0], { name: 'v1.0.0', sha: 'a1', type: 'commit' })
  assert.deepEqual(result.tags[1], { name: 'v1.1.0', sha: 'b2', type: 'tag' })
})

test('getTag reads a single ref', async () => {
  const client = clientDouble({})
  const tag = await getTag(client, { owner: 'o', repo: 'r', tag: 'v1.0.0' })
  assert.deepEqual(tag, { name: 'v1.0.0', sha: 'tag-sha', type: 'commit' })
})

test('createTag builds a lightweight ref by default and tags HEAD when sha is omitted', async () => {
  const client = clientDouble({ head: 'head-sha' })
  const result = await createTag(client, { owner: 'o', repo: 'r', tag: 'v1.2.3' })
  assert.equal(result.annotated, false)
  assert.equal(result.target, 'head-sha')
  const refCall = client.calls.find((c) => c.path === '/repos/o/r/git/refs')
  assert.deepEqual(refCall.body, { ref: 'refs/tags/v1.2.3', sha: 'head-sha' })
})

test('createTag with a message creates the tag object first and points the ref at it', async () => {
  const client = clientDouble({ head: 'head-sha', tagObject: { sha: 'annotation-sha' } })
  const result = await createTag(client, { owner: 'o', repo: 'r', tag: 'v1.2.3', message: 'release 1.2.3' })
  assert.equal(result.annotated, true)
  assert.equal(result.sha, 'annotation-sha')
  const order = client.calls.map((c) => c.path)
  assert.ok(order.indexOf('/repos/o/r/git/tags') < order.indexOf('/repos/o/r/git/refs'), 'tag object comes first')
  const tagObjectCall = client.calls.find((c) => c.path === '/repos/o/r/git/tags')
  assert.equal(tagObjectCall.body.object, 'head-sha')
  assert.equal(tagObjectCall.body.type, 'commit')
})

test('deleteTag deletes the encoded ref and requires a tag name', async () => {
  const client = clientDouble({})
  const result = await deleteTag(client, { owner: 'o', repo: 'r', tag: 'v1.0.0' })
  assert.deepEqual(result, { deleted: true, tag: 'v1.0.0' })
  assert.equal(client.calls.at(-1).path, '/repos/o/r/git/refs/tags/v1.0.0')
  await assert.rejects(() => deleteTag(client, { owner: 'o', repo: 'r' }), /tag is required/)
})

test('validateApiCall allows reads and blocks mutations without confirm', () => {
  assert.deepEqual(validateApiCall({ method: 'GET', path: '/repos/o/r' }), { method: 'GET', mutating: false })
  assert.throws(() => validateApiCall({ method: 'POST', path: '/repos/o/r/issues' }), /confirm: true/)
  assert.throws(() => validateApiCall({ method: 'DELETE', path: '/repos/o/r/issues/1' }), /confirm: true/)
  assert.deepEqual(
    validateApiCall({ method: 'POST', path: '/repos/o/r/issues', confirm: true }),
    { method: 'POST', mutating: true },
  )
})

test('validateApiCall refuses malformed paths and the irreversibly destructive calls', () => {
  assert.throws(() => validateApiCall({ method: 'GET', path: 'repos/o/r' }), /must start with/)
  assert.throws(() => validateApiCall({ method: 'DELETE', path: '/repos/o/r', confirm: true }), /deleting a repository/)
  assert.throws(() => validateApiCall({ method: 'POST', path: '/repos/o/r/transfer', confirm: true }), /transferring a repository/)
  assert.throws(() => validateApiCall({ method: 'DELETE', path: '/orgs/acme', confirm: true }), /deleting an organization/)
})

test('callApi routes REST calls and reports the mutating flag', async () => {
  const client = clientDouble({})
  const read = await callApi(client, { method: 'GET', path: '/repos/o/r' })
  assert.equal(read.mutating, false)
  assert.equal(client.calls[0].method, 'GET')

  const write = await callApi(client, { method: 'POST', path: '/repos/o/r/issues', body: { title: 'x' }, confirm: true })
  assert.equal(write.mutating, true)
  assert.deepEqual(client.calls[1].opts.body, { title: 'x' })
})

test('callApi runs GraphQL when a query is given', async () => {
  const client = clientDouble({})
  const result = await callApi(client, { graphql: 'query { viewer { login } }' })
  assert.deepEqual(result, { graphql: true, data: { viewer: { login: 'octocat' } } })
})
