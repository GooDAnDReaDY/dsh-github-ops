# Changelog

Notable changes to `@goodandready/dsh-github-ops`.

## 0.1.0 — work in progress

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

### Planned (release blockers)
- Mirror tools: `gh_mirror_check`, `gh_mirror_publish` (sanitized product tree,
  fast-forward, never a force).
- Workflow tools: `gh_run_list`, `gh_run_view`, `gh_run_rerun`, `gh_run_cancel`,
  `gh_run_logs`.
- Repository settings tools: `gh_secret_set/list`, `gh_variable_set/list`,
  `gh_ruleset_list/apply`, `gh_branch_protection_get/set`, `gh_repo_create`,
  `gh_repo_edit`.
- Settings card in the plugins page (the `plugins.item` seat), locales `en`/`zh`,
  design contract, release notes for `dsh-russian-lang`.
