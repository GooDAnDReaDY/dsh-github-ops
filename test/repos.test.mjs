import test from 'node:test'
import assert from 'node:assert/strict'

import { getRepo, getFile, searchRepos, createRepo, editRepo } from '../lib/tools/repos.js'

function clientDouble(routes) {
  const calls = []
  const pick = (path) => {
    for (const [pattern, value] of routes) {
      if (path.startsWith(pattern)) return typeof value === 'function' ? value(path) : value
    }
    return {}
  }
  return {
    calls,
    get: async (path, opts) => { calls.push({ method: 'GET', path, opts }); return { data: pick(path) } },
    post: async (path, body) => { calls.push({ method: 'POST', path, body }); return { data: pick(path) } },
    patch: async (path, body) => { calls.push({ method: 'PATCH', path, body }); return { data: pick(path) } },
    put: async (path, body) => { calls.push({ method: 'PUT', path, body }); return { data: pick(path) } },
  }
}

const repoData = {
  full_name: 'o/r',
  description: 'demo',
  private: false,
  archived: false,
  default_branch: 'main',
  stargazers_count: 5,
  forks_count: 2,
  open_issues_count: 1,
  topics: ['dsh'],
  license: { spdx_id: 'MIT' },
  html_url: 'https://github.com/o/r',
}

test('getRepo normalizes repository metadata', async () => {
  const client = clientDouble([['/repos/o/r', repoData]])
  const repo = await getRepo(client, { owner: 'o', repo: 'r' })
  assert.equal(repo.fullName, 'o/r')
  assert.equal(repo.defaultBranch, 'main')
  assert.equal(repo.stars, 5)
  assert.deepEqual(repo.topics, ['dsh'])
  assert.equal(repo.license, 'MIT')
})

test('getRepo refuses a call without owner/repo', async () => {
  await assert.rejects(() => getRepo(clientDouble([]), { owner: '', repo: 'r' }), /owner and repo are required/)
})

test('getFile decodes base64 content and passes the ref', async () => {
  const content = Buffer.from('hello world', 'utf8').toString('base64')
  const client = clientDouble([['/repos/o/r/contents/', { path: 'a.txt', sha: 's1', size: 11, encoding: 'base64', content }]])
  const file = await getFile(client, { owner: 'o', repo: 'r', path: 'a.txt', ref: 'v1' })
  assert.equal(file.kind, 'file')
  assert.equal(file.content, 'hello world')
  assert.equal(client.calls[0].opts.query.ref, 'v1')
})

test('getFile reports a directory listing instead of decoding it', async () => {
  const client = clientDouble([['/repos/o/r/contents/', [
    { name: 'a.js', type: 'file', size: 10, path: 'lib/a.js' },
    { name: 'b.js', type: 'file', size: 20, path: 'lib/b.js' },
  ]]])
  const dir = await getFile(client, { owner: 'o', repo: 'r', path: 'lib' })
  assert.equal(dir.kind, 'directory')
  assert.equal(dir.entries.length, 2)
  assert.equal(dir.entries[0].name, 'a.js')
})

test('getFile requires a path', async () => {
  await assert.rejects(() => getFile(clientDouble([]), { owner: 'o', repo: 'r' }), /path is required/)
})

test('searchRepos maps results and caps the page size', async () => {
  const client = clientDouble([['/search/repositories', { total_count: 1, items: [repoData] }]])
  const result = await searchRepos(client, { query: 'dsh-plugin', limit: 500 })
  assert.equal(result.total, 1)
  assert.equal(result.repos[0].fullName, 'o/r')
  assert.equal(client.calls[0].opts.query.per_page, 100)
})

test('createRepo posts to the org endpoint when an org is given', async () => {
  const client = clientDouble([['/orgs/acme/repos', repoData], ['/user/repos', repoData]])
  await createRepo(client, { name: 'r', org: 'acme', description: 'x', private: true, autoInit: true })
  await createRepo(client, { name: 'r2' })
  assert.equal(client.calls[0].path, '/orgs/acme/repos')
  assert.deepEqual(client.calls[0].body, { name: 'r', description: 'x', private: true, auto_init: true })
  assert.equal(client.calls[1].path, '/user/repos')
  assert.equal(client.calls[1].body.private, true, 'defaults to private')
})

test('editRepo patches fields and replaces topics in a second call', async () => {
  const client = clientDouble([['/repos/o/r', { ...repoData, description: 'new' }]])
  const updated = await editRepo(client, { owner: 'o', repo: 'r', description: 'new', topics: ['a', 'b'] })
  assert.equal(updated.description, 'new')
  const patch = client.calls.find((c) => c.method === 'PATCH')
  assert.deepEqual(patch.body, { description: 'new' })
  const topics = client.calls.find((c) => c.method === 'PUT')
  assert.deepEqual(topics.body, { names: ['a', 'b'] })
})

test('editRepo re-reads the repository when only topics change', async () => {
  const client = clientDouble([['/repos/o/r', repoData]])
  const updated = await editRepo(client, { owner: 'o', repo: 'r', topics: ['x'] })
  assert.equal(updated.fullName, 'o/r')
  assert.ok(!client.calls.some((c) => c.method === 'PATCH'), 'no empty patch is sent')
})

test('editRepo reports the topics returned by the topics endpoint', async () => {
  // The PATCH response can still carry the previous topics; the only authoritative list
  // is the response of the topics call. Found by the live smoke run: topics came back empty.
  const client = {
    calls: [],
    patch: async (path, body) => { client.calls.push({ method: 'PATCH', path, body }); return { data: { full_name: 'o/r', topics: ['old'] } } },
    put: async (path, body) => { client.calls.push({ method: 'PUT', path, body }); return { data: { names: ['smoke-test', 'dsh'] } } },
    get: async (path) => { client.calls.push({ method: 'GET', path }); return { data: { full_name: 'o/r', topics: [] } } },
  }
  const updated = await editRepo(client, { owner: 'o', repo: 'r', description: 'x', topics: ['smoke-test', 'dsh'] })
  assert.deepEqual(updated.topics, ['smoke-test', 'dsh'])
  assert.equal(client.calls.filter((c) => c.method === 'PUT').length, 1)
})

test('editRepo with topics only still reads the repository once', async () => {
  const client = {
    calls: [],
    put: async (path, body) => { client.calls.push({ method: 'PUT', path, body }); return { data: { names: ['a'] } } },
    get: async (path) => { client.calls.push({ method: 'GET', path }); return { data: { full_name: 'o/r', topics: [] } } },
    patch: async () => { throw new Error('no patch expected') },
  }
  const updated = await editRepo(client, { owner: 'o', repo: 'r', topics: ['a'] })
  assert.deepEqual(updated.topics, ['a'])
  assert.equal(updated.fullName, 'o/r')
})
