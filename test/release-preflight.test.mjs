// test/release-preflight.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'

import { runReleasePreflight } from '../lib/tools/release-preflight.js'

function makeMockDeps({ files = {}, packFiles = [], packSize = 1000, testPasses = true } = {}) {
  const fsRead = (p) => {
    const key = Object.keys(files).find((k) => p.endsWith(k))
    if (key && files[key] !== undefined) return files[key]
    throw new Error(`ENOENT: ${p}`)
  }
  const fsExists = (p) => {
    return Boolean(Object.keys(files).some((k) => p.endsWith(k) && files[k] !== undefined))
  }
  const execFile = async (cmd, args) => {
    if (cmd === 'npm' && args[0] === 'pack') {
      const result = [{
        name: '@goodandready/dsh-github-ops',
        version: '0.2.6',
        size: packSize,
        unpackedSize: packSize * 2,
        files: packFiles,
      }]
      return { stdout: JSON.stringify(result), stderr: '' }
    }
    if (cmd === 'git' && args[0] === 'ls-files') {
      return { stdout: 'lib/index.js\npackage.json\nREADME.md\n', stderr: '' }
    }
    if (cmd === 'npm' && args[0] === 'test') {
      if (!testPasses) throw new Error('1 test failed')
      return { stdout: 'PASS', stderr: '' }
    }
    return { stdout: '', stderr: '' }
  }
  return { readFileSync: fsRead, existsSync: fsExists, execFile }
}

test('fails immediately if package.json does not exist', async () => {
  const deps = makeMockDeps({ files: {} })
  const result = await runReleasePreflight({ cwd: '/test' }, deps)
  assert.equal(result.ok, false)
  assert.equal(result.verdict, 'FAIL')
  assert.ok(result.findings.some((f) => f.includes('package.json not found')))
})

test('passes cleanly when all preflight requirements are satisfied', async () => {
  const files = {
    'package.json': JSON.stringify({ name: '@goodandready/dsh-github-ops', version: '0.2.6' }),
    'cordis.patch.yml': 'name: "@goodandready/dsh-github-ops"',
    'CHANGELOG.md': '## 0.2.6\n\n- Some changes',
    'README.md': 'English documentation text that is sufficiently long and informative.',
    'README.ru.md': 'Русская документация достаточной длины для прохождения проверки качества.',
    'README.zh.md': '中文文档内容足够详细且长度超过五十个字符以满足预检查要求，支持完整的GitHub操作和自动化发布工作流测试。',
  }
  const packFiles = [
    { path: 'package.json', size: 1024 },
    { path: 'lib/index.js', size: 5000 },
    { path: 'README.md', size: 2000 },
  ]
  const deps = makeMockDeps({ files, packFiles, packSize: 8024 })
  const result = await runReleasePreflight({ cwd: '/test' }, deps)
  assert.equal(result.ok, true)
  assert.equal(result.verdict, 'PASS')
  assert.equal(result.version, '0.2.6')
  assert.equal(result.findings.length, 0)
})

test('detects missing README translations', async () => {
  const files = {
    'package.json': JSON.stringify({ name: '@goodandready/dsh-github-ops', version: '0.2.6' }),
    'cordis.patch.yml': 'name: "@goodandready/dsh-github-ops"',
    'CHANGELOG.md': '## 0.2.6\n\n- Fixes',
    'README.md': 'English documentation text that is sufficiently long and informative.',
    // Missing README.ru.md and README.zh.md
  }
  const packFiles = [{ path: 'package.json', size: 100 }]
  const deps = makeMockDeps({ files, packFiles })
  const result = await runReleasePreflight({ cwd: '/test' }, deps)
  assert.equal(result.ok, false)
  assert.equal(result.verdict, 'FAIL')
  assert.ok(result.findings.some((f) => f.includes('README.ru.md missing')))
  assert.ok(result.findings.some((f) => f.includes('README.zh.md missing')))
})

test('detects oversized file in npm pack', async () => {
  const files = {
    'package.json': JSON.stringify({ name: '@goodandready/dsh-github-ops', version: '0.2.6' }),
    'cordis.patch.yml': 'name: "@goodandready/dsh-github-ops"',
    'CHANGELOG.md': '## 0.2.6\n\n- Fixes',
    'README.md': 'English documentation text that is sufficiently long and informative.',
    'README.ru.md': 'Русская документация достаточной длины для прохождения проверки качества.',
    'README.zh.md': '中文文档内容足够详细且长度超过五十个字符以满足预检查要求，支持完整的GitHub操作和自动化发布工作流测试。',
  }
  const packFiles = [
    { path: 'media/large.png', size: 300000 }, // > 262144 bytes
  ]
  const deps = makeMockDeps({ files, packFiles })
  const result = await runReleasePreflight({ cwd: '/test' }, deps)
  assert.equal(result.ok, false)
  assert.equal(result.verdict, 'FAIL')
  assert.ok(result.findings.some((f) => f.includes('oversized files')))
})

test('detects forbidden internal documentation or tests leaked into npm pack', async () => {
  const files = {
    'package.json': JSON.stringify({ name: '@goodandready/dsh-github-ops', version: '0.2.6' }),
    'cordis.patch.yml': 'name: "@goodandready/dsh-github-ops"',
    'CHANGELOG.md': '## 0.2.6\n\n- Fixes',
    'README.md': 'English documentation text that is sufficiently long and informative.',
    'README.ru.md': 'Русская документация достаточной длины для прохождения проверки качества.',
    'README.zh.md': '中文文档内容足够详细且长度超过五十个字符以满足预检查要求，支持完整的GitHub操作和自动化发布工作流测试。',
  }
  const packFiles = [
    { path: 'docs/architecture.md', size: 1000 },
    { path: 'test/scm.test.mjs', size: 2000 },
    { path: 'AGENTS.md', size: 500 },
  ]
  const deps = makeMockDeps({ files, packFiles })
  const result = await runReleasePreflight({ cwd: '/test' }, deps)
  assert.equal(result.ok, false)
  assert.equal(result.verdict, 'FAIL')
  assert.ok(result.findings.some((f) => f.includes('forbidden files in npm package')))
})

test('detects unreleased version missing from CHANGELOG.md', async () => {
  const files = {
    'package.json': JSON.stringify({ name: '@goodandready/dsh-github-ops', version: '0.2.7' }),
    'cordis.patch.yml': 'name: "@goodandready/dsh-github-ops"',
    'CHANGELOG.md': '## 0.2.6\n\n- Older version notes only',
    'README.md': 'English documentation text that is sufficiently long and informative.',
    'README.ru.md': 'Русская документация достаточной длины для прохождения проверки качества.',
    'README.zh.md': '中文文档内容足够详细且长度超过五十个字符以满足预检查要求，支持完整的GitHub操作和自动化发布工作流测试。',
  }
  const packFiles = [{ path: 'package.json', size: 100 }]
  const deps = makeMockDeps({ files, packFiles })
  const result = await runReleasePreflight({ cwd: '/test' }, deps)
  assert.equal(result.ok, false)
  assert.equal(result.verdict, 'FAIL')
  assert.ok(result.findings.some((f) => f.includes('missing release entry for 0.2.7')))
})

test('runTests flag executes test command and fails if tests fail', async () => {
  const files = {
    'package.json': JSON.stringify({ name: '@goodandready/dsh-github-ops', version: '0.2.6' }),
    'cordis.patch.yml': 'name: "@goodandready/dsh-github-ops"',
    'CHANGELOG.md': '## 0.2.6\n\n- Some changes',
    'README.md': 'English documentation text that is sufficiently long and informative.',
    'README.ru.md': 'Русская документация достаточной длины для прохождения проверки качества.',
    'README.zh.md': '中文文档内容足够详细且长度超过五十个字符以满足预检查要求，支持完整的GitHub操作和自动化发布工作流测试。',
  }
  const packFiles = [{ path: 'package.json', size: 100 }]
  const depsFail = makeMockDeps({ files, packFiles, testPasses: false })
  // Without confirm: true, runTests must be rejected
  await assert.rejects(
    () => runReleasePreflight({ cwd: '/test', runTests: true }, depsFail),
    /running test suite during preflight audit requires confirm: true/,
  )

  const resultFail = await runReleasePreflight({ cwd: '/test', runTests: true, confirm: true }, depsFail)
  assert.equal(resultFail.ok, false)
  assert.ok(resultFail.findings.some((f) => f.includes('test suite failed')))

  const depsPass = makeMockDeps({ files, packFiles, testPasses: true })
  const resultPass = await runReleasePreflight({ cwd: '/test', runTests: true, confirm: true }, depsPass)
  assert.equal(resultPass.ok, true)
  assert.equal(resultPass.verdict, 'PASS')
})

test('runReleasePreflight rejects disallowed system cwd', async () => {
  const deps = makeMockDeps({ files: {} })
  await assert.rejects(
    () => runReleasePreflight({ cwd: '/etc' }, deps),
    /access to system directory "\/etc" is not allowed/,
  )
})
