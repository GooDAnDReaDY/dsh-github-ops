import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
// Sanitized mirror publication.
//
// A GitHub mirror is a product channel, not a copy of the history: only the npm
// package contents plus the files a reader needs may reach it. Development sources,
// build scripts, caches and agent instructions stay in the source forge.
//
// The git binary is injected as a runner (`git(args, { cwd, env })`), so the whole
// flow is testable without a repository, and the caller decides which working copy
// and which remote are used. Publication is always a fast-forward on top of the
// mirror branch — rewriting mirror history is deliberately not implemented.

export const DEFAULT_ALLOW = [
  '.gitignore', 'LICENSE', 'README.md', 'README.ru.md', 'README.zh.md',
  'CHANGELOG.md', 'package.json', 'cordis.patch.yml',
]

// `docs/**` is internal documentation and never belongs to a publication channel, so it
// is forbidden even when a manifest happens to list it. `scripts/**` is NOT forbidden:
// some packages legitimately ship build tooling, and the allowlist (the manifest's own
// `files`) is what decides — the mirror publishes exactly the npm contents.
export const DEFAULT_FORBIDDEN = [
  'AGENTS.md', 'index.md', 'docs', 'deploy.sh', '.gitea', '.github', '.worktrees',
  '.planning', '__pycache__', '.ruff_cache', '.venv', 'node_modules',
]

export const DEFAULT_REQUIRED = ['package.json', 'README.md']

function matches(path, entries) {
  return entries.some((entry) => {
    const clean = String(entry).replace(/\/+$/, '')
    if (!clean) return false
    return path === clean || path.startsWith(`${clean}/`)
  })
}

/** Split a tree into what may be published and what must stay behind. */
export function sanitizePaths(paths, { allow = DEFAULT_ALLOW, forbidden = DEFAULT_FORBIDDEN } = {}) {
  const publish = []
  const drop = []
  for (const path of paths) {
    if (matches(path, forbidden) || !matches(path, allow)) drop.push(path)
    else publish.push(path)
  }
  publish.sort()
  drop.sort()
  return { publish, drop }
}

/** Allowlist from a package manifest's `files` field, plus the reader-facing files. */
export function allowlistFromManifest(manifest, extra = DEFAULT_ALLOW) {
  const fromFiles = Array.isArray(manifest && manifest.files) ? manifest.files : []
  const cleaned = fromFiles
    .map((entry) => String(entry).replace(/\/\*\*$/, '').replace(/\/+$/, ''))
    .filter(Boolean)
  return [...new Set([...extra, ...cleaned])]
}

function parseLsTree(stdout) {
  return String(stdout || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

async function readManifest(git, { cwd, ref }) {
  try {
    const res = await git(['show', `${ref}:package.json`], { cwd })
    if (res.code !== 0) return null
    return JSON.parse(res.stdout)
  } catch {
    return null
  }
}

/**
 * Read-only plan: which files would be published, how many would be left behind, and
 * whether the publication must be refused (forbidden path present, required file missing).
 */

const REMOTE_NAME_RE = /^(?!-)[a-zA-Z0-9._/-]+$/
const BRANCH_NAME_RE = /^(?!-)[a-zA-Z0-9._/-]+$/

export function validateRemote(remote) {
  const val = String(remote || '').trim()
  if (!val || val.startsWith('-') || !REMOTE_NAME_RE.test(val)) {
    throw new Error(`invalid mirror remote name: "${remote}"`)
  }
  return val
}

export function validateBranchName(branch) {
  const val = String(branch || '').trim()
  if (!val || val.startsWith('-') || !BRANCH_NAME_RE.test(val)) {
    throw new Error(`invalid branch name: "${branch}"`)
  }
  return val
}

export async function planMirror({ git, cwd, ref = 'origin/main', allow, forbidden, required = DEFAULT_REQUIRED }) {
  if (String(ref || '').trim().startsWith('-')) {
    throw new Error(`invalid source ref: "${ref}"`)
  }
  const manifest = await readManifest(git, { cwd, ref })
  const allowlist = allow || allowlistFromManifest(manifest)
  const ls = await git(['ls-tree', '-r', '--name-only', ref], { cwd })
  if (ls.code !== 0) {
    throw new Error(`cannot read the tree of ${ref}: ${(ls.stderr || '').trim() || 'git ls-tree failed'}`)
  }
  const paths = parseLsTree(ls.stdout)
  const { publish, drop } = sanitizePaths(paths, { allow: allowlist, forbidden })
  const forbiddenEntries = forbidden || DEFAULT_FORBIDDEN
  // A forbidden path inside the allowlist is a configuration mistake, not a file to
  // publish: surface it instead of silently dropping it.
  const allowlistConflicts = allowlist.filter((entry) => matches(entry, forbiddenEntries))
  const missing = required.filter((r) => !publish.includes(r))
  const sha = (await git(['rev-parse', ref], { cwd })).stdout.trim()
  return {
    ref,
    sha,
    publish,
    drop,
    total: paths.length,
    allowlistConflicts,
    missingRequired: missing,
    refused: allowlistConflicts.length
      ? `the allowlist contains forbidden paths: ${allowlistConflicts.join(', ')}`
      : missing.length
        ? `required product files are missing: ${missing.join(', ')}`
        : null,
  }
}

/**
 * Publish the sanitized tree on top of the mirror branch (fast-forward, never a force).
 * With dryRun the plan is returned and nothing is written or pushed.
 */
export async function publishMirror({
  git, cwd, ref = 'origin/main', mirror = 'github', branch = 'main',
  allow, forbidden, required = DEFAULT_REQUIRED, dryRun = false, message,
}) {
  validateRemote(mirror)
  validateBranchName(branch)
  if (String(ref || '').trim().startsWith('-')) {
    throw new Error(`invalid source ref: "${ref}"`)
  }
  const plan = await planMirror({ git, cwd, ref, allow, forbidden, required })
  if (plan.refused) {
    const err = new Error(plan.refused)
    err.plan = plan
    throw err
  }
  const source = plan.sha
  const mirrorRef = `${mirror}/${branch}`
  const head = await git(['rev-parse', mirrorRef], { cwd })
  if (head.code !== 0) {
    throw new Error(`mirror branch ${mirrorRef} is not available locally: run "git fetch ${mirror} ${branch}" first`)
  }
  const parent = head.stdout.trim()

  if (dryRun) return { ...plan, mirror: mirrorRef, parent, commit: null, pushed: false }

  const fs = await import('node:fs/promises')
  const tmpIndexDir = await fs.mkdtemp(path.join(tmpdir(), 'dsh-mirror-index-'))
  const indexFile = path.join(tmpIndexDir, `mirror-${randomUUID()}.index`)
  const env = { GIT_INDEX_FILE: indexFile }
  try {
    await git(['read-tree', '--empty'], { cwd, env })
    for (const path of plan.publish) {
      const blob = (await git(['rev-parse', `${ref}:${path}`], { cwd })).stdout.trim()
      const updated = await git(['update-index', '--add', '--cacheinfo', `100644,${blob},${path}`], { cwd, env })
      if (updated.code !== 0) throw new Error(`cannot stage ${path}: ${(updated.stderr || '').trim()}`)
    }
    const tree = (await git(['write-tree'], { cwd, env })).stdout.trim()
    const commitMessage = message || `chore(publish): sanitized tree from ${source.slice(0, 8)}`
    const commitRes = await git(['commit-tree', tree, '-p', parent, '-m', commitMessage], { cwd })
    if (commitRes.code !== 0) throw new Error(`cannot create the mirror commit: ${(commitRes.stderr || '').trim()}`)
    const commit = commitRes.stdout.trim()
    const push = await git(['push', mirror, `${commit}:refs/heads/${branch}`], { cwd })
    if (push.code !== 0) {
      throw new Error(`push to ${mirrorRef} failed: ${(push.stderr || push.stdout || '').trim() || 'unknown error'}`)
    }
    return {
      ...plan,
      mirror: mirrorRef,
      parent,
      commit,
      pushed: true,
      correspondence: { source, mirror: commit },
    }
  } finally {
    await git(['update-index', '--refresh'], { cwd, env }).catch(() => {})
    await fs.rm(tmpIndexDir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Diagnostic status of the sanitized GitHub mirror:
 * - Checks source HEAD vs mirror HEAD (ahead / behind count).
 * - Checks unpushed release tags.
 * - Runs sanitize leak check (planMirror) to ensure no forbidden file is exposed.
 */
export async function mirrorStatus({
  git, cwd, ref = 'origin/main', mirror = 'github', branch = 'main',
  allow, forbidden = DEFAULT_FORBIDDEN, required = DEFAULT_REQUIRED,
}) {
  validateRemote(mirror)
  validateBranchName(branch)
  if (String(ref || '').trim().startsWith('-')) {
    throw new Error(`invalid source ref: "${ref}"`)
  }

  const sourceRes = await git(['rev-parse', ref], { cwd })
  const sourceHead = sourceRes.code === 0 ? sourceRes.stdout.trim() : null

  const mirrorRef = `${mirror}/${branch}`
  const mirrorRes = await git(['rev-parse', mirrorRef], { cwd })
  const mirrorHead = mirrorRes.code === 0 ? mirrorRes.stdout.trim() : null

  let ahead = 0
  let behind = 0
  let lastSyncedSourceSha = null
  if (mirrorHead) {
    const logRes = await git(['log', '-1', '--format=%B', mirrorRef], { cwd })
    if (logRes.code === 0) {
      const match = String(logRes.stdout || '').match(/sanitized tree from ([0-9a-fA-F]{7,40})/)
      if (match) lastSyncedSourceSha = match[1]
    }
  }

  if (sourceHead && mirrorHead) {
    if (lastSyncedSourceSha && sourceHead.startsWith(lastSyncedSourceSha)) {
      ahead = 0
    } else if (lastSyncedSourceSha) {
      const aheadRes = await git(['rev-list', '--count', `${lastSyncedSourceSha}..${ref}`], { cwd })
      if (aheadRes.code === 0) ahead = parseInt(aheadRes.stdout.trim(), 10) || 0
    } else {
      const aheadRes = await git(['rev-list', '--count', `${mirrorRef}..${ref}`], { cwd })
      if (aheadRes.code === 0) ahead = parseInt(aheadRes.stdout.trim(), 10) || 0
      const behindRes = await git(['rev-list', '--count', `${ref}..${mirrorRef}`], { cwd })
      if (behindRes.code === 0) behind = parseInt(behindRes.stdout.trim(), 10) || 0
    }
  }

  const unpushedTags = []
  try {
    const localTagsRes = await git(['tag', '-l'], { cwd })
    const localTags = localTagsRes.code === 0
      ? localTagsRes.stdout.split('\n').map((t) => t.trim()).filter(Boolean)
      : []

    if (localTags.length > 0) {
      const remoteTagsRes = await git(['ls-remote', '--tags', mirror], { cwd })
      if (remoteTagsRes.code === 0) {
        const remoteOut = remoteTagsRes.stdout || ''
        for (const tag of localTags) {
          if (!remoteOut.includes(`refs/tags/${tag}`)) {
            unpushedTags.push(tag)
          }
        }
      }
    }
  } catch {
    // tag check is best-effort (network or mock runner)
  }

  let leakCheck = { passed: false, conflicts: [], missingRequired: [], refused: null }
  let publishPlan = { willPublishCount: 0, willDropCount: 0 }
  try {
    const plan = await planMirror({ git, cwd, ref, allow, forbidden, required })
    leakCheck = {
      passed: !plan.refused,
      conflicts: plan.allowlistConflicts,
      missingRequired: plan.missingRequired,
      refused: plan.refused,
    }
    publishPlan = {
      willPublishCount: plan.publish.length,
      willDropCount: plan.drop.length,
    }
  } catch (err) {
    leakCheck = {
      passed: false,
      conflicts: [],
      missingRequired: [],
      refused: String((err && err.message) || err),
    }
  }

  const inSync = Boolean(
    sourceHead && mirrorHead &&
    ((lastSyncedSourceSha && sourceHead.startsWith(lastSyncedSourceSha)) || (ahead === 0 && sourceHead === mirrorHead)) &&
    unpushedTags.length === 0 &&
    leakCheck.passed,
  )

  return {
    inSync,
    sourceRef: ref,
    mirrorRef,
    sourceHead,
    mirrorHead,
    lastSyncedSourceSha,
    ahead,
    behind,
    unpushedTags,
    leakCheck,
    publishPlan,
  }
}

/**
 * Synchronize mirror repository with sanitized publication and tag pushes.
 */
export async function syncMirror({
  git, cwd, ref = 'origin/main', mirror = 'github', branch = 'main',
  allow, forbidden = DEFAULT_FORBIDDEN, required = DEFAULT_REQUIRED,
  syncTags = true, message, dryRun = false,
}) {
  const status = await mirrorStatus({ git, cwd, ref, mirror, branch, allow, forbidden, required })
  if (!status.leakCheck.passed) {
    throw new Error(`cannot sync mirror: leak check failed (${status.leakCheck.refused})`)
  }

  const publishResult = await publishMirror({
    git, cwd, ref, mirror, branch,
    allow, forbidden, required,
    dryRun, message,
  })

  const pushedTags = []
  if (syncTags && !dryRun && status.unpushedTags.length > 0) {
    for (const tag of status.unpushedTags) {
      const pushTagRes = await git(['push', mirror, `refs/tags/${tag}:refs/tags/${tag}`], { cwd })
      if (pushTagRes.code === 0) {
        pushedTags.push(tag)
      }
    }
  }

  return {
    synced: true,
    publishResult,
    pushedTags,
    mirrorRef: `${mirror}/${branch}`,
  }
}
