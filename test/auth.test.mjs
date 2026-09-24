import test from 'node:test'
import assert from 'node:assert/strict'

import { resolveAccess, ACCESS_SOURCES, NO_ACCESS_GUIDANCE, tokenFingerprint, clientCacheKey, createClientHolder } from '../lib/auth.js'

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
test('tokenFingerprint produces deterministic 16-hex hash and handles empty values', () => {
  const fp1 = tokenFingerprint('ghp_abcdef1234567890abcdef12345678901234')
  const fp2 = tokenFingerprint('ghp_abcdef1234567890abcdef12345678901234')
  const fp3 = tokenFingerprint('ghp_000000000000000000000000000000000000')

  assert.equal(typeof fp1, 'string')
  assert.equal(fp1.length, 16)
  assert.equal(fp1, fp2, 'fingerprint must be deterministic')
  assert.notEqual(fp1, fp3, 'different tokens must produce different fingerprints')
  assert.equal(tokenFingerprint(''), '')
  assert.equal(tokenFingerprint(null), '')
  assert.equal(tokenFingerprint(undefined), '')
  assert.ok(!fp1.includes('ghp_'), 'fingerprint must never contain raw token string')
})

test('clientCacheKey differentiates tokens of identical length', () => {
  const tokenA = 'ghp_' + 'a'.repeat(36)
  const tokenB = 'ghp_' + 'b'.repeat(36)
  assert.equal(tokenA.length, tokenB.length, 'tokens must be the exact same length')

  const keyA = clientCacheKey({ source: 'env', value: tokenA }, { baseUrl: 'https://api.github.com' })
  const keyB = clientCacheKey({ source: 'env', value: tokenB }, { baseUrl: 'https://api.github.com' })

  assert.notEqual(keyA, keyB, 'cache keys must differ for different tokens of the same length')
  assert.ok(!keyA.includes(tokenA), 'cache key must not leak the raw token')
})

test('createClientHolder rotates client when token changes even with identical length', () => {
  const tokenA = 'ghp_' + '1'.repeat(36)
  const tokenB = 'ghp_' + '2'.repeat(36)
  const created = []

  const holder = createClientHolder({
    createClient: ({ token, baseUrl }) => {
      const instance = { token, baseUrl, id: created.length + 1 }
      created.push(instance)
      return instance
    },
  })

  const accessA = { source: 'credentials', value: tokenA }
  const c1 = holder.get(accessA, { baseUrl: 'https://api.github.com' })
  assert.equal(c1.token, tokenA)
  assert.equal(created.length, 1)

  // Second call with the same token must reuse the cached instance without creating a new client
  const c2 = holder.get(accessA, { baseUrl: 'https://api.github.com' })
  assert.equal(c1, c2, 'identical token and config must return cached client instance')
  assert.equal(created.length, 1, 'no extra client creation for same token')

  // Rotation to another token of the exact same length must recreate the client immediately
  const accessB = { source: 'credentials', value: tokenB }
  const c3 = holder.get(accessB, { baseUrl: 'https://api.github.com' })
  assert.equal(c3.token, tokenB)
  assert.notEqual(c1, c3, 'rotating token must produce a new client instance')
  assert.equal(created.length, 2, 'new client created upon token rotation')

  // Changing configuration options also invalidates the cache
  const c4 = holder.get(accessB, { baseUrl: 'https://ghe.local/api/v3' })
  assert.notEqual(c3, c4, 'changing baseUrl must produce a new client instance')
  assert.equal(created.length, 3)
})

test('createClientHolder throws guidance when access is unconfigured', () => {
  const holder = createClientHolder({ createClient: () => ({}) })
  assert.throws(
    () => holder.get({ value: '', guidance: 'Set GITHUB_TOKEN' }),
    /GitHub access is not configured: Set GITHUB_TOKEN/,
  )
  assert.throws(
    () => holder.get(null),
    /GitHub access is not configured/,
  )
})
