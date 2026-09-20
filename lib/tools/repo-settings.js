// Repository settings: actions variables, actions secrets, rulesets and classic
// branch protection.
//
// Secrets need the sealed-box encryption GitHub requires, which is not part of Node's
// crypto. The optional `tweetnacl` package is used when it is installed; without it the
// tool says exactly what is missing instead of writing a broken value.

function ensureRepo({ owner, repo }) {
  if (!owner || !repo) {
    throw new Error('owner and repo are required (pass "repository": "owner/repo" or set defaults in settings)')
  }
}

// ------------------------------------------------------------------- variables

export async function listVariables(client, { owner, repo, environment }) {
  ensureRepo({ owner, repo })
  const path = environment
    ? `/repos/${owner}/${repo}/environments/${environment}/variables`
    : `/repos/${owner}/${repo}/actions/variables`
  const { data } = await client.get(path, { query: { per_page: 100 } })
  return { variables: ((data && data.variables) || []).map((v) => ({ name: v.name, value: v.value })) }
}

export async function setVariable(client, { owner, repo, name, value, environment }) {
  ensureRepo({ owner, repo })
  if (!name) throw new Error('name is required')
  const listPath = environment
    ? `/repos/${owner}/${repo}/environments/${environment}/variables`
    : `/repos/${owner}/${repo}/actions/variables`
  const existing = await listVariables(client, { owner, repo, environment })
  const known = existing.variables.some((v) => v.name === name)
  const payload = { name, value: String(value ?? '') }
  if (known) {
    await client.patch(`${listPath}/${name}`, payload)
    return { updated: true, name }
  }
  await client.post(listPath, payload)
  return { created: true, name }
}

export async function deleteVariable(client, { owner, repo, name, environment }) {
  ensureRepo({ owner, repo })
  if (!name) throw new Error('name is required')
  const path = environment
    ? `/repos/${owner}/${repo}/environments/${environment}/variables/${name}`
    : `/repos/${owner}/${repo}/actions/variables/${name}`
  await client.del(path)
  return { deleted: true, name }
}

// ---------------------------------------------------------------------- secrets

export async function listSecrets(client, { owner, repo, environment }) {
  ensureRepo({ owner, repo })
  const path = environment
    ? `/repos/${owner}/${repo}/environments/${environment}/secrets`
    : `/repos/${owner}/${repo}/actions/secrets`
  const { data } = await client.get(path, { query: { per_page: 100 } })
  return {
    secrets: ((data && data.secrets) || []).map((s) => ({ name: s.name, updatedAt: s.updated_at })),
    note: 'Values are never returned by GitHub.',
  }
}

export async function deleteSecret(client, { owner, repo, name, environment }) {
  ensureRepo({ owner, repo })
  if (!name) throw new Error('name is required')
  const path = environment
    ? `/repos/${owner}/${repo}/environments/${environment}/secrets/${name}`
    : `/repos/${owner}/${repo}/actions/secrets/${name}`
  await client.del(path)
  return { deleted: true, name }
}

/** Sealed-box encryption, performed only when the optional dependency is present. */
export async function encryptSecretValue(value, publicKeyBase64) {
  let nacl
  try {
    nacl = await import('tweetnacl')
  } catch {
    throw new Error(
      'setting a secret needs the optional "tweetnacl" package for GitHub sealed-box encryption: '
      + 'install it next to the plugin, or set the value through the GitHub UI and use gh_secret_list to verify it',
    )
  }
  const lib = nacl && nacl.default ? nacl.default : nacl
  const box = lib && lib.box
  if (!box || typeof box.seal !== 'function') {
    throw new Error('the installed "tweetnacl" package does not expose box.seal')
  }
  const publicKey = Buffer.from(publicKeyBase64, 'base64')
  const message = Buffer.from(String(value), 'utf8')
  return Buffer.from(box.seal(message, publicKey)).toString('base64')
}

export async function setSecret(client, { owner, repo, name, value, environment }) {
  ensureRepo({ owner, repo })
  if (!name) throw new Error('name is required')
  if (value === undefined || value === null) throw new Error('value is required')
  const keyPath = environment
    ? `/repos/${owner}/${repo}/environments/${environment}/secrets/public-key`
    : `/repos/${owner}/${repo}/actions/secrets/public-key`
  const { data } = await client.get(keyPath)
  if (!data || !data.key || !data.key_id) throw new Error('GitHub did not return a public key for sealed-box encryption')
  const encrypted = await encryptSecretValue(value, data.key)
  const putPath = environment
    ? `/repos/${owner}/${repo}/environments/${environment}/secrets/${name}`
    : `/repos/${owner}/${repo}/actions/secrets/${name}`
  await client.put(putPath, { encrypted_value: encrypted, key_id: data.key_id })
  return { written: true, name, keyId: data.key_id }
}

// ---------------------------------------------------------------------- rulesets

export async function listRulesets(client, { owner, repo }) {
  ensureRepo({ owner, repo })
  const { data } = await client.get(`/repos/${owner}/${repo}/rulesets`)
  return {
    rulesets: (Array.isArray(data) ? data : []).map((r) => ({
      id: r.id,
      name: r.name,
      target: r.target,
      enforcement: r.enforcement,
    })),
  }
}

export async function getRuleset(client, { owner, repo, rulesetId }) {
  ensureRepo({ owner, repo })
  if (!rulesetId) throw new Error('rulesetId is required')
  const { data } = await client.get(`/repos/${owner}/${repo}/rulesets/${rulesetId}`)
  return data
}

export async function applyRuleset(client, { owner, repo, rulesetId, name, target = 'branch', enforcement = 'active', conditions, rules }) {
  ensureRepo({ owner, repo })
  if (!name && !rulesetId) throw new Error('name is required to create a ruleset (or rulesetId to update one)')
  const payload = {
    name,
    target,
    enforcement,
    conditions: conditions || { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
    rules: rules || [],
  }
  const { data } = rulesetId
    ? await client.put(`/repos/${owner}/${repo}/rulesets/${rulesetId}`, payload)
    : await client.post(`/repos/${owner}/${repo}/rulesets`, payload)
  return { id: data && data.id, name: data && data.name, enforcement: data && data.enforcement, updated: Boolean(rulesetId) }
}

export async function deleteRuleset(client, { owner, repo, rulesetId }) {
  ensureRepo({ owner, repo })
  if (!rulesetId) throw new Error('rulesetId is required')
  await client.del(`/repos/${owner}/${repo}/rulesets/${rulesetId}`)
  return { deleted: true, rulesetId }
}

// ------------------------------------------------------------- branch protection

export async function getBranchProtection(client, { owner, repo, branch }) {
  ensureRepo({ owner, repo })
  if (!branch) throw new Error('branch is required')
  const { data } = await client.get(`/repos/${owner}/${repo}/branches/${branch}/protection`)
  return {
    branch,
    requiredReviews: data && data.required_pull_request_reviews
      ? {
        approvals: data.required_pull_request_reviews.required_approving_review_count,
        dismissStale: data.required_pull_request_reviews.dismiss_stale_reviews,
      }
      : null,
    requiredStatusChecks: data && data.required_status_checks
      ? { strict: data.required_status_checks.strict, contexts: data.required_status_checks.contexts }
      : null,
    enforceAdmins: Boolean(data && data.enforce_admins && data.enforce_admins.enabled),
    allowForcePushes: Boolean(data && data.allow_force_pushes && data.allow_force_pushes.enabled),
    allowDeletions: Boolean(data && data.allow_deletions && data.allow_deletions.enabled),
  }
}

export async function setBranchProtection(client, {
  owner, repo, branch, approvals = 0, dismissStale = true, strict = true, contexts = [],
  enforceAdmins = false, allowForcePushes = false, allowDeletions = false,
}) {
  ensureRepo({ owner, repo })
  if (!branch) throw new Error('branch is required')
  const payload = {
    required_status_checks: { strict: Boolean(strict), contexts: contexts || [] },
    enforce_admins: Boolean(enforceAdmins),
    required_pull_request_reviews: approvals
      ? { required_approving_review_count: Number(approvals), dismiss_stale_reviews: Boolean(dismissStale) }
      : null,
    restrictions: null,
    allow_force_pushes: Boolean(allowForcePushes),
    allow_deletions: Boolean(allowDeletions),
  }
  const { data } = await client.put(`/repos/${owner}/${repo}/branches/${branch}/protection`, payload)
  return { branch, applied: true, url: data && data.url }
}

export async function deleteBranchProtection(client, { owner, repo, branch }) {
  ensureRepo({ owner, repo })
  if (!branch) throw new Error('branch is required')
  await client.del(`/repos/${owner}/${repo}/branches/${branch}/protection`)
  return { deleted: true, branch }
}
