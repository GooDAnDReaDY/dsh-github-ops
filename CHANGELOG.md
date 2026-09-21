# Changelog

Notable changes to `@goodandready/dsh-github-ops`.

## 0.2.0

The development wave: reliability, reports, writing without a checkout, and the user surfaces.

### Reliability and reach
- a short TTL read cache (`cacheTtlMs`) so a composed report does not spend the rate limit
  twice; writes always go to the network and clear the cache;
- the turn's cancellation reaches the request in flight, and a cancelled call says so instead
  of pretending to be a timeout; reads retry on a network failure, a timeout or a 5xx, and a
  429 is honoured through `Retry-After` or the rate-limit reset;
- every list is cut locally as well, because GitHub sometimes ignores the page size;
- failures say what to do next (401, 403, 404, 409, 422, timeouts, a broken `/etc/hosts`);
- `gh_help` lists every tool, grouped by area, built from the registrations;
- a short paragraph in the system prompt explains how to use them (`guidance`, `guidanceText`).

### Reports
- `gh_repo_report`, `gh_weekly_digest`, `gh_notifications`, `gh_repo_health`, `gh_compare`,
  `gh_trending`, `gh_contributors`, `gh_user_repos`, `gh_commits`.

### Writing without a checkout, and signing in
- `gh_repo_tree`, `gh_push_files` (blobs, tree, commit, ref — `force` never implied),
  `gh_upload_project`, `gh_delete_file`, `gh_delete_branch`;
- `gh_auth_login` / `gh_auth_finish` / `gh_auth_status` / `gh_auth_logout`: GitHub device flow,
  stored in the plugin's own file with mode 0600 and never returned in a result. The access
  chain is now credentials → environment → this plugin's sign-in → `gh` CLI.

### User surfaces
- the access status in the plugin card (source, account, scopes, rate limit, cache) from a
  local-only host route;
- a **Source Control** tab in the session view ring: repository header, change groups, diff
  viewer, merge/rebase state, branches, tags and stashes — read-only for now;
- a **GitHub panel** in the sidebar (better-sidebar and the built-in right sidebar): repository
  switcher, Code tree with file preview, Issues, Pull requests, Actions and an inbox;
- a pull request bar above the composer that hands an instruction to the composer instead of
  writing by itself, and opt-in remembering of the repository behind a github.com link;
- `docs/design/DESIGN.md` describes all of it, with the states and the locked decisions.

## 0.1.2

- Removed the write-approval contour the plugin never should have had: no `tools/pre-execute`
  listener, no `allowedActions`, `autoApprove` or `approvalMode`, no action map. Approvals are
  the host's business (the permission policy and dsh-approval-gate); a GitHub tool plugin that
  registers its own gate duplicates the contour and, in a session where prompts are disabled,
  turns every agreed write into a rejection — which is exactly what happened on 20.09.2026.
  The `confirm` flags and the outright refusals (deleting or transferring a repository,
  deleting an organization) stay: those are this plugin's own contract.

## 0.1.1 — released

- `approvalMode` with "auto" as the default: an agreed, non-destructive write goes through
  without a prompt, so a session whose host has approval prompts disabled is not blocked by a
  question it cannot answer. Deleting a release, a tag, a secret, a variable, a ruleset,
  cancelling a run or removing branch protection still asks, and where prompts are
  unavailable that means it is refused — never automatic. "ask" prompts on every write;
  "off" leaves the decision entirely to the host approval contour.
- `allowedActions` is the fence in every mode: an action outside it is denied outright.
- The setting is editable in the card (a three-option select) and documented in all three
  READMEs.

## 0.1.0 — first release

The plugin is **not released yet**: it must first carry the full tool set — parity with
the reference GitHub plugin plus the operations our release pipeline needs.

### Added
- GitHub API client (`lib/github.js`): REST v3 and GraphQL v4 behind one transport that
  is injected (`fetchImpl`), so every caller and every test runs without a network.
  Failures are normalized into one shape — `status`, `code` (`http_error`,
  `rate_limited`, `timeout`, `network`, `graphql_error`), `rateLimit` with the reset
  time — so a tool never throws a turn away because GitHub answered 404 or 403.
- Release tools: `gh_release_list`, `gh_release_view`, `gh_release_create`,
  `gh_release_edit` (including `makeLatest`), `gh_release_delete`.
- Tag tools: `gh_tag_list`, `gh_tag_create` (lightweight or annotated), `gh_tag_delete`.
- `gh_api`: guarded generic pass-through — reads are free, `POST`/`PATCH`/`PUT`/`DELETE`
  require `confirm: true`, and deleting a repository, transferring one or deleting an
  organization is refused outright.
- Tests without a harness and without a network: 51 cases covering URL building, error
  mapping, rate limits, timeouts, pagination, GraphQL, tag object ordering, base64 file
  decoding, issue normalization, diff truncation, the CI rollup and the `gh_api` safety
  boundary.
- Repository tools: `gh_repo`, `gh_file` (file content at a ref, or a directory
  listing), `gh_repo_search`, `gh_repo_create`, `gh_repo_edit`.
- Issue tools: `gh_issue`, `issue_open`, `issue_comment`, `issue_close`, `gh_search`.
- Pull request tools: `pr_create`, `pr_update`, `pr_merge` (merge/squash/rebase,
  optional head-branch delete), `gh_review` (metadata, areas, capped diff, comments,
  CI rollup and deterministic findings), `review_post` (summary or inline),
  `gh_checks`, `ci_run` (one-shot review with a rule-based verdict).

- Mirror tools: `gh_mirror_check` (read-only plan: what would be published, what stays
  behind, and why a publication must be refused) and `gh_mirror_publish` (one commit on
  top of the mirror branch, fast-forward, never a force; `dryRun`, `confirm: true`).
  The allowlist is the package manifest's own `files` plus README/LICENSE/CHANGELOG/
  `cordis.patch.yml`; `docs/**` and agent instructions are forbidden even when a manifest
  lists them, while shipped tooling such as `scripts/**` is published because it is part
  of the package.
- Workflow-run tools: `gh_run_list`, `gh_run_view`, `gh_run_jobs` (failed steps named),
  `gh_run_rerun` (all or failed-only), `gh_run_cancel`, `gh_run_logs` (returns the zip
  URL instead of pulling a binary into the conversation).
- Repository settings tools: `gh_variable_list/set/delete`, `gh_secret_list/set/delete`,
  `gh_ruleset_list/view/apply/delete`, `gh_branch_protection_get/set/delete`.
  Setting a secret uses GitHub sealed-box encryption through the optional `tweetnacl`
  package; without it the tool explains what to install rather than writing a broken
  value.
- Browser half: a settings card on the plugin's own page (the plugin-list seat
  `plugins.item`, plus the row seat and the legacy `settings.plugin.item` card) with
  locales `en`/`zh`, a snapshot-status check so an unavailable settings service is stated
  instead of hidden, all-changed-fields saving with per-field failure reporting, and a
  style element tagged `data-dsh-plugin="dsh-github-ops"`.

### Planned (release blockers)
- Release notes for `dsh-russian-lang` (the card adds no new user-facing strings beyond
  the four settings, but the translation issue must be filed before publishing).
- Verification on the isolated DSH test server, then acceptance on production, then the
  public release (npm + GitHub) after an explicit go-ahead.
