# dsh-github-ops

GitHub operations for [DeepSeek Harness](https://github.com/topics/dsh-plugin): releases,
tags, a guarded generic API pass-through, workflow runs, secrets and sanitized mirror
publication.

The plugin exists because the release pipeline needs operations the existing GitHub
plugin does not provide — releases and tags first, then a way to publish a GitHub mirror
that carries the **product** and not the whole development tree.

> **Status: work in progress, not released.** The public release happens only after the
> plugin carries the full tool set (see [Roadmap](#roadmap)).

## Install

```bash
dsh plugin --profile web add @goodandready/dsh-github-ops
```

Requires a GitHub token in the DSH credential service. Store the token under a name
(default `GITHUB_TOKEN`) and put only that **name** in the plugin settings.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `tokenEnv` | `GITHUB_TOKEN` | Name of the DSH credential holding the GitHub token. The token itself is never stored in settings. |
| `defaultRepository` | *(empty)* | `owner/repo` used by tools that omit `repository`. |
| `baseUrl` | `https://api.github.com` | API base; change it for GitHub Enterprise. |
| `timeoutMs` | `30000` | Per-request timeout. |

## Tools

### Releases

| Tool | What it does |
|---|---|
| `gh_release_list` | List releases, newest first (read-only). |
| `gh_release_view` | Read one release by tag: flags, notes, assets (read-only). |
| `gh_release_create` | Create a release for a tag, optionally on a specific commit. |
| `gh_release_edit` | Edit title, notes, draft/prerelease, and **which release is latest**. |
| `gh_release_delete` | Delete a release (requires `confirm: true`). |

`gh_release_edit` with `makeLatest: true` is the step that keeps the repository badge on
the current version: creating older releases afterwards otherwise moves “Latest” back.

### Tags

| Tool | What it does |
|---|---|
| `gh_tag_list` | List tags with their commit SHAs (read-only). |
| `gh_tag_create` | Create a tag — lightweight, or annotated when `message` is given. |
| `gh_tag_delete` | Delete a tag (requires `confirm: true`). |

### Generic API

`gh_api` reaches anything the typed tools do not cover (refs, rulesets, organizations,
gists). Reads are free. `POST`/`PATCH`/`PUT`/`DELETE` require `confirm: true`. Deleting a
repository, transferring a repository or deleting an organization is refused outright —
a single confirmation cannot make those safe.

## Safety

- The token lives in the DSH credential service; settings hold only its name.
- Read operations never change state; mutations are confirmed explicitly.
- The client never logs the token, and every failure is reported as a value
  (`ok: false` with `status`, `code`, `rateLimit`) instead of an exception.

## Roadmap

Release blockers, in order:

1. **Parity** — `pr_create`, `pr_update`, `pr_merge`, `gh_review`, `review_post`,
   `gh_issue`, `issue_open`, `issue_comment`, `issue_close`, `gh_search`,
   `gh_repo_search`, `gh_repo`, `gh_file`, `gh_checks`, `ci_run`.
2. **Mirror** — `gh_mirror_check`, `gh_mirror_publish`: sanitized product tree
   (allowlist from `package.json → files`), one commit on top of the mirror branch,
   fast-forward, never a force.
3. **Workflow runs** — `gh_run_list/view/rerun/cancel/logs`.
4. **Repository settings** — secrets, variables, rulesets, branch protection,
   `gh_repo_create`, `gh_repo_edit`.
5. Settings card in the plugins page, locales `en`/`zh`, design contract.

## Development

```bash
npm test        # node --test, no harness and no network: fetch is injected
```

Tests live next to the code they cover and never touch the network: the transport is a
parameter, so failure modes (404, rate limit, timeout, non-JSON body, short pages) are
exercised directly.

## License

MIT — see [LICENSE](LICENSE).
