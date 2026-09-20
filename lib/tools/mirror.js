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
export async function planMirror({ git, cwd, ref = 'origin/main', allow, forbidden, required = DEFAULT_REQUIRED }) {
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

  const indexFile = `/tmp/dsh-github-ops-mirror-${process.pid}-${Date.now()}.index`
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
  }
}
