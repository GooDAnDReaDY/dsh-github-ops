// What the model is told about this plugin.
//
// A plugin with 50+ tools needs one short paragraph about how to use them, otherwise the
// model guesses: which tool for which question, when a repository argument may be omitted,
// and that approvals are the host's business rather than something these tools invent.

/** Section name in the system prompt; unique, so a reload replaces it instead of clashing. */
export const GUIDANCE_SECTION = 'dsh-github-ops'

/** Placement among the other sections. */
export const GUIDANCE_ORDER = 60

/** The default text. Keep it short: it is paid for on every turn. */
export const GUIDANCE_TEXT = [
  'GitHub (dsh-github-ops):',
  '- Unsure which tool fits? gh_help lists every one of them, grouped by area.',
  '- Inside a checkout the repository argument can be omitted: the origin remote decides. Both "owner/repo#12" and a bare "12" are accepted.',
  '- Prefer one composed call over many plain ones: gh_repo_report (what a repository is), gh_weekly_digest (what happened lately), gh_repo_health (what to fix), gh_review (a pull request as one pack), ci_run (a deterministic verdict).',
  '- Reads are free. Deleting a file, a branch, a tag, a release, a secret or a ruleset, forcing a ref, and publishing a mirror need confirm: true; approvals themselves belong to the host, not to these tools.',
  '- A failure states the next step; gh_auth_status says where the access comes from.',
].join('\n')

/** The text to register: the configured override, or the default. */
export function guidanceText(configured) {
  return configured && String(configured).trim() ? String(configured).trim() : GUIDANCE_TEXT
}
