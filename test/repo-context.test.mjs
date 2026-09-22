import test from 'node:test'
import assert from 'node:assert/strict'

import { parseRef, parseRemoteUrl, resolveRepoContext } from '../lib/repo-context.js'

test('parseRef understands owner/repo, with or without a number, and a bare number', () => {
  assert.deepEqual(parseRef('GooDAnDReaDY/dsh-gitea'), { owner: 'GooDAnDReaDY', repo: 'dsh-gitea', number: null })
  assert.deepEqual(parseRef('o/r#12'), { owner: 'o', repo: 'r', number: 12 })
  assert.deepEqual(parseRef('#12'), { owner: '', repo: '', number: 12 })
  assert.deepEqual(parseRef('12'), { owner: '', repo: '', number: 12 })
  assert.equal(parseRef('a/b/c'), null)
  assert.equal(parseRef(''), null)
  assert.equal(parseRef(undefined), null)
})

test('parseRemoteUrl reads every remote shape a checkout uses', () => {
  const githubish = [
    'git@github.com:GooDAnDReaDY/dsh-gitea.git',
    'ssh://git@github.com/GooDAnDReaDY/dsh-gitea.git',
    'https://github.com/GooDAnDReaDY/dsh-gitea.git',
    'https://github.com/GooDAnDReaDY/dsh-gitea',
    'https://token@github.com/GooDAnDReaDY/dsh-gitea.git',
  ]
  for (const url of githubish) {
    const parsed = parseRemoteUrl(url)
    assert.ok(parsed, `parsed ${url}`)
    assert.equal(parsed.owner, 'GooDAnDReaDY', url)
    assert.equal(parsed.repo, 'dsh-gitea', url)
  }
  // a mirror or forge remote names a repository just as well; the host is not checked
  const gitea = parseRemoteUrl('git@gitea-deepseek-harness:goodandready/dsh-gitea.git')
  assert.equal(gitea.owner, 'goodandready')
  assert.equal(gitea.repo, 'dsh-gitea')
  assert.equal(parseRemoteUrl('not a url'), null)
  assert.equal(parseRemoteUrl(''), null)
})

test('an explicit reference wins, and it can carry the number alone', () => {
  const explicit = resolveRepoContext({ explicit: 'o/r#7', fallback: 'other/repo', remoteUrl: 'git@github.com:x/y.git' })
  assert.equal(explicit.owner, 'o')
  assert.equal(explicit.repo, 'r')
  assert.equal(explicit.number, 7)
  assert.equal(explicit.source, 'explicit')

  const numbered = resolveRepoContext({ explicit: '7', fallback: 'o/r' })
  assert.equal(numbered.owner, 'o')
  assert.equal(numbered.repo, 'r')
  assert.equal(numbered.number, 7)
  assert.equal(numbered.source, 'settings')
})

test('with nothing explicit the origin remote decides', () => {
  const fromRemote = resolveRepoContext({ remoteUrl: 'git@github.com:GooDAnDReaDY/dsh-github-ops.git' })
  assert.deepEqual(
    { owner: fromRemote.owner, repo: fromRemote.repo, source: fromRemote.source },
    { owner: 'GooDAnDReaDY', repo: 'dsh-github-ops', source: 'remote' },
  )

  const fromRemotes = resolveRepoContext({ remotes: { github: 'https://github.com/GooDAnDReaDY/dsh-gitea' } })
  assert.equal(fromRemotes.repo, 'dsh-gitea')
})

test('settings beat the remote, and a bare number without a repository is explained', () => {
  const configured = resolveRepoContext({ fallback: 'o/r', remoteUrl: 'git@github.com:x/y.git' })
  assert.equal(configured.source, 'settings')
  assert.equal(configured.owner, 'o')

  assert.throws(
    () => resolveRepoContext({ explicit: '#5' }),
    /needs a repository/,
  )
  assert.equal(resolveRepoContext({}), null)
})
