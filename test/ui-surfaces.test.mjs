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

test('the source control route is read-only and trusted-caller only', () => {
  const start = routes.indexOf("path: SCM_PATH")
  const end = routes.indexOf('dsh-github-ops: scm route', start)
  const route = routes.slice(start, end)
  assert.match(route, /if \(req\.method !== 'GET'\)/)
  assert.match(route, /if \(!isTrustedRequest\(req\)\)/)
  // the route only reads: none of the git write verbs may appear in it
  for (const verb of ["'add'", "'commit'", "'push'", "'checkout'", "'reset'", "'stash', 'drop'"]) {
    assert.ok(!route.includes(verb), `the scm route must not run git ${verb}`)
  }
})
