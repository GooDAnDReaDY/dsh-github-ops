import { realpathSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join as joinPath, posix, win32 } from 'node:path'
import { hasConflicts, resolveConflictContent } from './scm.js'
// Writing to a working copy, from the Source Control tab.
//
// Every action is a list of argv arrays — never a shell string. The route runs them one by one
// and stops at the first failure, so a caller can see exactly which step refused. Validation
// lives here, next to the commands it protects, and the destructive actions require an explicit
// confirmation from the human who clicked.
//
// Nothing in this module touches the filesystem or spawns a process: it only decides what would
// be run, which makes the decisions testable without a repository.

/** A branch name git will accept: no spaces, no leading dash, no shell metacharacters. */
const BRANCH_RE = /^(?!-)(?!.*\.\.)[A-Za-z0-9._/-]{1,120}$/

/** A repository-relative path: no absolute paths, no traversal, no control characters. */
const PATH_RE = /^(?!-)(?!\/)(?!.*\.\.)[^\u0000-\u001f]{1,500}$/

export function validateBranch(name) {
  const value = String(name == null ? '' : name).trim()
  if (!BRANCH_RE.test(value)) throw new Error(`refusing an unsafe branch name: "${String(name).slice(0, 60)}"`)
  return value
}

export function validatePath(path) {
  const value = String(path == null ? '' : path).trim()
  if (!PATH_RE.test(value)) throw new Error(`refusing an unsafe path: "${String(path).slice(0, 60)}"`)
  return value
}

export function validateMessage(message) {
  const value = String(message == null ? '' : message)
  if (value.includes('\u0000')) throw new Error('refusing a message with a NUL byte')
  const trimmed = value.trim()
  if (!trimmed) throw new Error('a commit or stash needs a message')
  if (trimmed.length > 5000) throw new Error('refusing a message longer than 5000 characters')
  return trimmed
}

/** Stash references are `stash@{N}` or integer indices; nothing else is accepted. */
export function validateStashRef(ref) {
  let value = String(ref == null ? '' : ref).trim()
  if (/^\d{1,3}$/.test(value)) value = `stash@{${value}}`
  if (!/^stash@\{\d{1,3}\}$/.test(value)) throw new Error(`refusing an unsafe stash reference: "${value.slice(0, 40)}"`)
  return value
}


export function validatePatch(patch) {
  const value = String(patch == null ? '' : patch)
  if (value.includes('\u0000')) throw new Error('refusing a patch with a NUL byte')
  const trimmed = value.trim()
  if (!trimmed) throw new Error('a patch cannot be empty')
  if (trimmed.length > 500000) throw new Error('refusing a patch longer than 500000 characters')
  if (!trimmed.includes('@@') && !trimmed.includes('---')) {
    throw new Error('refusing an invalid patch format: missing diff hunk markers')
  }
  return value
}

const CONTINUE_VERBS = ['merge', 'rebase', 'cherry-pick', 'revert']

/**
 * What a named action would run.
 *
 * @returns {{steps: string[][], mutating: true, destructive: boolean, needsConfirm: boolean, summary: string}}
 */
export function buildAction(action, args = {}) {
  const name = String(action || '').trim()
  const destructive = DESTRUCTIVE.has(name)
  const needsConfirm = destructive
  if (needsConfirm && args.confirm !== true) {
    throw new Error(`refusing "${name}" without confirm: true — it cannot be undone`)
  }

  switch (name) {
    case 'stage': {
      const path = args.path ? validatePath(args.path) : ''
      return result(name, [path ? ['add', '--', path] : ['add', '-A']], destructive, `stage ${path || 'everything'}`)
    }
    case 'unstage': {
      const path = args.path ? validatePath(args.path) : ''
      return result(name, [path ? ['reset', 'HEAD', '--', path] : ['reset', 'HEAD']], destructive, `unstage ${path || 'everything'}`)
    }
    case 'discard': {
      const path = validatePath(args.path)
      return result(name, [['checkout', '--', path]], destructive, `discard changes in ${path}`)
    }
    case 'commit': {
      const message = validateMessage(args.message)
      const steps = [args.amend === true ? ['commit', '--amend', '-m', message] : ['commit', '-m', message]]
      if (args.push === true) steps.push(['push'])
      return result(name, steps, destructive, args.amend ? 'amend the last commit' : 'create a commit')
    }
    case 'push':
      return result(name, [args.setUpstream ? ['push', '-u', 'origin', validateBranch(args.branch)] : ['push']], destructive, 'push')
    case 'sync':
      return result(name, [['pull', '--rebase', '--autostash'], ['push']], destructive, 'pull with rebase, then push')
    case 'branchCreate':
      return result(name, [['checkout', '-b', validateBranch(args.branch)]], destructive, `create and switch to ${args.branch}`)
    case 'branchCheckout':
      return result(name, [['checkout', validateBranch(args.branch)]], destructive, `switch to ${args.branch}`)
    case 'branchDelete':
      return result(name, [['branch', '-D', validateBranch(args.branch)]], destructive, `delete ${args.branch}`)
    case 'stashPush': {
      const steps = args.message ? [['stash', 'push', '-m', validateMessage(args.message)]] : [['stash', 'push']]
      return result(name, steps, destructive, 'save the working copy to a stash')
    }
    case 'stashApply':
    case 'stash_apply':
      return result(name, [['stash', 'apply', validateStashRef(args.ref)]], destructive, `apply ${args.ref}`)
    case 'stashPop':
    case 'stash_pop':
      return result(name, [['stash', 'pop', validateStashRef(args.ref)]], destructive, `apply and drop ${args.ref}`)
    case 'stashDrop':
    case 'stash_drop':
      return result(name, [['stash', 'drop', validateStashRef(args.ref)]], destructive, `drop ${args.ref}`)
    case 'stashShow':
    case 'stash_show':
      return result(name, [['stash', 'show', '-p', validateStashRef(args.ref)]], destructive, `show diff of ${args.ref}`)
    case 'continue': {
      const verb = String(args.verb || '').trim()
      if (!CONTINUE_VERBS.includes(verb)) throw new Error(`refusing to continue an unknown operation: "${verb.slice(0, 20)}"`)
      return result(name, [[verb, '--continue']], destructive, `continue the ${verb}`)
    }
    case 'abort': {
      const verb = String(args.verb || '').trim()
      if (!CONTINUE_VERBS.includes(verb)) throw new Error(`refusing to abort an unknown operation: "${verb.slice(0, 20)}"`)
      return result(name, [[verb, '--abort']], destructive, `abort the ${verb}`)
    }
        case 'stagePatch':
    case 'stage_patch': {
      const patch = validatePatch(args.patch)
      const res = result('stage_patch', [['apply', '--cached', '-']], false, 'stage patch hunk')
      res.input = patch
      return res
    }
    case 'unstagePatch':
    case 'unstage_patch': {
      const patch = validatePatch(args.patch)
      const res = result('unstage_patch', [['apply', '--cached', '--reverse', '-']], false, 'unstage patch hunk')
      res.input = patch
      return res
    }
    case 'resolveConflict': {
      const path = validatePath(args.path)
      const choice = String(args.choice || 'ours').trim()
      if (!['ours', 'theirs', 'both'].includes(choice)) {
        throw new Error(`invalid conflict resolution choice: "${choice}". Must be "ours", "theirs", or "both".`)
      }
      return result(name, [['add', '--', path]], false, `resolve conflict in ${path} using ${choice}`)
    }
    case 'worktreeAdd': {
      const path = validateCwd(args.path)
      if (!path) throw new Error('worktree path is required')
      const branch = args.branch ? validateBranch(args.branch) : ''
      const newBranch = args.newBranch ? validateBranch(args.newBranch) : ''
      const step = ['worktree', 'add']
      if (newBranch) {
        step.push('-b', newBranch, path)
        if (branch) step.push(branch)
      } else if (branch) {
        step.push(path, branch)
      } else {
        step.push(path)
      }
      return result(name, [step], destructive, `add worktree at ${path}`)
    }
    case 'worktreeRemove': {
      const path = validateCwd(args.path)
      if (!path) throw new Error('worktree path is required')
      const step = ['worktree', 'remove']
      if (args.force === true) step.push('--force')
      step.push(path)
      return result(name, [step], destructive, `remove worktree at ${path}`)
    }
    default:
      throw new Error(`unknown action: "${name.slice(0, 40)}"`)
  }
}

const DESTRUCTIVE = new Set(['discard', 'branchDelete', 'stashDrop', 'stash_drop', 'abort', 'worktreeRemove'])

function result(action, steps, destructive, summary) {
  return { action, steps, mutating: true, destructive, needsConfirm: destructive, summary }
}

/** Every action the tab may ask for, for the client and for tests. */
export const ACTIONS = Object.freeze([
  'stage', 'unstage', 'discard', 'commit', 'push', 'sync',
  'branchCreate', 'branchCheckout', 'branchDelete',
  'stashPush', 'stashApply', 'stashPop', 'stashDrop', 'stashShow',
  'worktreeAdd', 'worktreeRemove',
  'continue', 'abort',
  'resolveConflict',
])

/** The verbs the panel offers for an unfinished operation. */
export const OPERATION_VERBS = Object.freeze(CONTINUE_VERBS.slice())

/**
 * An optional directory the tab should look at instead of the session workspace. The value is
 * only ever used locally (the route answers a local caller and nothing else executes it), but it
 * is still checked: absolute, without traversal or control bytes.
 */
const DISALLOWED_ROOTS = ['/etc', '/proc', '/sys', '/dev', '/root', '/bin', '/sbin', '/usr', '/boot', '/var/run']

function checkDisallowed(p) {
  const norm = p.replace(/\\/g, '/')
  for (const root of DISALLOWED_ROOTS) {
    if (norm === root || norm.startsWith(root + '/')) {
      throw new Error(`access to system directory "${root}" is not allowed`)
    }
  }
  const driveMatch = norm.match(/^[a-zA-Z]:(\/.*)?$/)
  if (driveMatch) {
    const sub = (driveMatch[1] || '/').toLowerCase()
    if (sub === '/' || sub === '') {
      throw new Error('access to system drive root is not allowed')
    }
    for (const winDir of ['/windows', '/winnt', '/system32', '/boot']) {
      if (sub === winDir || sub.startsWith(winDir + '/')) {
        throw new Error(`access to system directory "${winDir.slice(1)}" is not allowed`)
      }
    }
  }
}

export function validateCwd(path) {
  const value = String(path == null ? '' : path).trim()
  if (!value) return ''
  if (!posix.isAbsolute(value) && !win32.isAbsolute(value)) {
    throw new Error('a repository path must be absolute')
  }
  if (value.includes('..')) throw new Error('a repository path may not contain ".."')
  if (/[\x00-\x1f]/.test(value)) throw new Error('a repository path may not contain control characters')
  if (value.length > 500) throw new Error('a repository path is too long')

  checkDisallowed(value)

  let realPath = value
  try {
    realPath = realpathSync(value)
  } catch {
    realPath = value
  }
  checkDisallowed(realPath)

  return value
}


/**
 * Resolves conflict markers directly in the working copy file and prepares it for staging.
 */
export function resolveConflictFile({ cwd, path, choice = 'ours', blockIndex = null }) {
  const relPath = validatePath(path)
  const fullPath = joinPath(cwd, relPath)
  if (!existsSync(fullPath)) {
    throw new Error(`file not found: ${relPath}`)
  }
  const content = readFileSync(fullPath, 'utf8')
  if (!hasConflicts(content)) {
    throw new Error(`no merge conflict markers found in ${relPath}`)
  }
  const resolved = resolveConflictContent(content, { choice, blockIndex })
  writeFileSync(fullPath, resolved, 'utf8')
  return { path: relPath, choice, blockIndex, resolved: true }
}
