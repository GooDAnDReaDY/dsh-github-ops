# Changelog

Notable changes to `@goodandready/dsh-github-ops`.

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
