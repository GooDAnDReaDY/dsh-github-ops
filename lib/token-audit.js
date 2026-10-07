// Token scopes audit and capability diagnostics.
// Compares GitHub x-oauth-scopes against features of dsh-github-ops.

export const CAPABILITY_REQUIREMENTS = [
  {
    capability: 'Repositories & Code (Private)',
    requiredAny: ['repo'],
    impact: 'Access to private repositories, code pushes, branches, releases, issues and PRs',
  },
  {
    capability: 'Repositories & Code (Public)',
    requiredAny: ['repo', 'public_repo'],
    impact: 'Access to public repository code, issues, releases and PRs',
  },
  {
    capability: 'Workflows & CI Runs',
    requiredAny: ['workflow'],
    impact: 'Triggering workflow runs, cancelling runs and updating .github/workflows',
  },
  {
    capability: 'GitHub Packages',
    requiredAny: ['write:packages', 'read:packages'],
    impact: 'Publishing and downloading package bundles from ghcr.io / npm.pkg.github.com',
  },
  {
    capability: 'Organization & Teams',
    requiredAny: ['read:org', 'admin:org'],
    impact: 'Listing organization repositories, teams and membership',
  },
]

export function auditTokenScopes(rawScopes) {
  const scopesStr = typeof rawScopes === 'string' ? rawScopes.trim() : ''
  if (!scopesStr) {
    return {
      scopes: [],
      raw: '',
      isFineGrained: true,
      capabilities: [],
      missing: [],
      warnings: ['Token does not report OAuth scopes (typical for fine-grained Personal Access Tokens or GitHub Apps). Permissions are scoped per-repository.'],
      hasFullRepoAccess: false,
      hasWorkflowAccess: false,
    }
  }

  const scopeList = scopesStr.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  const scopeSet = new Set(scopeList)

  const capabilities = []
  const missing = []
  const warnings = []

  for (const item of CAPABILITY_REQUIREMENTS) {
    const granted = item.requiredAny.some((s) => scopeSet.has(s))
    capabilities.push({
      capability: item.capability,
      granted,
      requiredAny: item.requiredAny,
    })
    if (!granted) {
      missing.push({
        capability: item.capability,
        requiredAny: item.requiredAny,
        impact: item.impact,
      })
      warnings.push(`Missing scope [${item.requiredAny.join(' or ')}] for ${item.capability}: ${item.impact}`)
    }
  }

  const hasFullRepoAccess = scopeSet.has('repo')
  const hasWorkflowAccess = scopeSet.has('workflow')

  return {
    scopes: scopeList,
    raw: scopesStr,
    isFineGrained: false,
    capabilities,
    missing,
    warnings,
    hasFullRepoAccess,
    hasWorkflowAccess,
  }
}
