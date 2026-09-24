# Task Plan — Release 1 Features (Issues #41, #42, #43, #44, #45)

## Goal
Implement 5 new features for Release 1 of `@goodandready/dsh-github-ops`:
1. `gh_release_asset_*` (Issue #41)
2. `gh_run_dispatch` (Issue #42)
3. `gh_run_log_summary` (Issue #43)
4. `gh_release_notes_generate` (Issue #44)
5. `pr_review_threads`, `pr_thread_reply`, `pr_thread_resolve` (Issue #45)

All features must strictly follow the safety contract (confirm for mutations, zero token leak, lossless JSON outputs), pass 100% offline tests with injected `fetchImpl`, update documentation (`DESIGN.md`, README-trio, `CHANGELOG.md`), and maintain code quality.

## Current Phase
All Phases Complete

## Next Step
Commit changes, push to origin, and create PR in Gitea.

## Phases

### Phase 1: Release Assets (`gh_release_asset_*`) [#41]
- [x] Add client methods `listReleaseAssets`, `uploadReleaseAsset`, `deleteReleaseAsset` in `lib/github.js`
- [x] Add tool functions in `lib/tools/releases.js`
- [x] Register tools in `lib/tools/register-core.js`
- [x] Add unit tests in `test/releases.test.mjs`
- [x] Verify lossless JSON and error handling
- Status: complete

### Phase 2: Workflow Dispatch (`gh_run_dispatch`) [#42]
- [x] Add client method `dispatchWorkflow` in `lib/github.js`
- [x] Add tool function in `lib/tools/actions.js`
- [x] Register tool in `lib/tools/register-ops.js`
- [x] Add unit tests in `test/ops.test.mjs`
- Status: complete

### Phase 3: CI Log Summary (`gh_run_log_summary`) [#43]
- [x] Add client method `getJobLog` in `lib/github.js`
- [x] Implement log cleaner: strip ANSI, mask secrets/paths, extract failure tail
- [x] Add tool function `gh_run_log_summary` in `lib/tools/actions.js`
- [x] Register tool in `lib/tools/register-ops.js`
- [x] Add unit tests in `test/ops.test.mjs`
- Status: complete

### Phase 4: Release Notes Generator (`gh_release_notes_generate`) [#44]
- [x] Add client method `generateReleaseNotes` in `lib/github.js`
- [x] Add tool function in `lib/tools/releases.js`
- [x] Register tool in `lib/tools/register-core.js`
- [x] Add unit tests in `test/releases.test.mjs`
- Status: complete

### Phase 5: PR Review Threads (`pr_review_threads`, `pr_thread_reply`, `pr_thread_resolve`) [#45]
- [x] Add GraphQL queries and mutations in `lib/github.js`
- [x] Implement tools in `lib/tools/pulls.js`
- [x] Register tools in `lib/tools/register-collab.js`
- [x] Add unit tests in `test/pulls.test.mjs`
- Status: complete

### Phase 6: Documentation, Preflight & Verification
- [x] Update `docs/design/DESIGN.md`
- [x] Update `README.md`, `README.ru.md`, `README.zh.md`
- [x] Update `CHANGELOG.md`
- [x] Run full test suite (`npm test`) on MiniAI
- [x] Git commit and push via `git-antigravity`
- [x] Open PR in Gitea
- Status: complete
EOF
