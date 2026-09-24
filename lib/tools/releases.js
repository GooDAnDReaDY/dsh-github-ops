// Release operations. Pure functions over a GitHub client: no harness imports here,
// so they are testable with a fake fetch and reusable from the tool layer.

const RELEASE_LIST_LIMIT = 30

function ensureRepo({ owner, repo }) {
  if (!owner || !repo) {
    throw new Error('owner and repo are required (pass "repository": "owner/repo" or set defaults in settings)')
  }
}

function normalizeRelease(data) {
  if (!data || typeof data !== 'object') return data
  return {
    id: data.id,
    tag: data.tag_name,
    name: data.name || data.tag_name,
    draft: Boolean(data.draft),
    prerelease: Boolean(data.prerelease),
    createdAt: data.created_at,
    publishedAt: data.published_at,
    author: data.author && data.author.login,
    url: data.html_url,
    tarball: data.tarball_url,
    zipball: data.zipball_url,
    assets: Array.isArray(data.assets)
      ? data.assets.map((a) => ({ name: a.name, size: a.size, downloads: a.download_count, url: a.browser_download_url }))
      : [],
    body: typeof data.body === 'string' ? data.body : '',
  }
}

export async function listReleases(client, { owner, repo, limit = RELEASE_LIST_LIMIT } = {}) {
  ensureRepo({ owner, repo })
  const capped = Math.max(1, Math.min(Number(limit) || RELEASE_LIST_LIMIT, 100))
  const { data, rateLimit } = await client.get(`/repos/${owner}/${repo}/releases`, {
    query: { per_page: capped },
  })
  // GitHub honours per_page for this endpoint, but a proxy or a cached page may not:
  // the caller asked for `capped` items, so the list is cut here as well.
  const releases = (Array.isArray(data) ? data.map(normalizeRelease) : []).slice(0, capped)
  return { releases, count: releases.length, rateLimit }
}

export async function getRelease(client, { owner, repo, tag }) {
  ensureRepo({ owner, repo })
  if (!tag) throw new Error('tag is required')
  const { data } = await client.get(`/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`)
  return normalizeRelease(data)
}

export async function createRelease(client, { owner, repo, tag, name, body, draft = false, prerelease = false, target, generateNotes = false }) {
  ensureRepo({ owner, repo })
  if (!tag) throw new Error('tag is required')
  const payload = {
    tag_name: tag,
    name: name || tag,
    draft: Boolean(draft),
    prerelease: Boolean(prerelease),
    generate_release_notes: Boolean(generateNotes),
  }
  if (body !== undefined) payload.body = body
  if (target) payload.target_commitish = target
  const { data } = await client.post(`/repos/${owner}/${repo}/releases`, payload)
  return normalizeRelease(data)
}

/**
 * Resolve a release id from a tag.
 *
 * The by-tag endpoint does not see draft releases — GitHub answers 404 for a draft even
 * to the token that created it — so a miss falls back to scanning the list, which does
 * include drafts for an authenticated caller.
 */
export async function resolveReleaseId(client, { owner, repo, tag, releaseId }) {
  ensureRepo({ owner, repo })
  if (releaseId) return releaseId
  if (!tag) throw new Error('tag or releaseId is required')
  try {
    const existing = await getRelease(client, { owner, repo, tag })
    if (existing && existing.id) return existing.id
  } catch (err) {
    if (!err || err.status !== 404) throw err
  }
  const { releases } = await listReleases(client, { owner, repo, limit: 100 })
  const found = releases.find((r) => r.tag === tag)
  if (found && found.id) return found.id
  throw new Error(
    `release not found for tag ${tag}. A draft release is invisible to the by-tag endpoint `
    + '(GitHub answers 404 even to its creator) and may also be missing from the list: '
    + 'pass releaseId — gh_release_create returns it — to edit or delete a draft',
  )
}

export async function editRelease(client, { owner, repo, tag, releaseId, name, body, draft, prerelease, makeLatest }) {
  ensureRepo({ owner, repo })
  const id = await resolveReleaseId(client, { owner, repo, tag, releaseId })
  const payload = {}
  if (name !== undefined) payload.name = name
  if (body !== undefined) payload.body = body
  if (draft !== undefined) payload.draft = Boolean(draft)
  if (prerelease !== undefined) payload.prerelease = Boolean(prerelease)
  if (makeLatest !== undefined) payload.make_latest = makeLatest ? 'true' : 'false'
  const { data } = await client.patch(`/repos/${owner}/${repo}/releases/${id}`, payload)
  return normalizeRelease(data)
}

export async function deleteRelease(client, { owner, repo, tag, releaseId }) {
  ensureRepo({ owner, repo })
  const id = await resolveReleaseId(client, { owner, repo, tag, releaseId })
  await client.del(`/repos/${owner}/${repo}/releases/${id}`)
  return { deleted: true, id, tag: tag || '' }
}

export function normalizeAsset(data) {
  if (!data || typeof data !== 'object') return data
  return {
    id: data.id,
    name: data.name,
    label: data.label || '',
    state: data.state || 'uploaded',
    size: Number(data.size) || 0,
    downloads: Number(data.download_count) || 0,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    browserDownloadUrl: data.browser_download_url || data.url || '',
    contentType: data.content_type || 'application/octet-stream',
  }
}

export async function listReleaseAssets(client, { owner, repo, tag, releaseId, limit = 50 } = {}) {
  ensureRepo({ owner, repo })
  const id = await resolveReleaseId(client, { owner, repo, tag, releaseId })
  const capped = Math.max(1, Math.min(Number(limit) || 50, 100))
  const { data, rateLimit } = await client.get(`/repos/${owner}/${repo}/releases/${id}/assets`, {
    query: { per_page: capped },
  })
  const assets = (Array.isArray(data) ? data.map(normalizeAsset) : []).slice(0, capped)
  return { assets, count: assets.length, releaseId: id, rateLimit }
}

export async function uploadReleaseAsset(client, { owner, repo, tag, releaseId, filePath, name, label, contentType }) {
  ensureRepo({ owner, repo })
  if (!filePath) throw new Error('filePath is required')
  const id = await resolveReleaseId(client, { owner, repo, tag, releaseId })

  const fs = await import('node:fs/promises')
  const path = await import('node:path')

  let stats
  try {
    stats = await fs.stat(filePath)
  } catch (err) {
    throw new Error(`cannot access file "${filePath}": ${err && err.message}`)
  }
  if (!stats.isFile()) throw new Error(`"${filePath}" is not a file`)

  const fileBuffer = await fs.readFile(filePath)
  const assetName = name || path.basename(filePath)
  const mimeType = contentType || 'application/octet-stream'

  const baseUrl = client.baseUrl || 'https://api.github.com'
  const uploadsBase = baseUrl.includes('api.github.com') ? 'https://uploads.github.com' : baseUrl
  const targetUrl = `${uploadsBase}/repos/${owner}/${repo}/releases/${id}/assets`

  const { data } = await client.call({
    method: 'POST',
    url: targetUrl,
    query: { name: assetName, ...(label ? { label } : {}) },
    body: fileBuffer,
    headers: {
      'content-type': mimeType,
      'content-length': String(fileBuffer.length),
    },
  })
  return normalizeAsset(data)
}

export async function deleteReleaseAsset(client, { owner, repo, assetId }) {
  ensureRepo({ owner, repo })
  if (!assetId) throw new Error('assetId is required')
  await client.del(`/repos/${owner}/${repo}/releases/assets/${assetId}`)
  return { deleted: true, assetId: Number(assetId) }
}

export async function generateReleaseNotes(client, { owner, repo, tag, target, previousTag, configFile }) {
  ensureRepo({ owner, repo })
  if (!tag) throw new Error('tag is required')
  const payload = { tag_name: tag }
  if (target) payload.target_commitish = target
  if (previousTag) payload.previous_tag_name = previousTag
  if (configFile) payload.configuration_file_path = configFile
  const { data } = await client.post(`/repos/${owner}/${repo}/releases/generate-notes`, payload)
  return {
    name: data && data.name ? data.name : tag,
    body: typeof data?.body === 'string' ? data.body : '',
    tag,
    previousTag: previousTag || '',
  }
}
