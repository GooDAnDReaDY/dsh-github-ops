import test from 'node:test'
import assert from 'node:assert/strict'

import {
  listRuns,
  getRun,
  listRunJobs,
  rerunRun,
  cancelRun,
  getRunLogsUrl,
} from '../lib/tools/actions.js'
import {
  listVariables,
  setVariable,
  deleteVariable,
  listSecrets,
  deleteSecret,
  setSecret,
  encryptSecretValue,
  listRulesets,
  applyRuleset,
  deleteRuleset,
  getBranchProtection,
  setBranchProtection,
  deleteBranchProtection,
} from '../lib/tools/repo-settings.js'

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
    put: async (path, body) => { calls.push({ method: 'PUT', path, body }); return { data: pick(path) } },
    patch: async (path, body) => { calls.push({ method: 'PATCH', path, body }); return { data: pick(path) } },
    del: async (path) => { calls.push({ method: 'DELETE', path }); return { data: null } },
    getRedirect: async (path) => { calls.push({ method: 'GET', path, redirect: 'manual' }); return pick(path) },
  }
}

const run = {
  id: 42,
  name: 'CI',
  display_title: 'fix: x',
  event: 'push',
  status: 'completed',
  conclusion: 'failure',
  head_branch: 'main',
  head_sha: 'abc',
  run_attempt: 1,
  html_url: 'https://github.com/o/r/actions/runs/42',
  actor: { login: 'octocat' },
}

test('listRuns normalizes the payload, filters by branch and caps the page size', async () => {
  const client = clientDouble([['/repos/o/r/actions/runs', { total_count: 1, workflow_runs: [run] }]])
  const result = await listRuns(client, { owner: 'o', repo: 'r', branch: 'main', limit: 500 })
  assert.equal(result.count, 1)
  assert.equal(result.runs[0].conclusion, 'failure')
  assert.equal(result.runs[0].branch, 'main')
  assert.equal(client.calls[0].opts.query.per_page, 100)
  assert.equal(client.calls[0].opts.query.branch, 'main')
})

test('listRuns uses the workflow route when a workflow is given', async () => {
  const client = clientDouble([['/repos/o/r/actions/workflows/ci.yml/runs', { workflow_runs: [] }]])
  await listRuns(client, { owner: 'o', repo: 'r', workflow: 'ci.yml' })
  assert.equal(client.calls[0].path, '/repos/o/r/actions/workflows/ci.yml/runs')
})

test('getRun requires an id and returns the normalized run', async () => {
  const client = clientDouble([['/repos/o/r/actions/runs/42', run]])
  const got = await getRun(client, { owner: 'o', repo: 'r', runId: 42 })
  assert.equal(got.id, 42)
  await assert.rejects(() => getRun(client, { owner: 'o', repo: 'r' }), /runId is required/)
})

test('listRunJobs surfaces only the failed steps of each job', async () => {
  const client = clientDouble([['/repos/o/r/actions/runs/42/jobs', {
    jobs: [{
      id: 1, name: 'test', status: 'completed', conclusion: 'failure', html_url: 'u',
      steps: [
        { number: 1, name: 'checkout', conclusion: 'success' },
        { number: 2, name: 'npm test', conclusion: 'failure' },
        { number: 3, name: 'upload', conclusion: 'skipped' },
      ],
    }],
  }]])
  const result = await listRunJobs(client, { owner: 'o', repo: 'r', runId: 42 })
  assert.equal(result.count, 1)
  assert.deepEqual(result.jobs[0].failedSteps, [{ number: 2, name: 'npm test', conclusion: 'failure' }])
})

test('rerunRun switches between the full and failed-only endpoints', async () => {
  const client = clientDouble([['/repos/o/r/actions/runs/42', {}]])
  await rerunRun(client, { owner: 'o', repo: 'r', runId: 42 })
  await rerunRun(client, { owner: 'o', repo: 'r', runId: 42, failedOnly: true })
  assert.equal(client.calls[0].path, '/repos/o/r/actions/runs/42/rerun')
  assert.equal(client.calls[1].path, '/repos/o/r/actions/runs/42/rerun-failed-jobs')
})

test('cancelRun posts to the cancel endpoint', async () => {
  const client = clientDouble([['/repos/o/r/actions/runs/42', {}]])
  const result = await cancelRun(client, { owner: 'o', repo: 'r', runId: 42 })
  assert.deepEqual(result, { cancelled: true, runId: 42 })
  assert.equal(client.calls[0].path, '/repos/o/r/actions/runs/42/cancel')
})

test('getRunLogsUrl returns the redirect target instead of downloading the archive', async () => {
  const client = clientDouble([['/repos/o/r/actions/runs/42/logs', { location: 'https://objects.githubusercontent.com/x.zip', status: 302 }]])
  const result = await getRunLogsUrl(client, { owner: 'o', repo: 'r', runId: 42 })
  assert.match(result.downloadUrl, /x\.zip$/)
  assert.match(result.note, /zip/)

  const missing = clientDouble([['/repos/o/r/actions/runs/9/logs', { location: null, status: 404 }]])
  const gone = await getRunLogsUrl(missing, { owner: 'o', repo: 'r', runId: 9 })
  assert.equal(gone.downloadUrl, '')
  assert.match(gone.note, /may have expired/)
})

test('listVariables and setVariable choose create or update', async () => {
  const empty = clientDouble([['/repos/o/r/actions/variables', { variables: [] }]])
  const created = await setVariable(empty, { owner: 'o', repo: 'r', name: 'A', value: '1' })
  assert.equal(created.created, true)
  assert.equal(empty.calls[1].method, 'POST')

  const existing = clientDouble([['/repos/o/r/actions/variables', { variables: [{ name: 'A', value: '1' }] }]])
  const updated = await setVariable(existing, { owner: 'o', repo: 'r', name: 'A', value: '2' })
  assert.equal(updated.updated, true)
  assert.equal(existing.calls[1].method, 'PATCH')
  assert.equal(existing.calls[1].path, '/repos/o/r/actions/variables/A')
})

test('listVariables uses the environment route when asked', async () => {
  const client = clientDouble([['/repos/o/r/environments/prod/variables', { variables: [{ name: 'X', value: 'y' }] }]])
  const result = await listVariables(client, { owner: 'o', repo: 'r', environment: 'prod' })
  assert.deepEqual(result.variables, [{ name: 'X', value: 'y' }])
})

test('deleteVariable and deleteSecret demand a name and hit the right path', async () => {
  const client = clientDouble([])
  await deleteVariable(client, { owner: 'o', repo: 'r', name: 'A' })
  await deleteSecret(client, { owner: 'o', repo: 'r', name: 'B' })
  assert.equal(client.calls[0].path, '/repos/o/r/actions/variables/A')
  assert.equal(client.calls[1].path, '/repos/o/r/actions/secrets/B')
  await assert.rejects(() => deleteVariable(client, { owner: 'o', repo: 'r' }), /name is required/)
})

test('listSecrets says that values are never returned', async () => {
  const client = clientDouble([['/repos/o/r/actions/secrets', { secrets: [{ name: 'TOKEN', updated_at: 'now' }] }]])
  const result = await listSecrets(client, { owner: 'o', repo: 'r' })
  assert.equal(result.secrets[0].name, 'TOKEN')
  assert.match(result.note, /never returned/)
})

test('setSecret explains the missing encryption dependency instead of writing a broken value', async () => {
  const client = clientDouble([
    ['/repos/o/r/actions/secrets/public-key', { key: 'a2V5', key_id: 'kid-1' }],
  ])
  const original = globalThis.__dshGithubOpsTest
  try {
    // tweetnacl is not a dependency of the plugin, so the encryption step must refuse
    // with an actionable message rather than sending an unencrypted value.
    await assert.rejects(
      () => setSecret(client, { owner: 'o', repo: 'r', name: 'N', value: 'v' }),
      /tweetnacl|sealed-box/,
    )
    assert.ok(!client.calls.some((c) => c.method === 'PUT'), 'nothing was written')
  } finally {
    globalThis.__dshGithubOpsTest = original
  }
  await assert.rejects(() => encryptSecretValue('v', 'a2V5'), /tweetnacl|sealed-box/)
})

test('listRulesets and applyRuleset cover read, create and update', async () => {
  const client = clientDouble([['/repos/o/r/rulesets', [{ id: 3, name: 'main', target: 'branch', enforcement: 'active' }]]])
  const list = await listRulesets(client, { owner: 'o', repo: 'r' })
  assert.deepEqual(list.rulesets, [{ id: 3, name: 'main', target: 'branch', enforcement: 'active' }])

  const created = await applyRuleset(client, { owner: 'o', repo: 'r', name: 'new' })
  assert.equal(created.updated, false)
  assert.equal(client.calls.at(-1).method, 'POST')
  assert.equal(client.calls.at(-1).body.conditions.ref_name.include[0], '~DEFAULT_BRANCH')

  const updated = await applyRuleset(client, { owner: 'o', repo: 'r', rulesetId: 3, name: 'main' })
  assert.equal(updated.updated, true)
  assert.equal(client.calls.at(-1).path, '/repos/o/r/rulesets/3')
})

test('deleteRuleset demands an id and a confirm flag is enforced by the tool layer', async () => {
  const client = clientDouble([])
  await deleteRuleset(client, { owner: 'o', repo: 'r', rulesetId: 3 })
  assert.equal(client.calls[0].method, 'DELETE')
  await assert.rejects(() => deleteRuleset(client, { owner: 'o', repo: 'r' }), /rulesetId is required/)
})

test('branch protection read and write map the nested GitHub shape', async () => {
  const client = clientDouble([['/repos/o/r/branches/main/protection', {
    required_pull_request_reviews: { required_approving_review_count: 1, dismiss_stale_reviews: true },
    required_status_checks: { strict: true, contexts: ['ci'] },
    enforce_admins: { enabled: true },
    allow_force_pushes: { enabled: false },
    allow_deletions: { enabled: false },
  }]])
  const protection = await getBranchProtection(client, { owner: 'o', repo: 'r', branch: 'main' })
  assert.equal(protection.requiredReviews.approvals, 1)
  assert.deepEqual(protection.requiredStatusChecks.contexts, ['ci'])
  assert.equal(protection.enforceAdmins, true)

  const write = clientDouble([])
  await setBranchProtection(write, { owner: 'o', repo: 'r', branch: 'main', approvals: 2, contexts: ['ci'] })
  const body = write.calls[0].body
  assert.equal(body.required_pull_request_reviews.required_approving_review_count, 2)
  assert.deepEqual(body.required_status_checks, { strict: true, contexts: ['ci'] })
  assert.equal(body.enforce_admins, false)
})

test('setBranchProtection without approvals disables the review requirement', async () => {
  const client = clientDouble([])
  await setBranchProtection(client, { owner: 'o', repo: 'r', branch: 'main', approvals: 0 })
  assert.equal(client.calls[0].body.required_pull_request_reviews, null)
})

test('deleteBranchProtection requires a branch and deletes the protection object', async () => {
  const client = clientDouble([])
  await deleteBranchProtection(client, { owner: 'o', repo: 'r', branch: 'main' })
  assert.equal(client.calls[0].path, '/repos/o/r/branches/main/protection')
  await assert.rejects(() => deleteBranchProtection(client, { owner: 'o', repo: 'r' }), /branch is required/)
})
