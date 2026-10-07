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


const CONFLICT_START_RE = /^<<<<<<<[ \t]*(.*)$/
const CONFLICT_BASE_RE = /^\|\|\|\|\|\|\|[ \t]*(.*)$/
const CONFLICT_MID_RE = /^=======$/
const CONFLICT_END_RE = /^>>>>>>>[ \t]*(.*)$/

/**
 * Check whether a string contains merge conflict markers.
 */
export function hasConflicts(content) {
  if (!content || typeof content !== 'string') return false
  return content.includes('<<<<<<<') && content.includes('=======') && content.includes('>>>>>>>')
}

/**
 * Parse conflict hunks/blocks from file content.
 */
export function parseConflictBlocks(content) {
  if (!hasConflicts(content)) return []
  const lines = String(content).split(/\r?\n/)
  const blocks = []

  let inBlock = false
  let inBase = false
  let inTheirs = false

  let startLine = 0
  let oursHeader = ''
  let baseHeader = ''
  let theirsHeader = ''
  let oursLines = []
  let baseLines = []
  let theirsLines = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNum = i + 1

    if (!inBlock) {
      const match = CONFLICT_START_RE.exec(line)
      if (match) {
        inBlock = true
        inBase = false
        inTheirs = false
        startLine = lineNum
        oursHeader = match[1] || 'HEAD'
        baseHeader = ''
        theirsHeader = ''
        oursLines = []
        baseLines = []
        theirsLines = []
      }
    } else if (!inTheirs) {
      const baseMatch = CONFLICT_BASE_RE.exec(line)
      if (baseMatch) {
        inBase = true
        baseHeader = baseMatch[1] || ''
        continue
      }
      if (CONFLICT_MID_RE.test(line)) {
        inTheirs = true
        inBase = false
        continue
      }
      if (inBase) {
        baseLines.push(line)
      } else {
        oursLines.push(line)
      }
    } else {
      const endMatch = CONFLICT_END_RE.exec(line)
      if (endMatch) {
        theirsHeader = endMatch[1] || ''
        const oursStr = oursLines.join('\n')
        const theirsStr = theirsLines.join('\n')
        const baseStr = baseLines.length > 0 ? baseLines.join('\n') : undefined
        const bothStr = [oursStr, theirsStr].filter((s) => s.length > 0).join('\n')

        blocks.push({
          index: blocks.length,
          startLine,
          endLine: lineNum,
          oursHeader,
          theirsHeader,
          baseHeader: baseHeader || undefined,
          ours: oursStr,
          theirs: theirsStr,
          base: baseStr,
          both: bothStr,
        })

        inBlock = false
        inBase = false
        inTheirs = false
      } else {
        theirsLines.push(line)
      }
    }
  }

  return blocks
}

/**
 * Resolve merge conflict markers to chosen resolution: 'ours', 'theirs', or 'both'.
 */
export function resolveConflictContent(content, resolutions = 'ours') {
  if (!hasConflicts(content)) return content
  const eol = content.includes('\r\n') ? '\r\n' : '\n'
  const lines = String(content).split(/\r?\n/)
  const resultLines = []

  let inBlock = false
  let inBase = false
  let inTheirs = false
  let blockIndex = 0

  let oursLines = []
  let theirsLines = []

  const getChoice = (idx) => {
    if (typeof resolutions === 'string') return resolutions
    if (resolutions && typeof resolutions === 'object') {
      if (Array.isArray(resolutions)) {
        const found = resolutions.find((r) => r.blockIndex === idx)
        return found ? found.choice : null
      }
      if (resolutions.blockIndex === idx) return resolutions.choice
      if (resolutions.blockIndex === null || resolutions.blockIndex === undefined) return resolutions.choice
    }
    return null
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (!inBlock) {
      if (CONFLICT_START_RE.test(line)) {
        inBlock = true
        inBase = false
        inTheirs = false
        oursLines = []
        theirsLines = []
      } else {
        resultLines.push(line)
      }
    } else if (!inTheirs) {
      if (CONFLICT_BASE_RE.test(line)) {
        inBase = true
      } else if (CONFLICT_MID_RE.test(line)) {
        inTheirs = true
        inBase = false
      } else if (!inBase) {
        oursLines.push(line)
      }
    } else {
      if (CONFLICT_END_RE.test(line)) {
        const choice = getChoice(blockIndex)
        if (choice === 'theirs') {
          resultLines.push(...theirsLines)
        } else if (choice === 'both') {
          if (oursLines.length) resultLines.push(...oursLines)
          if (theirsLines.length) resultLines.push(...theirsLines)
        } else if (choice === 'ours') {
          resultLines.push(...oursLines)
        } else {
          resultLines.push('<<<<<<< HEAD')
          resultLines.push(...oursLines)
          resultLines.push('=======')
          resultLines.push(...theirsLines)
          resultLines.push('>>>>>>> incoming')
        }
        blockIndex++
        inBlock = false
        inTheirs = false
      } else {
        theirsLines.push(line)
      }
    }
  }

  return resultLines.join(eol)
}

/**
 * Splits a unified diff into individual hunks with their headers and ready-to-apply patches.
 */
export function parseDiffHunks(diffText) {
  if (typeof diffText !== 'string' || !diffText.trim()) return []
  const lines = diffText.split('\n')
  const fileHeaderLines = []
  let i = 0
  while (i < lines.length && !lines[i].startsWith('@@')) {
    fileHeaderLines.push(lines[i])
    i++
  }
  const fileHeader = fileHeaderLines.length > 0 ? fileHeaderLines.join('\n') + '\n' : ''

  const hunks = []
  let currentHunk = null

  while (i < lines.length) {
    const line = lines[i]
    if (line.startsWith('@@')) {
      if (currentHunk) {
        currentHunk.patch = fileHeader + currentHunk.lines.map((l) => l.raw).join('\n') + '\n'
        hunks.push(currentHunk)
      }
      const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/)
      currentHunk = {
        header: line,
        oldStart: match ? parseInt(match[1], 10) : 0,
        oldCount: match ? (match[2] !== undefined ? parseInt(match[2], 10) : 1) : 0,
        newStart: match ? parseInt(match[3], 10) : 0,
        newCount: match ? (match[4] !== undefined ? parseInt(match[4], 10) : 1) : 0,
        heading: match ? match[5].trim() : '',
        lines: [{ type: 'hunk_header', text: line, raw: line }],
        patch: '',
      }
    } else if (currentHunk) {
      let type = 'context'
      if (line.startsWith('+')) type = 'add'
      else if (line.startsWith('-')) type = 'del'
      else if (line.startsWith('\\')) type = 'meta'
      currentHunk.lines.push({ type, text: line, raw: line })
    }
    i++
  }

  if (currentHunk) {
    currentHunk.patch = fileHeader + currentHunk.lines.map((l) => l.raw).join('\n') + '\n'
    hunks.push(currentHunk)
  }

  return hunks
}

/**
 * Parses git log --graph --date=short --format=format:'%h|%d|%s|%an|%cd' output.
 */
export function parseGitGraph(text) {
  if (typeof text !== 'string' || !text.trim()) return []
  const lines = text.split('\n')
  const results = []

  for (const rawLine of lines) {
    if (!rawLine.trim()) continue
    const match = rawLine.match(/^([*|/\\_\-\s]*?)\s*([0-9a-f]{7,40})\|([^|]*)\|([^|]*)\|([^|]*)\|(.*)$/)
    if (match) {
      const graph = match[1] || '*'
      const hash = match[2]
      const rawRefs = match[3].trim()
      const subject = match[4].trim()
      const author = match[5].trim()
      const date = match[6].trim()

      let refs = []
      if (rawRefs) {
        const cleanRefs = rawRefs.replace(/^\(|\)$/g, '').trim()
        if (cleanRefs) {
          refs = cleanRefs.split(',').map((r) => r.trim()).filter(Boolean)
        }
      }
      results.push({
        isCommit: true,
        graph,
        hash,
        refs,
        subject,
        author,
        date,
        raw: rawLine,
      })
    } else {
      results.push({
        isCommit: false,
        graph: rawLine,
        hash: '',
        refs: [],
        subject: '',
        author: '',
        date: '',
        raw: rawLine,
      })
    }
  }

  return results
}
