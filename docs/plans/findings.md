# Findings — Release 1 Features

## Architecture & Integration Points
1. `lib/github.js`:
   - Releases assets upload endpoint: uses `uploads.github.com` by default (or parsed from `upload_url`).
   - Workflow dispatch endpoint: `POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches`.
   - Actions logs endpoint: `GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs` (text/plain).
   - Release notes endpoint: `POST /repos/{owner}/{repo}/releases/generate-notes`.
   - GraphQL client already handles queries/mutations with variables and error parsing (`graphql(query, variables)`).
2. Safety & Contracts:
   - All mutations require `confirm: true`.
   - `lossless.js` wraps tool outputs automatically in `lib/index.js`.
   - `groupOf(toolName)` in `lib/index.js` routes tool names to tool groups. Need to ensure:
     - `gh_release_asset_*` -> `releases` (matches `/^gh_release_/`)
     - `gh_run_dispatch` -> `runs` (matches `/^gh_run_/`)
     - `gh_run_log_summary` -> `runs` (matches `/^gh_run_/`)
     - `gh_release_notes_generate` -> `releases` (matches `/^gh_release_/`)
     - `pr_review_threads`, `pr_thread_reply`, `pr_thread_resolve` -> `pull-requests` (matches `/^pr_/`)
3. Locale and guidance:
   - English source, Chinese locale strings in client/guidance if exposed in UI, Russian comes from `dsh-russian-lang`.

## Issue #38 Findings
- GitHub client cache previously keyed on `access.value.length`. Because many GitHub tokens share standard lengths (e.g. 40 characters for PATs and OAuth tokens), token rotation to another account or a new token with the same length left the client pointing to the stale token.
- Using a 16-character sha256 hex digest (`tokenFingerprint`) guarantees unique cache keys without exposing or logging the secret.
