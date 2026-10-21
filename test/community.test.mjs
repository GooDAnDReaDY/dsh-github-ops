import test from 'node:test'
import assert from 'node:assert/strict'

import {
  getCommunityTemplates,
  scaffoldCommunityFiles,
  TEMPLATE_KEYS,
} from '../lib/tools/community.js'
import { uploadProject } from '../lib/tools/write-files.js'

function clientDouble(routes = {}) {
  const calls = []
  const answer = (method, path, body) => {
    calls.push({ method, path, body })
    let best = null
    let bestLength = -1
    for (const [key, value] of Object.entries(routes)) {
      const [routeMethod, fragment] = key.split(' ')
      if (routeMethod !== method || !path.includes(fragment)) continue
      if (fragment.length > bestLength) {
        best = value
        bestLength = fragment.length
      }
    }
    return typeof best === 'function' ? best(path, body) : (best || { data: {} })
  }
  return {
    calls,
    get: async (path, opts) => answer('GET', path, opts),
    post: async (path, body) => answer('POST', path, body),
    patch: async (path, body) => answer('PATCH', path, body),
    del: async (path, body) => answer('DELETE', path, body),
  }
}

test('getCommunityTemplates returns all standard community files with interpolated options', () => {
  const templates = getCommunityTemplates({
    projectName: 'dsh-github-ops',
    contactEmail: 'vadim@goodandready.app',
    defaultBranch: 'main',
  })

  assert.ok(templates['.github/ISSUE_TEMPLATE/bug_report.md'])
  assert.ok(templates['.github/ISSUE_TEMPLATE/feature_request.md'])
  assert.ok(templates['.github/ISSUE_TEMPLATE/security_advisory.md'])
  assert.ok(templates['.github/PULL_REQUEST_TEMPLATE.md'])
  assert.ok(templates['SECURITY.md'])
  assert.ok(templates['CONTRIBUTING.md'])
  assert.ok(templates['CODE_OF_CONDUCT.md'])

  assert.ok(templates['SECURITY.md'].includes('vadim@goodandready.app'))
  assert.ok(templates['CONTRIBUTING.md'].includes('dsh-github-ops'))
  assert.ok(templates['.github/PULL_REQUEST_TEMPLATE.md'].includes('## 1. Context & Problem'))
})

test('scaffoldCommunityFiles with dryRun returns generated file list without pushing', async () => {
  const res = await scaffoldCommunityFiles(null, {
    owner: 'goodandready',
    repo: 'test-repo',
    branch: 'main',
    dryRun: true,
  })

  assert.equal(res.dryRun, true)
  assert.equal(res.repository, 'goodandready/test-repo')
  assert.equal(res.count, 7)
  assert.equal(res.files.length, 7)
})

test('scaffoldCommunityFiles pushes files via pushFiles when dryRun is false', async () => {
  const client = clientDouble({
    'GET /repos/o/r/git/ref/heads/main': { data: { object: { sha: 'base-commit-sha' } } },
    'GET /repos/o/r/git/commits/base-commit-sha': { data: { tree: { sha: 'base-tree-sha' } } },
    'POST /repos/o/r/git/blobs': { data: { sha: 'new-blob-sha' } },
    'POST /repos/o/r/git/trees': { data: { sha: 'new-tree-sha' } },
    'POST /repos/o/r/git/commits': { data: { sha: 'new-commit-sha' } },
    'PATCH /repos/o/r/git/refs/heads/main': { data: {} },
  })

  const res = await scaffoldCommunityFiles(client, {
    owner: 'o',
    repo: 'r',
    branch: 'main',
    templates: ['security', 'contributing'],
    dryRun: false,
  })

  assert.equal(res.success, true)
  assert.equal(res.commit, 'new-commit-sha')
  assert.equal(res.count, 2)
  assert.deepEqual(res.files, ['SECURITY.md', 'CONTRIBUTING.md'])
})

test('uploadProject automatically includes community files when includeCommunityFiles: true', async () => {
  let pushedFiles = []
  const client = clientDouble({
    'POST /user/repos': { data: { full_name: 'o/r' } },
    'GET /repos/o/r': { data: { default_branch: 'main' } },
    'GET /repos/o/r/git/ref/heads/main': { data: { object: { sha: 'base-commit-sha' } } },
    'GET /repos/o/r/git/commits/base-commit-sha': { data: { tree: { sha: 'base-tree-sha' } } },
    'POST /repos/o/r/git/blobs': { data: { sha: 'new-blob-sha' } },
    'POST /repos/o/r/git/trees': (path, body) => {
      pushedFiles = body.tree.map((t) => t.path)
      return { data: { sha: 'new-tree-sha' } }
    },
    'POST /repos/o/r/git/commits': { data: { sha: 'new-commit-sha' } },
    'PATCH /repos/o/r/git/refs/heads/main': { data: {} },
  })

  await uploadProject(client, {
    owner: 'o',
    repo: 'r',
    files: [{ path: 'src/index.js', content: 'console.log("hello")' }],
    includeCommunityFiles: true,
  })

  assert.ok(pushedFiles.includes('src/index.js'))
  assert.ok(pushedFiles.includes('SECURITY.md'))
  assert.ok(pushedFiles.includes('CONTRIBUTING.md'))
  assert.ok(pushedFiles.includes('.github/PULL_REQUEST_TEMPLATE.md'))
  assert.equal(pushedFiles.length, 8)
})
