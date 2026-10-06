import test from 'node:test'
import assert from 'node:assert/strict'

import {
  listReleases,
  getRelease,
  createRelease,
  editRelease,
  deleteRelease,
  listReleaseAssets,
  uploadReleaseAsset,
  deleteReleaseAsset,
  generateReleaseNotes,
} from '../lib/tools/releases.js'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

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

test('listReleaseAssets normalizes assets and respects limit', async () => {
  const asset = {
    id: 101,
    name: 'bundle.zip',
    label: 'Binaries',
    state: 'uploaded',
    size: 2048,
    download_count: 5,
    browser_download_url: 'https://github.com/o/r/releases/download/v0.1.0/bundle.zip',
  }
  const client = {
    ...clientDouble([
      ['/repos/o/r/releases/tags/', release],
      ['/repos/o/r/releases/7/assets', [asset]],
    ]),
  }
  const result = await listReleaseAssets(client, { owner: 'o', repo: 'r', tag: 'v0.1.0' })
  assert.equal(result.count, 1)
  assert.equal(result.assets[0].name, 'bundle.zip')
  assert.equal(result.assets[0].size, 2048)
  assert.equal(result.assets[0].downloads, 5)
})

test('uploadReleaseAsset uploads file buffer with proper headers and url', async () => {
  const tmpFile = path.join(os.tmpdir(), 'dsh-test-asset.txt')
  await fs.writeFile(tmpFile, 'hello world asset')
  try {
    let calledUrl = ''
    let calledOpts = {}
    const client = {
      ...clientDouble([['/repos/o/r/releases/tags/', release]]),
      baseUrl: 'https://api.github.com',
      call: async (opts) => {
        calledUrl = opts.url
        calledOpts = opts
        return {
          data: {
            id: 202,
            name: 'test-asset.txt',
            size: 17,
            browser_download_url: 'https://x/test-asset.txt',
          },
        }
      },
    }
    const uploaded = await uploadReleaseAsset(client, {
      owner: 'o', repo: 'r', tag: 'v0.1.0',
      filePath: tmpFile,
      name: 'test-asset.txt',
      label: 'Test Label',
      contentType: 'text/plain',
    })
    assert.equal(uploaded.id, 202)
    assert.equal(uploaded.name, 'test-asset.txt')
    assert.ok(calledUrl.startsWith('https://uploads.github.com/repos/o/r/releases/7/assets'))
    assert.equal(calledOpts.query.name, 'test-asset.txt')
    assert.equal(calledOpts.query.label, 'Test Label')
    assert.equal(calledOpts.headers['content-type'], 'text/plain')
  } finally {
    await fs.unlink(tmpFile).catch(() => {})
  }
})

test('deleteReleaseAsset deletes asset by id', async () => {
  const client = clientDouble([])
  const result = await deleteReleaseAsset(client, { owner: 'o', repo: 'r', assetId: 202 })
  assert.equal(result.deleted, true)
  assert.equal(result.assetId, 202)
  assert.equal(client.calls[0].path, '/repos/o/r/releases/assets/202')
  assert.equal(client.calls[0].method, 'DELETE')
})

test('generateReleaseNotes requests release notes from GitHub API', async () => {
  const client = clientDouble([
    ['/repos/o/r/releases/generate-notes', { name: 'v1.0.0', body: '## Changes\n* feat: cool stuff' }],
  ])
  const result = await generateReleaseNotes(client, {
    owner: 'o', repo: 'r',
    tag: 'v1.0.0',
    target: 'main',
    previousTag: 'v0.9.0',
  })
  assert.equal(result.name, 'v1.0.0')
  assert.equal(result.body, '## Changes\n* feat: cool stuff')
  assert.equal(client.calls[0].path, '/repos/o/r/releases/generate-notes')
  assert.equal(client.calls[0].body.tag_name, 'v1.0.0')
  assert.equal(client.calls[0].body.target_commitish, 'main')
})


test('uploadReleaseAsset rejects system paths such as /etc/passwd', async () => {
  const client = clientDouble([])
  await assert.rejects(
    () => uploadReleaseAsset(client, { owner: 'o', repo: 'r', tag: 'v0.1.0', filePath: '/etc/passwd' }),
    /access to system directory "\/etc" is not allowed/,
  )
})

test('uploadReleaseAsset rejects paths with control characters', async () => {
  const client = clientDouble([])
  await assert.rejects(
    () => uploadReleaseAsset(client, { owner: 'o', repo: 'r', tag: 'v0.1.0', filePath: 'test\0file.txt' }),
    /filePath may not contain control characters/,
  )
})

test('uploadReleaseAsset rejects paths escaping workspace directory when cwd is set', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-release-cwd-'))
  const outsideFile = path.join(os.tmpdir(), 'dsh-outside-asset.txt')
  await fs.writeFile(outsideFile, 'secret outside')
  try {
    const client = clientDouble([])
    await assert.rejects(
      () => uploadReleaseAsset(client, {
        owner: 'o', repo: 'r', tag: 'v0.1.0',
        filePath: '../dsh-outside-asset.txt',
        cwd: tmpDir,
      }),
      /filePath must reside within the workspace directory/,
    )
  } finally {
    await fs.unlink(outsideFile).catch(() => {})
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
})

test('uploadReleaseAsset succeeds for files within workspace directory when cwd is set', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-release-cwd-'))
  const insideFile = path.join(tmpDir, 'valid-asset.txt')
  await fs.writeFile(insideFile, 'hello safe asset')
  try {
    const client = {
      ...clientDouble([['/repos/o/r/releases/tags/', release]]),
      baseUrl: 'https://api.github.com',
      call: async () => ({
        data: { id: 303, name: 'valid-asset.txt', size: 16, browser_download_url: 'https://x/valid-asset.txt' },
      }),
    }
    const uploaded = await uploadReleaseAsset(client, {
      owner: 'o', repo: 'r', tag: 'v0.1.0',
      filePath: 'valid-asset.txt',
      cwd: tmpDir,
    })
    assert.equal(uploaded.id, 303)
    assert.equal(uploaded.name, 'valid-asset.txt')
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
})
