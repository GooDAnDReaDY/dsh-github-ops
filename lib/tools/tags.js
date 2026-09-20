// Tag (git ref) operations. Tags are refs under refs/tags; creating an annotated
// tag needs a tag object first, a lightweight tag is a plain ref.

function ensureRepo({ owner, repo }) {
  if (!owner || !repo) {
    throw new Error('owner and repo are required (pass "repository": "owner/repo" or set defaults in settings)')
  }
}

export async function listTags(client, { owner, repo, limit = 100 } = {}) {
  ensureRepo({ owner, repo })
  const capped = Math.max(1, Math.min(Number(limit) || 100, 100))
  const refs = await client.paginate(`/repos/${owner}/${repo}/git/refs/tags`, {
    pageSize: Math.min(capped, 100),
    maxItems: capped,
  })
  const tags = refs.map((ref) => ({
    name: String(ref.ref || '').replace('refs/tags/', ''),
    sha: ref.object && ref.object.sha,
    type: ref.object && ref.object.type,
  }))
  return { tags, count: tags.length }
}

export async function getTag(client, { owner, repo, tag }) {
  ensureRepo({ owner, repo })
  if (!tag) throw new Error('tag is required')
  const { data } = await client.get(`/repos/${owner}/${repo}/git/ref/tags/${encodeURIComponent(tag)}`)
  return { name: tag, sha: data && data.object && data.object.sha, type: data && data.object && data.object.type }
}

/**
 * Create a tag. With `message` the tag is annotated: GitHub needs a tag object,
 * so the tag object is created first and the ref points at it.
 */
export async function createTag(client, { owner, repo, tag, sha, message }) {
  ensureRepo({ owner, repo })
  if (!tag) throw new Error('tag is required')
  let target = sha
  if (!target) {
    const { data } = await client.get(`/repos/${owner}/${repo}/commits/HEAD`)
    target = data && data.sha
    if (!target) throw new Error('cannot resolve HEAD to tag')
  }
  let refTarget = target
  if (message) {
    const { data: tagObject } = await client.post(`/repos/${owner}/${repo}/git/tags`, {
      tag,
      message,
      object: target,
      type: 'commit',
    })
    refTarget = tagObject && tagObject.sha
    if (!refTarget) throw new Error('cannot create annotated tag object')
  }
  const { data } = await client.post(`/repos/${owner}/${repo}/git/refs`, {
    ref: `refs/tags/${tag}`,
    sha: refTarget,
  })
  return { name: tag, sha: refTarget, target, annotated: Boolean(message), url: data && data.url }
}

export async function deleteTag(client, { owner, repo, tag }) {
  ensureRepo({ owner, repo })
  if (!tag) throw new Error('tag is required')
  await client.del(`/repos/${owner}/${repo}/git/refs/tags/${encodeURIComponent(tag)}`)
  return { deleted: true, tag }
}
