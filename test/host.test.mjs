import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// lib/index.js imports harness packages that are not installed in this checkout, so the
// renderer and the schema are checked in source form: they are what the tool contract
// requires, and a missing `output` already crashed the plugin once on the test server.
const here = path.dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(path.join(here, '..', 'lib', 'index.js'), 'utf8')

test('every tool definition carries the required output contract', () => {
  assert.match(source, /output:\s*\{/, 'defineTool must receive an output object')
  assert.match(source, /schema:\s*OUTPUT_SCHEMA/, 'the output schema must be supplied')
  assert.match(source, /render:\s*\(_args, value\)\s*=>\s*renderToolResult\(/, 'the output renderer must be supplied')
  assert.match(source, /export const OUTPUT_SCHEMA = \{/, 'the schema is exported for reuse and review')
})

test('the output schema describes a value or a described failure', () => {
  const block = source.slice(source.indexOf('export const OUTPUT_SCHEMA'), source.indexOf('const MAX_RENDER_CHARS'))
  assert.match(block, /ok:\s*\{\s*type:\s*'boolean'\s*\}/)
  assert.match(block, /error:\s*\{\s*type:\s*'string'\s*\}/)
  assert.match(block, /data:\s*\{\s*type:\s*'json'\s*\}/)
  assert.match(block, /additionalProperties:\s*true/)
})

test('the renderer caps the text so a single call cannot flood the turn', () => {
  assert.match(source, /MAX_RENDER_CHARS = \d{4,6}/)
  assert.match(source, /output truncated/)
})

test('tools report failures as values, never as thrown errors', () => {
  assert.match(source, /return \{ ok: true, data: value \}/)
  assert.match(source, /const out = \{ ok: false, error: describeError\(err\) \}/)
})

test('the host half imports the schemastery default export, not a named z', () => {
  assert.match(source, /^import Schema from '@deepseek-ai\/schemastery'$/m)
  assert.ok(!/import \{ z \}/.test(source), 'a named z import crashes at load time on a real host')
  assert.match(source, /Schema\.object\(/)
})

test('object-typed tool parameters set additionalProperties explicitly', () => {
  // The harness rejects an object parameter without an explicit additionalProperties:
  // "unsupported JSON schema: parameters.query.additionalProperties must be explicitly
  // true or false" — this crashed the plugin on the test server.
  const dir = path.join(here, '..', 'lib', 'tools')
  const bad = []
  for (const file of fs.readdirSync(dir)) {
    if (!file.startsWith('register-') || !file.endsWith('.js')) continue
    const lines = fs.readFileSync(path.join(dir, file), 'utf8').split('\n')
    lines.forEach((line, i) => {
      if (/type:\s*'object'/.test(line) && !/additionalProperties/.test(line)) {
        bad.push(`${file}:${i + 1}`)
      }
    })
  }
  assert.deepEqual(bad, [], 'every object parameter needs additionalProperties: true|false')
})
