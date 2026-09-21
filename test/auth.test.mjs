import test from 'node:test'
import assert from 'node:assert/strict'

import { resolveAccess, ACCESS_SOURCES, NO_ACCESS_GUIDANCE } from '../lib/auth.js'

const credentialsWith = (value) => ({ resolve: async () => (value ? { value } : null) })
const ghWith = (value) => async () => value

test('the credentials service wins when it has the value', async () => {
  const r = await resolveAccess({
    credentials: credentialsWith('from-credentials'),
    tokenEnv: 'GITHUB_TOKEN',
    env: { GITHUB_TOKEN: 'from-env' },
    runGh: ghWith('from-gh'),
  })
  assert.deepEqual(r, { value: 'from-credentials', source: 'credentials', guidance: '' })
})

test('the environment variable is the second source, the gh CLI the third', async () => {
  const envOnly = await resolveAccess({
    credentials: credentialsWith(''),
    tokenEnv: 'GITHUB_TOKEN',
    env: { GITHUB_TOKEN: 'from-env' },
    runGh: ghWith('from-gh'),
  })
  assert.equal(envOnly.source, 'env')

  // This is the case that makes the plugin work on a machine where `gh auth login` was
  // done: the third-party GitHub plugin resolves the same way, which is why it needed no
  // DSH credential at all.
  const ghOnly = await resolveAccess({
    credentials: credentialsWith(''),
    tokenEnv: 'GITHUB_TOKEN',
    env: {},
    runGh: ghWith('from-gh'),
  })
  assert.deepEqual(ghOnly, { value: 'from-gh', source: 'gh', guidance: '' })
})

test('a pinned source is the only one consulted', async () => {
  const pinned = await resolveAccess({
    credentials: credentialsWith('from-credentials'),
    tokenEnv: 'GITHUB_TOKEN',
    tokenSource: 'gh',
    env: { GITHUB_TOKEN: 'from-env' },
    runGh: ghWith('from-gh'),
  })
  assert.equal(pinned.source, 'gh')

  const pinnedCredentials = await resolveAccess({
    credentials: credentialsWith(''),
    tokenEnv: 'GITHUB_TOKEN',
    tokenSource: 'credentials',
    env: { GITHUB_TOKEN: 'from-env' },
    runGh: ghWith('from-gh'),
  })
  assert.equal(pinnedCredentials.value, '', 'a pinned source never falls through')
})

test('nothing configured returns guidance naming all three sources', async () => {
  const r = await resolveAccess({ credentials: credentialsWith(''), tokenEnv: 'GITHUB_TOKEN', env: {}, runGh: ghWith('') })
  assert.equal(r.value, '')
  assert.equal(r.source, '')
  assert.equal(r.guidance, NO_ACCESS_GUIDANCE)
  assert.match(r.guidance, /credentials\.yaml/)
  assert.match(r.guidance, /environment variable/)
  assert.match(r.guidance, /gh auth login/)
})

test('failures in a source are misses, not crashes', async () => {
  const r = await resolveAccess({
    credentials: { resolve: async () => { throw new Error('credentials service down') } },
    tokenEnv: 'GITHUB_TOKEN',
    env: {},
    runGh: async () => { throw new Error('gh not installed') },
  })
  assert.equal(r.value, '')
  assert.match(r.guidance, /gh auth login/)

  const noService = await resolveAccess({ credentials: null, tokenEnv: 'GITHUB_TOKEN', env: {}, runGh: ghWith('x') })
  assert.equal(noService.source, 'gh', 'a missing credentials service must not stop the chain')
})

test('the source order is the documented one', () => {
  assert.deepEqual(ACCESS_SOURCES, ['credentials', 'env', 'file', 'gh'])
})

test("the plugin's own sign-in is consulted before the gh CLI session", async () => {
  const order = []
  const result = await resolveAccess({
    credentials: { resolve: async () => { order.push('credentials'); return null } },
    tokenEnv: 'GITHUB_TOKEN',
    env: {},
    runFile: async () => { order.push('file'); return 'from-file' },
    runGh: async () => { order.push('gh'); return 'from-gh' },
  })
  assert.equal(result.source, 'file')
  assert.equal(result.value, 'from-file')
  assert.deepEqual(order, ['credentials', 'file'], 'the gh CLI is not asked once the file answers')
})

test('a stored sign-in that answers with nothing falls through to the gh CLI', async () => {
  const result = await resolveAccess({
    credentials: { resolve: async () => null },
    tokenEnv: 'GITHUB_TOKEN',
    env: {},
    runFile: async () => '',
    runGh: async () => 'from-gh',
  })
  assert.equal(result.source, 'gh')
})

test('whitespace from the gh CLI is trimmed and empty output is a miss', async () => {
  const trimmed = await resolveAccess({ credentials: credentialsWith(''), tokenEnv: 'GITHUB_TOKEN', env: {}, runGh: async () => '  abc\n' })
  assert.equal(trimmed.value, 'abc')
  const blank = await resolveAccess({ credentials: credentialsWith(''), tokenEnv: 'GITHUB_TOKEN', env: {}, runGh: async () => '   \n' })
  assert.equal(blank.value, '')
})
