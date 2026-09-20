// Mirror tool registrations: a read-only plan and a sanitized publication.
//
// These work on a local checkout: the caller names the working copy, the source ref and
// the mirror remote. `gh_mirror_publish` refuses to run without confirm: true, refuses
// a plan with a forbidden path in the allowlist or a missing product file, and always
// pushes a fast-forward on top of the mirror branch — never a force.

import { planMirror, publishMirror, DEFAULT_ALLOW, DEFAULT_FORBIDDEN, DEFAULT_REQUIRED } from './mirror.js'

const MIRROR_PARAMS = {
  cwd: { type: 'string', description: 'Absolute path of the local checkout to publish from. Defaults to the session working directory.' },
  ref: { type: 'string', description: 'Source ref to publish, e.g. origin/main (default).' },
  mirror: { type: 'string', description: 'Mirror remote name (default github).' },
  branch: { type: 'string', description: 'Mirror branch (default main).' },
}

export function registerMirrorTools({ tool, git, defaultCwd }) {
  const where = (args) => ({ cwd: args.cwd || defaultCwd(), ref: args.ref || 'origin/main' })

  tool(
    'gh_mirror_check',
    'Show what a sanitized GitHub mirror publication would contain: the product files from the package manifest that would be published, how many files would stay behind, and whether the publication must be refused (a forbidden path in the allowlist, or a missing product file). Read-only: nothing is written or pushed.',
    {
      ...MIRROR_PARAMS,
      allow: { type: 'array', items: { type: 'string' }, description: 'Override the allowlist (defaults to the package manifest "files" plus README/LICENSE/CHANGELOG).' },
      required: { type: 'array', items: { type: 'string' }, description: 'Files that must be present (default package.json and README.md).' },
    },
    async (args) => {
      const plan = await planMirror({
        git,
        ...where(args),
        allow: args.allow,
        required: args.required && args.required.length ? args.required : DEFAULT_REQUIRED,
        forbidden: DEFAULT_FORBIDDEN,
      })
      return {
        mirror: `${args.mirror || 'github'}/${args.branch || 'main'}`,
        sourceCommit: plan.sha,
        willPublish: plan.publish,
        willPublishCount: plan.publish.length,
        willDropCount: plan.drop.length,
        refused: plan.refused,
      }
    },
  )

  tool(
    'gh_mirror_publish',
    'Publish the sanitized product tree to the GitHub mirror: one commit on top of the mirror branch, pushed as a fast-forward (never a force, mirror history is not rewritten). Refuses when the allowlist contains a forbidden path or a required product file is missing. Pass dryRun: true to see the plan without writing; publishing itself needs confirm: true.',
    {
      ...MIRROR_PARAMS,
      allow: { type: 'array', items: { type: 'string' }, description: 'Override the allowlist.' },
      required: { type: 'array', items: { type: 'string' }, description: 'Files that must be present.' },
      message: { type: 'string', description: 'Commit message for the mirror commit.' },
      dryRun: { type: 'boolean', description: 'Plan only: nothing is committed or pushed.' },
      confirm: { type: 'boolean', description: 'Must be true to write to the mirror.' },
    },
    async (args) => {
      const dryRun = args.dryRun === true
      if (!dryRun && args.confirm !== true) {
        throw new Error('refusing to publish to a mirror without confirm: true (or pass dryRun: true to preview)')
      }
      const result = await publishMirror({
        git,
        ...where(args),
        mirror: args.mirror || 'github',
        branch: args.branch || 'main',
        allow: args.allow && args.allow.length ? args.allow : undefined,
        required: args.required && args.required.length ? args.required : DEFAULT_REQUIRED,
        forbidden: DEFAULT_FORBIDDEN,
        message: args.message,
        dryRun,
      })
      return {
        mirror: result.mirror,
        pushed: result.pushed,
        commit: result.commit,
        parent: result.parent,
        correspondence: result.correspondence,
        willPublishCount: result.publish.length,
        willDropCount: result.drop.length,
        dryRun,
      }
    },
  )
}

export { DEFAULT_ALLOW, DEFAULT_FORBIDDEN, DEFAULT_REQUIRED }
