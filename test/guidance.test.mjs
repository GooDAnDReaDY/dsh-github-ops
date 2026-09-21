import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { GUIDANCE_TEXT, GUIDANCE_SECTION, GUIDANCE_ORDER, guidanceText } from '../lib/guidance.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const hostSource = fs.readFileSync(path.join(here, '..', 'lib', 'index.js'), 'utf8')

test('the guidance is short enough to pay for on every turn', () => {
  assert.ok(GUIDANCE_TEXT.length < 1200, `guidance is ${GUIDANCE_TEXT.length} characters`)
  assert.ok(GUIDANCE_TEXT.split('\n').length <= 7, 'one line per point, not an essay')
})

test('the guidance answers the questions a model actually has', () => {
  for (const fragment of [
    'gh_help', // which tool exists
    'origin remote', // why the repository may be omitted
    'owner/repo#12', // how a reference may look
    'gh_repo_report', // the composed calls
    'ci_run',
    'confirm: true', // how a dangerous call is gated
    'belong to the host', // and who owns approvals
    'gh_auth_status', // where access comes from
  ]) {
    assert.ok(GUIDANCE_TEXT.includes(fragment), `guidance should mention ${fragment}`)
  }
})

test('a configured text replaces the default, and blank falls back to it', () => {
  assert.equal(guidanceText(''), GUIDANCE_TEXT)
  assert.equal(guidanceText('   '), GUIDANCE_TEXT)
  assert.equal(guidanceText(undefined), GUIDANCE_TEXT)
  assert.equal(guidanceText('Be brief.'), 'Be brief.')
  assert.equal(guidanceText('  Be brief.  '), 'Be brief.')
})

test('the section name and order are stable, and the host registers them', () => {
  assert.equal(GUIDANCE_SECTION, 'dsh-github-ops')
  assert.ok(Number.isFinite(GUIDANCE_ORDER))
  assert.match(hostSource, /sctx\.systemPrompt\.section\(\{/)
  assert.match(hostSource, /name:\s*GUIDANCE_SECTION/)
  assert.match(hostSource, /order:\s*GUIDANCE_ORDER/)
  assert.match(hostSource, /cfg\.guidance === false/, 'the setting can switch it off')
})
