// Human slash commands: /pr, /review, /issue, /gh.
//
// A command never writes to GitHub itself. It gathers the read-only context it can see (the
// checkout, the current branch, the remote) and hands the model an instruction to call the
// right tool — so the write still passes through the approval gate, exactly as if the tool
// had been called directly. Commands are the fast path for a human, not a second API.

export const USAGE = {
  pr: 'Usage: /pr create [title] — opens a pull request from the current branch',
  review: 'Usage: /review [number] — reviews a pull request; without a number, the one for the current branch',
  issue: 'Usage: /issue new <title> | /issue list | /issue show <number>',
  gh: 'Usage: /gh <tool> [args] — describes how to call one of the plugin tools',
}

const TOOL_HINTS = {
  releases: 'gh_release_list, gh_release_view, gh_release_create, gh_release_edit, gh_release_delete',
  tags: 'gh_tag_list, gh_tag_create, gh_tag_delete',
  mirror: 'gh_mirror_check, gh_mirror_publish',
  runs: 'gh_run_list, gh_run_view, gh_run_jobs, gh_run_rerun, gh_run_cancel, gh_run_logs',
  secrets: 'gh_secret_list, gh_secret_set, gh_secret_delete',
  variables: 'gh_variable_list, gh_variable_set, gh_variable_delete',
  rulesets: 'gh_ruleset_list, gh_ruleset_view, gh_ruleset_apply, gh_ruleset_delete',
  protection: 'gh_branch_protection_get, gh_branch_protection_set, gh_branch_protection_delete',
}

/** The instruction a /pr create leaves for the model. Pure, so it is testable. */
export function buildPrInstruction({ title, branch, base = 'main', repo, remoteUrl } = {}) {
  const where = repo ? ` in ${repo}` : remoteUrl ? ` in the repository of ${remoteUrl}` : ''
  return [
    `The user ran /pr create${title ? ` "${title}"` : ''}.`,
    `Current branch: ${branch || 'unknown'}.`,
    `Call pr_create with head=${branch || '<current branch>'}, base=${base}${where}${title ? `, title="${title}"` : ''}, and a body that summarises the commits on the branch (git log ${base}..${branch}).`,
    'If the branch is not pushed yet, say so instead of opening the pull request.',
  ].join(' ')
}

/** The instruction a /review leaves for the model. */
export function buildReviewInstruction({ number, branch, repo } = {}) {
  const target = number ? `pull request #${number}` : `the pull request for ${branch || 'the current branch'}`
  return [
    `The user ran /review. Review ${target}${repo ? ` in ${repo}` : ''}.`,
    `Call gh_review, then summarise the findings in your own words — critical items first.`,
    number ? 'If the verdict matters, also call ci_run for the same number.' : 'Find the number with gh_search first if it is unknown.',
  ].join(' ')
}

/** The instruction /issue leaves for the model. */
export function buildIssueInstruction({ sub, title, number, repo } = {}) {
  if (sub === 'new') {
    return [
      `The user ran /issue new${title ? ` "${title}"` : ''}.`,
      `Call issue_open${repo ? ` in ${repo}` : ''} with that title and a body that spells out the problem, the impact and what done looks like.`,
      'Ask for anything essential that is missing before opening it.',
    ].join(' ')
  }
  if (sub === 'show') {
    return `The user ran /issue show ${number}. Call gh_issue with action "get" and number ${number}${repo ? ` in ${repo}` : ''}, then summarise it.`
  }
  return `The user ran /issue list. Call gh_issue with action "list"${repo ? ` in ${repo}` : ''} and summarise the open items.`
}

/** The instruction /gh leaves for the model. */
export function buildGhInstruction({ topic, tool, args } = {}) {
  if (!topic && !tool) {
    return `The user ran /gh. Available groups: ${Object.keys(TOOL_HINTS).join(', ')}. Ask which one, or name a tool directly (for example /gh gh_release_list).`
  }
  if (tool) return `The user ran /gh ${tool}${args ? ` ${args}` : ''}. Call the ${tool} tool with the arguments they meant.`
  return `The user asked about ${topic}. Relevant tools: ${TOOL_HINTS[topic] || 'none'}.`
}

/**
 * Register the commands. Every handler returns an instruction for the model; none of them
 * touches GitHub.
 */
export function registerCommands(commands, { readGitState, repoHint } = {}) {
  const disposers = []
  const context = async () => {
    try {
      return (typeof readGitState === 'function' ? await readGitState() : {}) || {}
    } catch {
      return {}
    }
  }

  disposers.push(commands.register({
    name: 'pr',
    description: 'Create a GitHub pull request from the current branch',
    input: { hint: 'create [title]' },
    handler: async (invocation) => {
      const [sub, ...rest] = String(invocation.rawInput || '').trim().split(/\s+/)
      if (sub !== 'create') return { kind: 'error', text: USAGE.pr }
      const git = await context()
      return {
        kind: 'success',
        text: buildPrInstruction({ title: rest.join(' '), branch: git.branch, base: git.base || 'main', repo: git.repo || (typeof repoHint === 'function' ? repoHint() : undefined), remoteUrl: git.remoteUrl }),
      }
    },
  }))

  disposers.push(commands.register({
    name: 'review',
    description: 'Review a GitHub pull request',
    input: { hint: '[number]' },
    handler: async (invocation) => {
      const raw = String(invocation.rawInput || '').trim()
      const number = /^\d+$/.test(raw) ? Number(raw) : undefined
      const git = await context()
      return {
        kind: 'success',
        text: buildReviewInstruction({ number, branch: git.branch, repo: git.repo || (typeof repoHint === 'function' ? repoHint() : undefined) }),
      }
    },
  }))

  disposers.push(commands.register({
    name: 'issue',
    description: 'Open, list or read GitHub issues',
    input: { hint: 'new <title> | list | show <number>' },
    handler: async (invocation) => {
      const [sub, ...rest] = String(invocation.rawInput || '').trim().split(/\s+/)
      const git = await context()
      const repo = git.repo || (typeof repoHint === 'function' ? repoHint() : undefined)
      if (sub === 'new') return { kind: 'success', text: buildIssueInstruction({ sub, title: rest.join(' '), repo }) }
      if (sub === 'show' && /^\d+$/.test(rest[0] || '')) return { kind: 'success', text: buildIssueInstruction({ sub, number: Number(rest[0]), repo }) }
      if (!sub || sub === 'list') return { kind: 'success', text: buildIssueInstruction({ sub: 'list', repo }) }
      return { kind: 'error', text: USAGE.issue }
    },
  }))

  disposers.push(commands.register({
    name: 'gh',
    description: 'Ask about the GitHub tools of this plugin',
    input: { hint: '[group|tool] [args]' },
    handler: async (invocation) => {
      const [first, ...rest] = String(invocation.rawInput || '').trim().split(/\s+/)
      const topic = first && TOOL_HINTS[first] ? first : undefined
      const tool = first && /^[a-z]+_/.test(first) ? first : (topic ? undefined : first)
      return { kind: 'success', text: buildGhInstruction({ topic, tool, args: rest.join(' ') }) }
    },
  }))

  return () => {
    for (const dispose of disposers) {
      try {
        if (typeof dispose === 'function') dispose()
      } catch {
        // a failing disposer must not stop the others
      }
    }
  }
}
