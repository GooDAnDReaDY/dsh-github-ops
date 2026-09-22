import test from 'node:test'
import assert from 'node:assert/strict'

import { createRecords, startReviewJob, describeRecord, REVIEW_JOB_KIND } from '../lib/jobs.js'
import {
  buildPrInstruction,
  buildReviewInstruction,
  buildIssueInstruction,
  buildGhInstruction,
  registerCommands,
  USAGE,
} from '../lib/commands.js'

// ------------------------------------------------------------------------ jobs

const okRun = async (client, { number }) => ({ verdict: 'success', number, summary: 'all good' })

test('a job runs on the host registry when there is one and records its outcome', async () => {
  const started = []
  const registry = { start: (spec) => { started.push(spec); return `${spec.kind}-1` } }
  const records = createRecords()
  const id = startReviewJob({
    registry, records, repo: 'o/r', pr: 5, owner: 'agent', client: {}, ciRun: okRun,
  })
  assert.equal(id, `${REVIEW_JOB_KIND}-1`)
  assert.equal(started.length, 1)
  assert.equal(started[0].kind, REVIEW_JOB_KIND)
  assert.equal(started[0].owner, 'agent')
  assert.equal(typeof started[0].run, 'function')
  assert.deepEqual(Object.keys(records.get(id)).includes('report'), true)

  const report = await started[0].run()
  assert.equal(report.verdict, 'success')
  const record = records.get(id)
  assert.equal(record.status, 'done')
  assert.equal(record.report.number, 5)
  assert.match(describeRecord(record), /success: review of o\/r#5/)
})

test('without a host registry the job still runs, in this plugin', async () => {
  const records = createRecords()
  const id = startReviewJob({ registry: null, records, repo: 'o/r', pr: 6, client: {}, ciRun: okRun })
  assert.match(id, /^local-/)
  // allow the background promise to settle
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(records.get(id).status, 'done')
})

test('a failing job is recorded as failed with the reason', async () => {
  const specs = []
  const registry = { start: (spec) => { specs.push(spec); return 'github-review-2' } }
  const records = createRecords()
  const id = startReviewJob({
    registry, records, repo: 'o/r', pr: 7, client: {}, ciRun: async () => { throw new Error('HTTP 404: Not Found') },
  })
  await assert.rejects(() => specs[0].run(), /404/)
  const record = records.get(id)
  assert.equal(record.status, 'failed')
  assert.match(record.error, /404/)
  assert.match(describeRecord(record), /failed: review of o\/r#7/)
})

test('records are bounded and unknown ids are reported as such', () => {
  const records = createRecords({ limit: 3 })
  for (let i = 1; i <= 5; i += 1) records.remember(`github-review-${i}`, { status: 'running', repo: 'o/r', pr: i })
  assert.equal(records.size, 3)
  assert.equal(records.get('github-review-1'), null)
  assert.equal(records.list().length, 3)
  assert.equal(describeRecord(null), 'unknown job')
})

test('a malformed repository is refused before anything starts', () => {
  const records = createRecords()
  assert.throws(() => startReviewJob({ registry: null, records, repo: 'nope', pr: 1, client: {}, ciRun: okRun }), /owner\/repo/)
})

// -------------------------------------------------------------------- commands

function commandDouble() {
  const registered = []
  return {
    registered,
    register(definition) {
      registered.push(definition)
      return () => {}
    },
  }
}

test('instruction builders say what to call and with which arguments', () => {
  const pr = buildPrInstruction({ title: 'fix: x', branch: 'feat/x', base: 'main', repo: 'o/r' })
  assert.match(pr, /pr_create with head=feat\/x, base=main in o\/r, title="fix: x"/)
  assert.match(pr, /not pushed yet/)

  const review = buildReviewInstruction({ number: 9, repo: 'o/r' })
  assert.match(review, /gh_review/)
  assert.match(review, /pull request #9 in o\/r/)
  assert.match(buildReviewInstruction({ branch: 'feat/x' }), /the pull request for feat\/x/)

  assert.match(buildIssueInstruction({ sub: 'new', title: 'Bug', repo: 'o/r' }), /issue_open in o\/r/)
  assert.match(buildIssueInstruction({ sub: 'show', number: 4 }), /action "get" and number 4/)
  assert.match(buildIssueInstruction({ sub: 'list' }), /action "list"/)

  assert.match(buildGhInstruction({ topic: 'mirror' }), /gh_mirror_check/)
  assert.match(buildGhInstruction({ tool: 'gh_tag_list' }), /Call the gh_tag_list tool/)
  assert.match(buildGhInstruction({}), /Available groups:/)
})

test('commands register four families and never touch GitHub', async () => {
  const commands = commandDouble()
  const readGitState = async () => ({ branch: 'feat/1-x', repo: 'o/r', remoteUrl: 'git@github.com:o/r.git' })
  registerCommands(commands, { readGitState })
  assert.deepEqual(commands.registered.map((c) => c.name), ['pr', 'review', 'issue', 'gh'])
  for (const definition of commands.registered) {
    assert.equal(typeof definition.handler, 'function')
    assert.ok(definition.input.hint.length > 0)
    assert.ok(definition.description.length > 0)
  }

  const pr = commands.registered.find((c) => c.name === 'pr')
  const created = await pr.handler({ rawInput: 'create fix the thing' })
  assert.equal(created.kind, 'success')
  assert.match(created.text, /pr_create/)
  assert.match(created.text, /feat\/1-x/)
  assert.match(created.text, /fix the thing/)

  const bad = await pr.handler({ rawInput: 'delete everything' })
  assert.equal(bad.kind, 'error')
  assert.equal(bad.text, USAGE.pr)
})

test('command handlers survive a checkout that cannot be read', async () => {
  const commands = commandDouble()
  registerCommands(commands, { readGitState: async () => { throw new Error('not a git checkout') } })
  const review = commands.registered.find((c) => c.name === 'review')
  const result = await review.handler({ rawInput: '' })
  assert.equal(result.kind, 'success')
  assert.match(result.text, /gh_review/)
})

test('the issue command routes its subcommands and refuses nonsense', async () => {
  const commands = commandDouble()
  registerCommands(commands, { readGitState: async () => ({ repo: 'o/r' }) })
  const issue = commands.registered.find((c) => c.name === 'issue')
  assert.match((await issue.handler({ rawInput: 'new Something broke' })).text, /issue_open in o\/r/)
  assert.match((await issue.handler({ rawInput: 'show 12' })).text, /number 12/)
  assert.match((await issue.handler({ rawInput: 'list' })).text, /action "list"/)
  assert.match((await issue.handler({ rawInput: '' })).text, /action "list"/)
  assert.equal((await issue.handler({ rawInput: 'destroy' })).kind, 'error')
})

test('the /gh command explains a group or names a tool', async () => {
  const commands = commandDouble()
  registerCommands(commands, {})
  const gh = commands.registered.find((c) => c.name === 'gh')
  assert.match((await gh.handler({ rawInput: 'releases' })).text, /gh_release_list/)
  assert.match((await gh.handler({ rawInput: 'gh_run_logs 42' })).text, /Call the gh_run_logs tool/)
  assert.match((await gh.handler({ rawInput: '' })).text, /Available groups:/)
})

test('the disposer from registerCommands tolerates a broken child', () => {
  const commands = commandDouble()
  commands.register = () => { throw new Error('nope') }
  assert.throws(() => registerCommands(commands, {}), /nope/)

  const working = commandDouble()
  const dispose = registerCommands(working, {})
  assert.equal(typeof dispose, 'function')
  dispose()
})
