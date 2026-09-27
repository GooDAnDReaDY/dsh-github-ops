// Reading a working copy, for the Source Control tab.
//
// The parsers are pure: they take the text git prints and return a structure. That keeps the
// interesting part — porcelain status, ahead/behind, groups — testable without a repository,
// and the host route stays a thin wrapper around `git` calls.
//
// Nothing here writes: the tab reads, and a write only happens when the human clicks.

/** One entry of `git status --porcelain=v1` (XY PATH, with renames as "R  old -> new"). */
export function parseStatusLine(line) {
  if (!line || line.length < 4) return null
  const index = line[0]
  const worktree = line[1]
  let path = line.slice(3)
  let renamedFrom = ''
  const arrow = path.indexOf(' -> ')
  if (arrow !== -1) {
    renamedFrom = path.slice(0, arrow)
    path = path.slice(arrow + 4)
  }
  if (path.startsWith('"') && path.endsWith('"')) path = path.slice(1, -1)
  return { index, worktree, path, renamedFrom }
}

/** Group a porcelain listing the way the panel shows it. */
export function parseStatus(text) {
  const lines = String(text || '').split('\n').filter((line) => line.trim().length > 0)
  const staged = []
  const changes = []
  const untracked = []
  const unmerged = []
  for (const line of lines) {
    const entry = parseStatusLine(line)
    if (!entry) continue
    const { index, worktree, path, renamedFrom } = entry
    if (index === '?' && worktree === '?') {
      untracked.push({ path, status: '?', staged: false })
      continue
    }
    // a conflicted file is reported once, as a conflict, not as staged and modified
    const conflict = 'UDUAAD'.includes(index) && 'UDUAAD'.includes(worktree)
    if (conflict) {
      unmerged.push({ path, status: 'U', staged: false })
      continue
    }
    if (index !== ' ' && index !== '?') {
      staged.push({ path, status: index, staged: true, renamedFrom: renamedFrom || undefined })
    }
    if (worktree !== ' ' && worktree !== '?') {
      changes.push({ path, status: worktree, staged: false })
    }
  }
  return { staged, changes, untracked, unmerged, total: staged.length + changes.length + untracked.length + unmerged.length }
}

/** `git branch --format='%(refname:short)\t%(HEAD)'` (or `git branch` output as a fallback). */
export function parseBranches(text) {
  const lines = String(text || '').split('\n').filter((line) => line.trim().length > 0)
  return lines.map((line) => {
    const [name, head] = line.split('\t')
    const current = head ? head.trim() === '*' : line.trim().startsWith('*')
    return { name: (name || line).replace(/^\*/, '').trim(), current }
  }).filter((branch) => branch.name.length > 0)
}

/** `git stash list --format='%gd\t%gs'` or the default `stash@{0}: WIP on main: …`. */
export function parseStashes(text) {
  const lines = String(text || '').split('\n').filter((line) => line.trim().length > 0)
  return lines.map((line) => {
    const [ref, ...rest] = line.split('\t')
    if (rest.length) return { ref: ref.trim(), message: rest.join(' ').trim() }
    const colon = line.indexOf(':')
    return colon === -1
      ? { ref: line.trim(), message: '' }
      : { ref: line.slice(0, colon).trim(), message: line.slice(colon + 1).trim() }
  })
}

/** Parse output of `git worktree list --porcelain`. */
export function parseWorktrees(text) {
  const chunks = String(text || '').trim().split(/\n\s*\n/)
  const worktrees = []
  for (const chunk of chunks) {
    if (!chunk.trim()) continue
    const lines = chunk.split('\n')
    let path = ''
    let head = ''
    let branch = ''
    let bare = false
    let detached = false
    let locked = false
    let lockReason = ''
    let prunable = false

    for (const line of lines) {
      if (line.startsWith('worktree ')) path = line.slice(9).trim()
      else if (line.startsWith('HEAD ')) head = line.slice(5).trim()
      else if (line.startsWith('branch ')) branch = line.slice(7).trim().replace(/^refs\/heads\//, '')
      else if (line === 'bare') bare = true
      else if (line === 'detached') detached = true
      else if (line.startsWith('locked')) {
        locked = true
        lockReason = line.slice(6).trim()
      } else if (line.startsWith('prunable')) {
        prunable = true
      }
    }
    if (path) {
      worktrees.push({ path, head, branch, bare, detached, locked, lockReason: lockReason || undefined, prunable })
    }
  }
  return worktrees
}

/** Counts from `git rev-list --count <range>`. */
export function parseCount(text) {
  const value = Number.parseInt(String(text || '').trim(), 10)
  return Number.isFinite(value) && value >= 0 ? value : 0
}

/**
 * The payload the tab renders. Everything is optional: a repository without an upstream has no
 * ahead/behind, and that is reported as such rather than as an error.
 */
export function scmPayload({
  cwd, branch, upstream, ahead, behind, status, branches, tags, stashes, worktrees, merge, error,
} = {}) {
  return {
    cwd: cwd || '',
    isRepository: !error && Boolean(branch),
    branch: branch || '',
    upstream: upstream || '',
    ahead: Number.isFinite(ahead) ? ahead : null,
    behind: Number.isFinite(behind) ? behind : null,
    files: status || { staged: [], changes: [], untracked: [], unmerged: [], total: 0 },
    branches: Array.isArray(branches) ? branches : [],
    tags: Array.isArray(tags) ? tags : [],
    stashes: Array.isArray(stashes) ? stashes : [],
    worktrees: Array.isArray(worktrees) ? worktrees : [],
    mergeState: merge || { inProgress: false, kind: '' },
    error: error ? String(error).slice(0, 300) : '',
  }
}

/** Detect a merge or rebase in progress from the presence of the marker files. */
export function mergeStateFrom({ mergeHead = false, rebaseDir = false, cherryPickHead = false, revertHead = false } = {}) {
  if (mergeHead) return { inProgress: true, kind: 'merge' }
  if (rebaseDir) return { inProgress: true, kind: 'rebase' }
  if (cherryPickHead) return { inProgress: true, kind: 'cherry-pick' }
  if (revertHead) return { inProgress: true, kind: 'revert' }
  return { inProgress: false, kind: '' }
}
