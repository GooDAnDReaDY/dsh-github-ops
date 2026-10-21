import test from 'node:test'
import assert from 'node:assert/strict'

import {
  listSecurityAlerts,
  getDependabotAlert,
  normalizeDependabotAlert,
  normalizeSecretAlert,
  normalizeCodeScanningAlert,
} from '../lib/tools/security.js'
import { repoReport, repoHealth, healthOf } from '../lib/tools/insights.js'
import { registerRoutes, PANEL_PATH } from '../lib/routes.js'

function clientDouble(routes) {
  const calls = []
  return {
    calls,
    get: async (path, opts) => {
      calls.push({ method: 'GET', path, opts })
      for (const [pattern, handler] of routes) {
        if (typeof pattern === 'string' ? path.startsWith(pattern) : pattern.test(path)) {
          if (typeof handler === 'function') return handler(path, opts)
          return { data: handler }
        }
      }
      return { data: null }
    },
    getRaw: async (path) => {
      calls.push({ method: 'GET_RAW', path })
      return ''
    },
  }
}

test('listSecurityAlerts queries Dependabot, Secret Scanning, and CodeQL and normalizes alerts', async () => {
  const client = clientDouble([
    ['/repos/owner/repo/dependabot/alerts', [
      {
        number: 101,
        state: 'open',
        dependency: {
          package: { name: 'minimist', ecosystem: 'npm' },
          manifest_path: 'package.json',
          scope: 'runtime',
        },
        security_advisory: {
          ghsa_id: 'GHSA-xvch-5ox4-9948',
          cve_id: 'CVE-2020-7598',
          summary: 'Prototype pollution in minimist with token ghp_11112222333344445555666677778888',
          severity: 'high',
          cvss: { score: 7.5 },
        },
        security_vulnerability: {
          first_patched_version: { identifier: '1.2.6' },
        },
        html_url: 'https://github.com/owner/repo/security/dependabot/101',
        created_at: '2026-01-01T00:00:00Z',
      },
    ]],
    ['/repos/owner/repo/secret-scanning/alerts', [
      {
        number: 1,
        secret_type: 'github_personal_access_token',
        secret_type_display_name: 'GitHub Personal Access Token',
        state: 'open',
        html_url: 'https://github.com/owner/repo/security/secret-scanning/1',
        created_at: '2026-01-02T00:00:00Z',
      },
    ]],
    ['/repos/owner/repo/code-scanning/alerts', [
      {
        number: 5,
        rule: { id: 'js/sql-injection', security_severity_level: 'critical', description: 'SQL Injection' },
        most_recent_instance: {
          location: { path: 'server.js', start_line: 42 },
          message: { text: 'Untrusted input in query with Bearer gho_99998888777766665555444433332222' },
        },
        state: 'open',
        html_url: 'https://github.com/owner/repo/security/code-scanning/5',
        created_at: '2026-01-03T00:00:00Z',
      },
    ]],
  ])

  const res = await listSecurityAlerts(client, { owner: 'owner', repo: 'repo' })
  assert.equal(res.owner, 'owner')
  assert.equal(res.repo, 'repo')
  assert.equal(res.totalCount, 3)
  assert.equal(res.criticalCount, 2) // 1 secret scanning (open = critical) + 1 critical code scanning
  assert.equal(res.highCount, 1) // 1 dependabot high
  assert.equal(res.dependabot.enabled, true)
  assert.equal(res.dependabot.count, 1)
  assert.equal(res.dependabot.alerts[0].dependency.packageName, 'minimist')
  assert.equal(res.dependabot.alerts[0].fixedIn, '1.2.6')
  // Secrets masked
  assert.ok(!res.dependabot.alerts[0].advisory.summary.includes('ghp_11112222333344445555666677778888'))
  assert.ok(res.dependabot.alerts[0].advisory.summary.includes('[REDACTED_TOKEN]'))

  assert.equal(res.secretScanning.enabled, true)
  assert.equal(res.secretScanning.count, 1)
  assert.equal(res.secretScanning.alerts[0].secretType, 'github_personal_access_token')

  assert.equal(res.codeScanning.enabled, true)
  assert.equal(res.codeScanning.count, 1)
  assert.equal(res.codeScanning.alerts[0].ruleId, 'js/sql-injection')
  assert.ok(!res.codeScanning.alerts[0].message.includes('gho_99998888777766665555444433332222'))
  assert.ok(res.codeScanning.alerts[0].message.includes('[REDACTED_TOKEN]'))
})

test('listSecurityAlerts degrades gracefully on 404 (disabled) or 403 (unauthorized)', async () => {
  const client = clientDouble([
    ['/repos/owner/repo/dependabot/alerts', () => {
      const err = new Error('Not Found')
      err.status = 404
      throw err
    }],
    ['/repos/owner/repo/secret-scanning/alerts', () => {
      const err = new Error('Forbidden')
      err.status = 403
      throw err
    }],
    ['/repos/owner/repo/code-scanning/alerts', [
      {
        number: 1,
        rule: { id: 'js/xss', severity: 'medium' },
        state: 'open',
      },
    ]],
  ])

  const res = await listSecurityAlerts(client, { owner: 'owner', repo: 'repo' })
  assert.equal(res.dependabot.enabled, false)
  assert.ok(res.dependabot.reason.includes('HTTP 404'))
  assert.deepEqual(res.dependabot.alerts, [])

  assert.equal(res.secretScanning.enabled, false)
  assert.ok(res.secretScanning.reason.includes('HTTP 403'))
  assert.deepEqual(res.secretScanning.alerts, [])

  assert.equal(res.codeScanning.enabled, true)
  assert.equal(res.codeScanning.count, 1)
  assert.equal(res.totalCount, 1)
  assert.equal(res.mediumCount, 1)
})

test('getDependabotAlert returns alert details with secret redaction and error on missing alertNumber', async () => {
  const client = clientDouble([
    ['/repos/owner/repo/dependabot/alerts/42', {
      number: 42,
      state: 'open',
      dependency: { package: { name: 'tar', ecosystem: 'npm' }, manifest_path: 'package.json' },
      security_advisory: {
        ghsa_id: 'GHSA-tar-vuln',
        cve_id: 'CVE-2021-32803',
        summary: 'Arbitrary File Overwrite',
        description: 'Vulnerability exploit uses secret token ghs_999998888877777666665555544444',
        severity: 'high',
        cvss: { score: 8.1 },
        references: [{ url: 'https://nvd.nist.gov/vuln/detail/CVE-2021-32803' }],
      },
      security_vulnerability: {
        first_patched_version: { identifier: '6.1.9' },
      },
      html_url: 'https://github.com/owner/repo/security/dependabot/42',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
    }],
  ])

  await assert.rejects(
    () => getDependabotAlert(client, { owner: 'owner', repo: 'repo' }),
    /alertNumber is required/,
  )

  const alert = await getDependabotAlert(client, { owner: 'owner', repo: 'repo', alertNumber: 42 })
  assert.equal(alert.number, 42)
  assert.equal(alert.dependency.packageName, 'tar')
  assert.equal(alert.advisory.ghsaId, 'GHSA-tar-vuln')
  assert.equal(alert.fixedIn, '6.1.9')
  assert.ok(!alert.advisory.description.includes('ghs_999998888877777666665555544444'))
  assert.ok(alert.advisory.description.includes('[REDACTED_TOKEN]'))
})

test('repoReport and repoHealth integrate security summary and detect critical alert risks', async () => {
  const client = clientDouble([
    ['/repos/owner/repo/dependabot/alerts', [
      {
        number: 1,
        state: 'open',
        security_advisory: { severity: 'critical', summary: 'RCE in lib' },
      },
    ]],
    ['/repos/owner/repo/secret-scanning/alerts', []],
    ['/repos/owner/repo/code-scanning/alerts', []],
    ['/repos/owner/repo/releases', []],
    ['/repos/owner/repo/issues', []],
    ['/repos/owner/repo/commits', [{ sha: '1234567890', commit: { message: 'init', author: { name: 'test' } } }]],
    ['/repos/owner/repo/contributors', []],
    ['/repos/owner/repo', { full_name: 'owner/repo', default_branch: 'main', stargazers_count: 5 }],
  ])

  const report = await repoReport(client, { owner: 'owner', repo: 'repo' })
  assert.ok(report.security)
  assert.equal(report.security.totalCount, 1)
  assert.equal(report.security.criticalCount, 1)

  const health = await repoHealth(client, { owner: 'owner', repo: 'repo' })
  assert.ok(health.risks.some((r) => r.includes('critical security alert(s) detected')))
  assert.ok(health.nextActions.includes('resolve critical security alerts'))
})

test('PANEL_PATH what=security handles security overview query', async () => {
  const routes = new Map()
  const wctx = {
    webServer: { register: (opts) => routes.set(opts.path, opts.handler) },
    effect: (fn) => fn(),
  }
  const ctx = {
    inject: (deps, fn) => { if (deps.includes('webServer')) fn(wctx) },
    logger: { warn: () => {} },
  }

  const client = clientDouble([
    ['/repos/owner/repo/dependabot/alerts', [{ number: 1, state: 'open', security_advisory: { severity: 'high' } }]],
    ['/repos/owner/repo/secret-scanning/alerts', []],
    ['/repos/owner/repo/code-scanning/alerts', []],
  ])

  registerRoutes(ctx, {
    resolveToken: async () => ({ value: 'ghp_token', source: 'test' }),
    client: async () => client,
    liveConfig: () => ({ owner: 'owner', repo: 'repo' }),
  })

  let status = null
  let body = ''
  const res = {
    writeHead: (s) => { status = s },
    end: (d) => { body = d || '' },
  }

  await routes.get(PANEL_PATH)({
    method: 'GET',
    url: `${PANEL_PATH}?what=security&repo=owner/repo`,
    socket: { remoteAddress: '127.0.0.1' },
    headers: {},
  }, res)

  assert.equal(status, 200)
  const json = JSON.parse(body)
  assert.equal(json.configured, true)
  assert.equal(json.totalCount, 1)
  assert.equal(json.highCount, 1)
})