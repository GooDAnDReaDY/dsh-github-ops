import test from 'node:test'
import assert from 'node:assert/strict'

import {
  listReleases,
  getRelease,
  createRelease,
  editRelease,
  deleteRelease,
} from '../lib/tools/releases.js'

/** Minimal client double: records calls, returns canned data per path. */
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
    del: async (path) => { calls.push({ method: 'DELETE', path }); return { data: null } },
  }
}

const release = {
  id: 7,
  tag_name: 'v0.1.0',
  name: 'v0.1.0',
  draft: false,
  prerelease: false,
  body: 'notes',
  html_url: 'https://github.com/o/r/releases/tag/v0.1.0',
  assets: [{ name: 'pkg.tgz', size: 10, download_count: 3, browser_download_url: 'https://x/pkg.tgz' }],
}

test('listReleases normalizes the payload and caps the page size', async () => {
  const client = clientDouble([['/repos/o/r/releases', [release]]])
  const result = await listReleases(client, { owner: 'o', repo: 'r', limit: 500 })
  assert.equal(result.count, 1)
  assert.equal(result.releases[0].tag, 'v0.1.0')
  assert.deepEqual(result.releases[0].assets, [{ name: 'pkg.tgz', size: 10, downloads: 3, url: 'https://x/pkg.tgz' }])
  assert.equal(client.calls[0].opts.query.per_page, 100, 'limit is capped at 100')
})

test('listReleases refuses a call without owner/repo', async () => {
  await assert.rejects(() => listReleases(clientDouble([]), { owner: '', repo: '' }), /owner and repo are required/)
})

test('getRelease asks by tag and URL-encodes it', async () => {
  const client = clientDouble([['/repos/o/r/releases/tags/', release]])
  const found = await getRelease(client, { owner: 'o', repo: 'r', tag: 'v0.1.0+build/1' })
  assert.equal(found.tag, 'v0.1.0')
  assert.equal(client.calls[0].path, '/repos/o/r/releases/tags/v0.1.0%2Bbuild%2F1')
})

test('createRelease sends tag, flags and notes; name defaults to the tag', async () => {
  const client = clientDouble([['/repos/o/r/releases', release]])
  await createRelease(client, { owner: 'o', repo: 'r', tag: 'v0.1.0', body: 'notes', draft: true, generateNotes: true })
  const body = client.calls[0].body
  assert.equal(body.tag_name, 'v0.1.0')
  assert.equal(body.name, 'v0.1.0')
  assert.equal(body.draft, true)
  assert.equal(body.generate_release_notes, true)
  assert.equal(body.body, 'notes')
})

test('editRelease resolves the release id from the tag and can mark latest', async () => {
  const client = clientDouble([
    ['/repos/o/r/releases/tags/', release],
    ['/repos/o/r/releases/7', { ...release, name: 'renamed' }],
  ])
  const updated = await editRelease(client, { owner: 'o', repo: 'r', tag: 'v0.1.0', makeLatest: true, name: 'renamed' })
  assert.equal(updated.name, 'renamed')
  const patch = client.calls.find((c) => c.method === 'PATCH')
  assert.equal(patch.path, '/repos/o/r/releases/7')
  assert.equal(patch.body.make_latest, 'true')
})

test('editRelease reports a missing release instead of patching blindly', async () => {
  const client = clientDouble([['/repos/o/r/releases/tags/', { message: 'Not Found' }]])
  await assert.rejects(() => editRelease(client, { owner: 'o', repo: 'r', tag: 'v9' }), /release not found/)
})

test('deleteRelease resolves the tag first and deletes by id', async () => {
  const client = clientDouble([['/repos/o/r/releases/tags/', release]])
  const result = await deleteRelease(client, { owner: 'o', repo: 'r', tag: 'v0.1.0' })
  assert.deepEqual(result, { deleted: true, id: 7, tag: 'v0.1.0' })
  assert.equal(client.calls.at(-1).path, '/repos/o/r/releases/7')
  assert.equal(client.calls.at(-1).method, 'DELETE')
})

test('editRelease and deleteRelease find a DRAFT release the by-tag endpoint hides', async () => {
  // GitHub answers 404 to /releases/tags/{tag} for a draft release, even to the token
  // that just created it; the list endpoint does see drafts, so a miss falls back to it.
  // Found by the live smoke run: "gh_release_edit — Not Found".
  const calls = []
  const client = {
    get: async (path) => {
      calls.push(path)
      if (path.includes('/releases/tags/')) {
        const err = new Error('Not Found')
        err.status = 404
        throw err
      }
      return { data: [{ id: 9, tag_name: 'v0.1.0-draft', draft: true, assets: [] }] }
    },
    patch: async (path, body) => { calls.push(path); return { data: { id: 9, tag_name: 'v0.1.0-draft', name: body.name } } },
    del: async (path) => { calls.push(path); return { data: null } },
  }
  const edited = await editRelease(client, { owner: 'o', repo: 'r', tag: 'v0.1.0-draft', name: 'renamed' })
  assert.equal(edited.name, 'renamed')
  assert.ok(calls.includes('/repos/o/r/releases/9'), 'the patch goes to the id from the list scan')

  calls.length = 0
  const deleted = await deleteRelease(client, { owner: 'o', repo: 'r', tag: 'v0.1.0-draft' })
  assert.deepEqual(deleted, { deleted: true, id: 9, tag: 'v0.1.0-draft' })
  assert.ok(calls.includes('/repos/o/r/releases/9'))
})

test('a real 404 that is not about drafts still reports the release as missing', async () => {
  const client = {
    get: async (path) => {
      if (path.includes('/releases/tags/')) {
        const err = new Error('Not Found')
        err.status = 404
        throw err
      }
      return { data: [] }
    },
    patch: async () => ({ data: {} }),
    del: async () => ({ data: null }),
  }
  await assert.rejects(() => editRelease(client, { owner: 'o', repo: 'r', tag: 'v9' }), /release not found/)
})

test('a non-404 failure while resolving the id is not swallowed', async () => {
  const client = {
    get: async () => { const err = new Error('rate limited'); err.status = 403; throw err },
  }
  await assert.rejects(() => deleteRelease(client, { owner: 'o', repo: 'r', tag: 'v1' }), /rate limited/)
})
