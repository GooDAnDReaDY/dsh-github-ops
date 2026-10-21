// GitHub Security Alerts: Dependabot, Secret Scanning, and CodeQL (Code Scanning).
//
// These endpoints return 404 or 403 if the repository does not have the feature enabled
// or if the token lacks the security_events / repo scope. The tools degrade gracefully
// with { enabled: false, reason: "..." } instead of failing the caller.

function ensureRepo({ owner, repo }) {
  if (!owner || !repo) {
    throw new Error('owner and repo are required (pass "repository": "owner/repo" or set defaults in settings)')
  }
}

function redactSecrets(text) {
  if (typeof text !== 'string') return text
  return text
    .replace(/(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}/g, '[REDACTED_TOKEN]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED_TOKEN]')
}

async function safeAlertCall(client, path, query, featureName) {
  try {
    const { data } = await client.get(path, { query })
    return { enabled: true, data: Array.isArray(data) ? data : [] }
  } catch (err) {
    const status = err && err.status
    if (status === 404 || status === 403) {
      return {
        enabled: false,
        reason: `${featureName} is not enabled or token lacks required security scope (HTTP ${status})`,
        data: [],
      }
    }
    throw err
  }
}

export function normalizeDependabotAlert(item) {
  if (!item || typeof item !== 'object') return item
  const adv = item.security_advisory || {}
  const dep = item.dependency || {}
  const pkg = dep.package || {}
  const vuln = item.security_vulnerability || {}
  return {
    number: item.number,
    state: item.state,
    dependency: {
      packageName: pkg.name || '',
      ecosystem: pkg.ecosystem || '',
      manifestPath: dep.manifest_path || '',
      scope: dep.scope || '',
    },
    advisory: {
      ghsaId: adv.ghsa_id || '',
      cveId: adv.cve_id || '',
      summary: redactSecrets(adv.summary || ''),
      severity: adv.severity || '',
      cvssScore: (adv.cvss && adv.cvss.score) ?? null,
    },
    fixedIn: (vuln.first_patched_version && vuln.first_patched_version.identifier) || null,
    url: item.html_url || '',
    createdAt: item.created_at || '',
  }
}

export function normalizeSecretAlert(item) {
  if (!item || typeof item !== 'object') return item
  return {
    number: item.number,
    secretType: item.secret_type || '',
    secretTypeDisplayName: item.secret_type_display_name || item.secret_type || '',
    state: item.state || '',
    resolution: item.resolution || null,
    url: item.html_url || '',
    createdAt: item.created_at || '',
  }
}

export function normalizeCodeScanningAlert(item) {
  if (!item || typeof item !== 'object') return item
  const rule = item.rule || {}
  const inst = item.most_recent_instance || {}
  const loc = inst.location || {}
  return {
    number: item.number,
    ruleId: rule.id || '',
    ruleSeverity: rule.security_severity_level || rule.severity || '',
    ruleDescription: rule.description || '',
    state: item.state || '',
    message: redactSecrets((inst.message && inst.message.text) || ''),
    path: loc.path || '',
    startLine: loc.start_line ?? null,
    url: item.html_url || '',
    createdAt: item.created_at || '',
  }
}

/**
 * List security alerts across Dependabot, Secret Scanning, and CodeQL.
 * Gracefully degrades if any feature is disabled or permissions are missing.
 */
export async function listSecurityAlerts(client, { owner, repo, state = 'open', severity, limit = 30 } = {}) {
  ensureRepo({ owner, repo })
  const perPage = Math.max(1, Math.min(Number(limit) || 30, 100))

  const depQuery = { per_page: perPage }
  if (state && state !== 'all') depQuery.state = state
  if (severity) depQuery.severity = severity

  const secQuery = { per_page: perPage }
  if (state && state !== 'all') secQuery.state = state === 'fixed' || state === 'dismissed' ? 'resolved' : state

  const codeQuery = { per_page: perPage }
  if (state && state !== 'all') codeQuery.state = state
  if (severity) codeQuery.severity = severity

  const [depRes, secRes, codeRes] = await Promise.all([
    safeAlertCall(client, `/repos/${owner}/${repo}/dependabot/alerts`, depQuery, 'Dependabot'),
    safeAlertCall(client, `/repos/${owner}/${repo}/secret-scanning/alerts`, secQuery, 'Secret Scanning'),
    safeAlertCall(client, `/repos/${owner}/${repo}/code-scanning/alerts`, codeQuery, 'Code Scanning'),
  ])

  const dependabotAlerts = depRes.data.map(normalizeDependabotAlert)
  const secretAlerts = secRes.data.map(normalizeSecretAlert)
  const codeAlerts = codeRes.data.map(normalizeCodeScanningAlert)

  let criticalCount = 0
  let highCount = 0
  let mediumCount = 0
  let lowCount = 0

  for (const a of dependabotAlerts) {
    const s = String(a.advisory?.severity || '').toLowerCase()
    if (s === 'critical') criticalCount++
    else if (s === 'high') highCount++
    else if (s === 'medium') mediumCount++
    else if (s === 'low') lowCount++
  }

  for (const a of codeAlerts) {
    const s = String(a.ruleSeverity || '').toLowerCase()
    if (s === 'critical') criticalCount++
    else if (s === 'high' || s === 'error') highCount++
    else if (s === 'medium' || s === 'warning') mediumCount++
    else if (s === 'low' || s === 'note') lowCount++
  }

  for (const a of secretAlerts) {
    if (a.state === 'open') criticalCount++
  }

  const totalCount = dependabotAlerts.length + secretAlerts.length + codeAlerts.length

  return {
    owner,
    repo,
    totalCount,
    criticalCount,
    highCount,
    mediumCount,
    lowCount,
    dependabot: {
      enabled: depRes.enabled,
      reason: depRes.reason,
      count: dependabotAlerts.length,
      alerts: dependabotAlerts,
    },
    secretScanning: {
      enabled: secRes.enabled,
      reason: secRes.reason,
      count: secretAlerts.length,
      alerts: secretAlerts,
    },
    codeScanning: {
      enabled: codeRes.enabled,
      reason: codeRes.reason,
      count: codeAlerts.length,
      alerts: codeAlerts,
    },
  }
}

/**
 * Get details for a single Dependabot alert.
 */
export async function getDependabotAlert(client, { owner, repo, alertNumber }) {
  ensureRepo({ owner, repo })
  if (!alertNumber) throw new Error('alertNumber is required')
  const num = Number(alertNumber)
  const { data } = await client.get(`/repos/${owner}/${repo}/dependabot/alerts/${num}`)
  const norm = normalizeDependabotAlert(data)
  const adv = (data && data.security_advisory) || {}
  return {
    ...norm,
    advisory: {
      ...norm.advisory,
      description: redactSecrets(adv.description || ''),
      references: (adv.references || []).map((r) => r.url || r),
    },
    updatedAt: data.updated_at || '',
    dismissedAt: data.dismissed_at || '',
    dismissReason: data.dismiss_reason || '',
    fixedAt: data.fixed_at || '',
  }
}