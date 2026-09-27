// lib/tools/release-preflight.js
// Automated release preflight audit for DSH plugins according to
// dhs-plugin-release-workflow and dsh-documentation-standard.

import { readFileSync, existsSync } from 'node:fs'
import { join as joinPath } from 'node:path'
import { execFile as defaultExecFile } from 'node:child_process'
import { promisify } from 'node:util'

const pExecFile = promisify(defaultExecFile)

const MAX_FILE_SIZE_DEFAULT = 262144 // 256 KiB per file
const FORBIDDEN_PACK_PREFIXES = ['docs/', 'test/', 'tests/', '.planning/', '.worktrees/']
const FORBIDDEN_PACK_EXACT = ['AGENTS.md', '.env', '.env.local', 'deploy.sh']

/**
 * Runs preflight release audit checks on a plugin directory.
 *
 * @param {object} options
 * @param {string} [options.cwd] Directory to check (default: process.cwd())
 * @param {boolean} [options.runTests] Whether to execute npm test (default: false)
 * @param {number} [options.maxFileSize] Max allowed size for any single packaged file (default: 256 KiB)
 * @param {object} [deps] Injectable dependencies for unit testing
 */
export async function runReleasePreflight(options = {}, deps = {}) {
  const cwd = options.cwd || process.cwd()
  const runTests = options.runTests === true
  const maxFileSize = typeof options.maxFileSize === 'number' ? options.maxFileSize : MAX_FILE_SIZE_DEFAULT
  const exec = deps.execFile || pExecFile
  const fsRead = deps.readFileSync || readFileSync
  const fsExists = deps.existsSync || existsSync

  const checks = []
  const findings = []

  // Helper to record result
  const record = (name, ok, details, isWarn = false) => {
    checks.push({ name, ok, details, severity: ok ? 'info' : (isWarn ? 'warn' : 'fail') })
    if (!ok && !isWarn) {
      findings.push(`[FAIL] ${name}: ${details}`)
    } else if (!ok && isWarn) {
      findings.push(`[WARN] ${name}: ${details}`)
    }
  }

  // 1. Check package.json
  let pkg = null
  const pkgPath = joinPath(cwd, 'package.json')
  if (!fsExists(pkgPath)) {
    record('package.json', false, 'package.json not found in repository root')
    return { ok: false, verdict: 'FAIL', checks, findings, version: '' }
  }

  try {
    pkg = JSON.parse(fsRead(pkgPath, 'utf8'))
    const hasName = typeof pkg.name === 'string' && pkg.name.trim().length > 0
    const hasVersion = typeof pkg.version === 'string' && /^\d+\.\d+\.\d+/.test(pkg.version)
    record('package.json', hasName && hasVersion, `name="${pkg.name}", version="${pkg.version}"`)
  } catch (err) {
    record('package.json', false, `invalid JSON: ${err.message}`)
    return { ok: false, verdict: 'FAIL', checks, findings, version: '' }
  }

  const version = pkg.version || ''
  const pkgName = pkg.name || ''

  // 2. Check cordis.patch.yml matching package.json
  const patchPath = joinPath(cwd, 'cordis.patch.yml')
  if (fsExists(patchPath)) {
    try {
      const patchText = fsRead(patchPath, 'utf8')
      const matchesName = patchText.includes(pkgName)
      record('cordis.patch.yml', matchesName, matchesName ? `matches package name "${pkgName}"` : `does not contain package name "${pkgName}"`)
    } catch (err) {
      record('cordis.patch.yml', false, `read error: ${err.message}`)
    }
  } else {
    record('cordis.patch.yml', false, 'cordis.patch.yml not found', true)
  }

  // 3. Check CHANGELOG.md contains release notes for version
  const changelogPath = joinPath(cwd, 'CHANGELOG.md')
  if (fsExists(changelogPath)) {
    try {
      const clText = fsRead(changelogPath, 'utf8')
      const versionRe = new RegExp(`(^|\\n)##+\\s+(\\[?v?${version.replace(/\./g, '\\.')}\\]?)`, 'i')
      const hasNotes = versionRe.test(clText) || clText.includes(version)
      record('CHANGELOG.md', hasNotes, hasNotes ? `found release section for ${version}` : `missing release entry for ${version}`)
    } catch (err) {
      record('CHANGELOG.md', false, `read error: ${err.message}`)
    }
  } else {
    record('CHANGELOG.md', false, 'CHANGELOG.md not found')
  }

  // 4. Check tri-lingual READMEs
  const readmes = [
    { file: 'README.md', lang: 'EN' },
    { file: 'README.ru.md', lang: 'RU' },
    { file: 'README.zh.md', lang: 'ZH' },
  ]
  for (const item of readmes) {
    const fPath = joinPath(cwd, item.file)
    if (fsExists(fPath)) {
      try {
        const content = fsRead(fPath, 'utf8')
        const okLen = content.trim().length >= 20 || Buffer.byteLength(content) >= 50
        record(`README (${item.lang})`, okLen, okLen ? `${item.file} present (${content.length} bytes)` : `${item.file} is suspiciously short`)
      } catch (err) {
        record(`README (${item.lang})`, false, `read error: ${err.message}`)
      }
    } else {
      record(`README (${item.lang})`, false, `${item.file} missing`)
    }
  }

  // 5. Check npm pack --dry-run --json composition and sizes
  let packFiles = []
  let packedBytes = 0
  let unpackedBytes = 0
  try {
    const { stdout } = await exec('npm', ['pack', '--dry-run', '--json'], { cwd, maxBuffer: 10 * 1024 * 1024 })
    const jsonStart = stdout.search(/[{\[]/)
    if (jsonStart !== -1) {
      const raw = JSON.parse(stdout.slice(jsonStart))
      const packData = Array.isArray(raw) ? raw[0] : (Object.values(raw)[0] || raw)
      packFiles = Array.isArray(packData.files) ? packData.files : []
      packedBytes = packData.size || 0
      unpackedBytes = packData.unpackedSize || 0
    }
  } catch (err) {
    record('npm pack', false, `npm pack --dry-run failed: ${err.message}`)
  }

  if (packFiles.length > 0) {
    const oversized = packFiles.filter((f) => (f.size || 0) > maxFileSize)
    record(
      'npm pack file sizes',
      oversized.length === 0,
      oversized.length === 0
        ? `all ${packFiles.length} files <= ${maxFileSize} bytes`
        : `oversized files: ${oversized.map((f) => `${f.path} (${f.size}B)`).join(', ')}`
    )

    const leakedFiles = packFiles.filter((f) => {
      const p = f.path || ''
      if (FORBIDDEN_PACK_EXACT.includes(p)) return true
      return FORBIDDEN_PACK_PREFIXES.some((prefix) => p.startsWith(prefix))
    })
    record(
      'npm pack hygiene',
      leakedFiles.length === 0,
      leakedFiles.length === 0
        ? 'no internal/forbidden docs or test files in package'
        : `forbidden files in npm package: ${leakedFiles.map((f) => f.path).join(', ')}`
    )
  }

  // 6. Check git tracking hygiene if in git repo
  try {
    const { stdout } = await exec('git', ['ls-files'], { cwd })
    const tracked = stdout.split('\n').map((l) => l.trim()).filter(Boolean)
    const trackedForbidden = tracked.filter((p) => {
      return p === 'AGENTS.md' || p.startsWith('.planning') || p.startsWith('.worktrees') || p.startsWith('openwiki')
    })
    record(
      'git tracked hygiene',
      trackedForbidden.length === 0,
      trackedForbidden.length === 0
        ? 'clean git index (no AGENTS.md, .planning, .worktrees)'
        : `forbidden files tracked in git: ${trackedForbidden.join(', ')}`,
      true // warn
    )
  } catch {
    // not a git repo or git not found
  }

  // 7. Optional tests execution
  if (runTests) {
    try {
      await exec('npm', ['test'], { cwd, timeout: 60000 })
      record('npm test', true, 'test suite passed successfully')
    } catch (err) {
      record('npm test', false, `test suite failed: ${err.message}`)
    }
  }

  const failures = checks.filter((c) => c.severity === 'fail')
  const ok = failures.length === 0

  return {
    ok,
    verdict: ok ? 'PASS' : 'FAIL',
    version,
    packageName: pkgName,
    packedBytes,
    unpackedBytes,
    unpackedSizeKiB: Math.round(unpackedBytes / 1024 * 10) / 10,
    checks,
    findings,
  }
}