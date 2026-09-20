# 📦 @goodandready/dsh-github-ops

<div align="center">

<h3>Advanced GitHub Operations, Releases, CI Runs, Secrets & Sanitized Mirrors for DeepSeek Harness</h3>

<p align="center">
  <a href="https://www.npmjs.com/package/@goodandready/dsh-github-ops"><img src="https://img.shields.io/npm/v/@goodandready/dsh-github-ops.svg?style=for-the-badge&color=6366f1&labelColor=1e1b4b" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/GooDAnDReaDY/dsh-github-ops.svg?style=for-the-badge&color=10b981&labelColor=064e3b" alt="license"></a>
  <a href="https://github.com/topics/dsh-plugin"><img src="https://img.shields.io/badge/DSH-Plugin-8b5cf6.svg?style=for-the-badge&labelColor=2e1065" alt="DSH Plugin"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/Node-20%2B-f59e0b.svg?style=for-the-badge&labelColor=451a03" alt="Node version"></a>
</p>

<p align="center">
  <a href="https://goodandready.app/"><img src="https://img.shields.io/badge/All_Author_Projects-goodandready.app-ff4500.svg?style=for-the-badge&logo=rocket&logoColor=white&labelColor=1a1a2e" alt="All Author Projects"></a>
</p>

<p align="center">
  <a href="README.md"><b>🇬🇧 English</b></a> •
  <a href="README.zh.md"><b>🇨🇳 中文说明</b></a> •
  <a href="README.ru.md"><b>🇷🇺 Русский</b></a>
</p>

<table align="center">
  <tr>
    <td align="center">
      ⭐ <strong>If you like this plugin, please star it on GitHub</strong> — it shows me that the plugin is useful to you and motivates me to keep developing it.
      <br><br>
      🐛 <strong>If you find a bug or would like to request a feature</strong>, open a GitHub issue in any language — I will review your proposal and implement useful suggestions in a future plugin version.
    </td>
  </tr>
</table>

</div>

---

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
| `tokenEnv` | `GITHUB_TOKEN` | Name looked up in the DSH credentials, then the environment, then the `gh` CLI. The value is never stored in settings. |
| `tokenSource` | `auto` | Where access comes from: `auto` tries the DSH credential, then the environment variable, then the `gh` CLI session; pin it to `credentials`, `env` or `gh`. |
| `defaultRepository` | *(empty)* | `owner/repo` used by tools that omit `repository`. |
| `baseUrl` | `https://api.github.com` | API base; change it for GitHub Enterprise. |
| `timeoutMs` | `30000` | Per-request timeout. |
| `maxRetries` | `2` | Retries for a failed read (never for a write). |
| `reviewRulesJson` | *(empty)* | Review-rule overrides as JSON: `sensitivePaths`, `sensitiveSeverity`, `attentionPaths`, `migrationPaths`, `testsRequired`, `sourcePatterns`, `testPatterns`, `largeDiffLines`. |
| `approvalMode` | `auto` | `auto` lets agreed non-destructive writes through without a prompt; deleting a release, tag, secret, variable, ruleset or branch protection, and cancelling a run, always ask. `ask` asks on every write; `off` leaves approvals to the host. |
| `allowedActions` | *(all)* | Write actions the plugin may perform; anything else is denied. Each one still asks. |
| `autoApprove` | *(empty)* | Actions an unattended run (`DSH_GITHUB_OPS_UNATTENDED=1`) may perform without asking. Destructive actions are never auto-approved. |
| `reviewJobTimeoutMs` | `120000` | How long a background review job may run. |

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

### Issues and pull requests

| Tool | What it does |
|---|---|
| `gh_issue` | List or read issues (`action: list\|get\|comments`); pull requests come back as `kind: "pr"`. |
| `issue_open`, `issue_comment`, `issue_close` | Create an issue, comment on an issue or PR, close it (optionally with a state reason). |
| `gh_search` | Search issues and PRs with GitHub search syntax (separate quota). |
| `pr_create`, `pr_update` | Open a pull request from a head branch; edit title, body, state or base. |
| `pr_merge` | Merge a PR (merge/squash/rebase), optionally deleting the head branch. |
| `gh_review` | One review pack: metadata, areas, capped diff, comments, CI rollup and deterministic findings (secrets, migrations, CI config, source without tests, large diff). |
| `review_post` | Publish a review as one summary comment, or as line-anchored inline comments. |
| `gh_checks` | Check runs, legacy statuses and one rollup verdict for a commit. |
| `ci_run` | One-shot review of a PR with a rule-based verdict. |

### Mirror publication

| Tool | What it does |
|---|---|
| `gh_mirror_check` | Read-only plan: which product files would reach the mirror, how many stay behind, and why a publication must be refused. |
| `gh_mirror_publish` | Publish the sanitized tree: one commit on top of the mirror branch, fast-forward, **never a force**. `dryRun: true` previews; writing needs `confirm: true`. |

The allowlist is the package manifest's own `files` plus `.gitignore`, `LICENSE`,
README trio, `CHANGELOG.md` and `cordis.patch.yml`. `docs/**` and agent instructions are
forbidden even when a manifest lists them; shipped tooling such as `scripts/**` is
published because it is part of the package.

### Workflow runs

| Tool | What it does |
|---|---|
| `gh_run_list`, `gh_run_view` | List runs (branch, workflow, status filters) and read one run. |
| `gh_run_jobs` | Jobs with their steps, and the steps that failed — usually enough to diagnose a failure. |
| `gh_run_rerun`, `gh_run_cancel` | Re-run all or only failed jobs; cancel an in-progress run (needs `confirm: true`). |
| `gh_run_logs` | Returns the logs archive URL: GitHub answers with a redirect to a zip, which is not pulled into the conversation. |

### Repository settings

| Tool | What it does |
|---|---|
| `gh_variable_list/set/delete` | Actions variables, repository-wide or per environment. |
| `gh_secret_list/set/delete` | Actions secrets. Setting one uses sealed-box encryption through the optional `tweetnacl` package; without it the tool says what to install instead of writing a broken value. |
| `gh_ruleset_list/view/apply/delete` | Repository rulesets: read, create, update, delete. |
| `gh_branch_protection_get/set/delete` | Classic branch protection: required reviews, status checks, admin enforcement, force-push and deletion flags. |

## Background reviews and commands

`gh_review_job` starts a review and returns a job id immediately; `gh_review_job_status`
reports it. With a host job registry the work is visible and cancellable in the UI; without
one it runs inside the plugin.

Slash commands are the fast path for a human:

| Command | What it does |
|---|---|
| `/pr create [title]` | Reads the current branch and origin, then instructs the model to call `pr_create`. |
| `/review [number]` | Reviews a pull request (or the one for the current branch). |
| `/issue new <title>` \| `/issue list` \| `/issue show <number>` | Opens, lists or reads issues. |
| `/gh [group\|tool]` | Points at the tools for releases, tags, mirror, runs, secrets, variables, rulesets or branch protection. |

A command never writes to GitHub itself: it hands the model an instruction, so the write
still passes through the approval gate.

## Safety

- The token lives in the DSH credential service; settings hold only its name.
- Read operations never change state; mutations are confirmed explicitly, and deleting a
  repository, transferring one or deleting an organization is refused outright.
- The client never logs the token, and every failure is reported as a value
  (`ok: false` with `status`, `code`, `rateLimit`) instead of an exception.
- Findings from `gh_review` are deterministic rules: they point at what needs attention
  and are never presented as a verdict on correctness.

## Roadmap

Everything planned for the first release is implemented. What remains is the release
process itself:

1. Preflight (`dsh-plugin-preflight`) and the package check.
2. Verification of the exact `.tgz` on the isolated DSH test server.
3. Acceptance of the same candidate on production.
4. Translation notes for `dsh-russian-lang`.
5. Public release (npm + GitHub) after an explicit go-ahead.

## Development

```bash
npm test        # node --test, no harness and no network: fetch is injected
```

Tests live next to the code they cover and never touch the network: the transport is a
parameter, so failure modes (404, rate limit, timeout, non-JSON body, short pages) are
exercised directly.

## License

MIT — see [LICENSE](LICENSE).
