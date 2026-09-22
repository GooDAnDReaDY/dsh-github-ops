import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const client = fs.readFileSync(path.join(here, '..', 'lib', 'client.js'), 'utf8')
const host = fs.readFileSync(path.join(here, '..', 'lib', 'index.js'), 'utf8')
const routes = fs.readFileSync(path.join(here, '..', 'lib', 'routes.js'), 'utf8')

test('the pull request bar sits in the composer bar seat and hides when there is nothing to suggest', () => {
  assert.match(client, /ctx\.slots\.inject\('conversation\.composer\.bar'/)
  assert.match(client, /function PullRequestBar\(props\)/)
  assert.match(client, /ahead <= 0\) return null/, 'no bar without commits ahead of the upstream')
  assert.match(client, /payload\.ahead \|\| 0/, 'a repository without an upstream does not show one')
})

test('the bar suggests and never writes', () => {
  assert.match(client, /navigator\.clipboard\.writeText/, 'the buttons hand the human an instruction')
  const start = client.indexOf('function PullRequestBar(props)')
  const end = client.indexOf('let cssInstalled = false', start)
  const component = client.slice(start, end)
  assert.ok(!/method:\s*'POST'/i.test(component), 'the component sends nothing to the host')
  assert.ok(!/gh_release_|pr_merge\(|pr_create\(/.test(component), 'it does not call tools itself')
  assert.match(component, /call pr_create with head=/, 'the instruction names the tool and its arguments')
  assert.match(component, /call gh_review and then ci_run/)
  assert.match(component, /call pr_merge/)
})

test('both locales carry the new strings, and no Russian text is introduced', () => {
  for (const key of ['prBarCreate', 'prBarReview', 'prBarMerge', 'prBarCopied', 'prBarCopyFailed', 'scmTitle', 'scmNotRepo']) {
    const occurrences = client.split(`${key}:`).length - 1
    assert.ok(occurrences >= 2, `${key} should exist in both dictionaries, found ${occurrences}`)
  }
  assert.deepEqual(client.match(/[\u0400-\u04FF]/g) || [], [], 'no Cyrillic in the plugin')
})

test('link watching is opt-in and only records what the human clicked', () => {
  assert.match(client, /const linkState = \{ repo: '', enabled: false \}/)
  assert.match(client, /if \(!linkState\.enabled\) return/, 'off unless the setting says otherwise')
  assert.match(client, /github\\\.com\\\/\(\[\^\/\]\+\)\\\/\(\[\^\/\?#\]\+\)/, 'only github.com links are read')
  assert.match(host, /interceptLinks: Schema\.boolean\(\)\.default\(false\)/, 'off by default in the settings')
  assert.match(routes, /interceptLinks: liveConfig\(\)\.interceptLinks === true/, 'and reported to the card through the status payload')
})

test('the source control route serves reads and gated writes, and both are trusted-caller only', () => {
  const start = routes.indexOf("path: SCM_PATH")
  const end = routes.indexOf('dsh-github-ops: scm route', start)
  const route = routes.slice(start, end)
  assert.match(route, /req\.method !== 'GET' && req\.method !== 'POST'/, 'only GET and POST are served')
  assert.match(route, /if \(!isTrustedRequest\(req\)\)/)
  // a write is a named action turned into argv by the validated builder — never a shell string
  assert.match(route, /buildAction\(body\.action/)
  assert.match(route, /for \(const argv of built\.steps\)/)
  assert.match(route, /error: 'git refused the step'|ok: false, action: built\.action/)
  for (const forbidden of ['exec(', 'execSync', 'spawn(', 'execFile(']) {
    assert.ok(!route.includes(forbidden), `the scm route must not use ${forbidden}`)
  }
  assert.match(route, /readJsonBody\(req\)/, 'the body is read bounded and parsed, not executed')
})

test('the tab writes only through named actions, and the dangerous ones ask twice', () => {
  assert.match(client, /method: 'POST'/)
  assert.match(client, /body: JSON\.stringify\(repoPath \? \{ action, args: args \|\| \{\}, cwd: repoPath \} : \{ action, args: args \|\| \{\} \}\)/)
  assert.match(client, /const armed = \(key, action, args\)/, 'a destructive click arms first')
  for (const action of [
    'stage', 'unstage', 'discard', 'commit', 'push', 'sync',
    'branchCreate', 'branchCheckout', 'branchDelete',
    'stashPush', 'stashApply', 'stashPop', 'stashDrop', 'continue', 'abort',
  ]) {
    assert.ok(client.includes(`'${action}'`), `the panel should offer ${action}`)
  }
  assert.match(client, /runAction\('commit', \{ message, amend, push: true \}\)/, 'commit and push is one click')
  assert.match(client, /armed\(discardKey, 'discard'/, 'discard asks twice')
  assert.match(client, /armed\('abort'/, "aborting a merge asks twice")
  assert.match(client, /runAction\(behind > 0 \? 'sync' : 'push'/, 'a branch behind the upstream syncs')
  assert.match(client, /disabled: Boolean\(busy\)/, 'buttons are blocked while an action runs')
  assert.match(client, /scmActionFailed/, 'a refused action is reported in the panel')
})
