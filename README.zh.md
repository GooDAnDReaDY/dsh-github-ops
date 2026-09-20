# dsh-github-ops

面向 [DeepSeek Harness](https://github.com/topics/dsh-plugin) 的 GitHub 操作插件：发布（release）、
标签（tag）、受保护的通用 API 直通、工作流运行、密钥，以及经过净化的镜像发布。

插件的存在理由：发布流水线需要现有 GitHub 插件没有提供的能力——首先是 release 和 tag，
其次是只发布**产品**、而不是整个开发树的 GitHub 镜像。

> **状态：开发中，尚未发布。** 只有在插件具备完整工具集之后才会公开发布（见[路线图](#路线图)）。

## 安装

```bash
dsh plugin --profile web add @goodandready/dsh-github-ops
```

需要在 DSH 凭据服务中保存 GitHub token。默认凭据名为 `GITHUB_TOKEN`，插件设置里只保存
这个**名称**。

## 设置

| 设置 | 默认值 | 含义 |
|---|---|---|
| `tokenEnv` | `GITHUB_TOKEN` | 依次在 DSH 凭据、环境变量与 `gh` CLI 中查找该名称；取值本身不写入设置。 |
| `tokenSource` | `auto` | 访问来源：`auto` 依次尝试 DSH 凭据、环境变量与 `gh` CLI 会话；可固定为 `credentials`、`env` 或 `gh`。 |
| `defaultRepository` | 空 | 未传 `repository` 时使用的 `owner/repo`。 |
| `baseUrl` | `https://api.github.com` | API 地址，GitHub Enterprise 时修改。 |
| `timeoutMs` | `30000` | 单次请求超时。 |
| `maxRetries` | `2` | 读取失败时的重试次数（写入不重试）。 |
| `reviewRulesJson` | 空 | 以 JSON 覆盖评审规则：`sensitivePaths`、`sensitiveSeverity`、`attentionPaths`、`migrationPaths`、`testsRequired`、`sourcePatterns`、`testPatterns`、`largeDiffLines`。 |
| `allowedActions` | 全部 | 允许执行的写操作；其余一律拒绝，且每个都会询问确认。 |
| `autoApprove` | 空 | 非交互运行（`DSH_GITHUB_OPS_UNATTENDED=1`）可免除询问的操作；破坏性操作永远不会被自动批准。 |
| `reviewJobTimeoutMs` | `120000` | 后台评审任务的最长运行时间。 |

## 工具

### Release

| 工具 | 作用 |
|---|---|
| `gh_release_list` | 按时间倒序列出 release（只读）。 |
| `gh_release_view` | 按 tag 读取单个 release：标记、说明、附件（只读）。 |
| `gh_release_create` | 为 tag 创建 release，可指定 commit。 |
| `gh_release_edit` | 修改标题、说明、draft/prerelease，以及**哪个 release 是 latest**。 |
| `gh_release_delete` | 删除 release（需要 `confirm: true`）。 |

`gh_release_edit` 配合 `makeLatest: true` 是保持仓库徽章指向当前版本的关键一步：之后再创建
旧版本的 release 会把 “Latest” 移回旧版本。

### Tag

| 工具 | 作用 |
|---|---|
| `gh_tag_list` | 列出 tag 及其 commit SHA（只读）。 |
| `gh_tag_create` | 创建 tag；带 `message` 时创建附带注释的 tag。 |
| `gh_tag_delete` | 删除 tag（需要 `confirm: true`）。 |

### 通用 API

`gh_api` 用于覆盖类型化工具未涉及的接口（refs、rulesets、organization、gist）。读取无需确认；
`POST`/`PATCH`/`PUT`/`DELETE` 需要 `confirm: true`。删除仓库、转移仓库、删除组织会被直接拒绝——
这类操作无法靠一次确认变得安全。

### Issue 与 Pull Request

| 工具 | 作用 |
|---|---|
| `gh_issue` | 列出或读取 issue（`action: list/get/comments`）；PR 以 `kind: "pr"` 返回。 |
| `issue_open`、`issue_comment`、`issue_close` | 创建 issue、评论、关闭（可带原因）。 |
| `gh_search` | 使用 GitHub 搜索语法检索 issue 与 PR（独立配额）。 |
| `pr_create`、`pr_update` | 从 head 分支创建 PR；修改标题、正文、状态或目标分支。 |
| `pr_merge` | 合并 PR（merge/squash/rebase），可选择删除 head 分支。 |
| `gh_review` | 一个完整评审包：元数据、涉及范围、限量 diff、评论、CI 汇总与确定性发现（密钥、迁移、CI 配置、改源码未改测试、超大 diff）。 |
| `review_post` | 发布评审：一条汇总评论，或按行内联评论。 |
| `gh_checks` | 某个提交的 check runs、旧式状态与统一结论。 |
| `ci_run` | 对 PR 做一次性评审并给出基于规则的结论。 |

### 镜像发布

| 工具 | 作用 |
|---|---|
| `gh_mirror_check` | 只读计划：哪些产品文件会进入镜像、多少文件会留在原地、以及为何必须拒绝发布。 |
| `gh_mirror_publish` | 发布净化后的树：在镜像分支之上一个提交，fast-forward，**绝不 force**。`dryRun: true` 仅预览；写入需要 `confirm: true`。 |

白名单取自包清单自身的 `files`，加上 `.gitignore`、`LICENSE`、README 三件套、
`CHANGELOG.md` 和 `cordis.patch.yml`。即使清单里列了 `docs/**` 与代理说明文件也会被禁止；
像 `scripts/**` 这种随包发布的工具则会进入镜像，因为它属于包内容。

### 工作流运行

| 工具 | 作用 |
|---|---|
| `gh_run_list`、`gh_run_view` | 列出运行（可按分支、工作流、状态过滤）与读取单个运行。 |
| `gh_run_jobs` | 作业及其步骤，并单独列出失败的步骤——通常足以定位失败原因。 |
| `gh_run_rerun`、`gh_run_cancel` | 重跑全部或仅失败作业；取消进行中的运行（需要 `confirm: true`）。 |
| `gh_run_logs` | 返回日志压缩包地址：GitHub 以 302 指向 zip，不会把二进制拉进对话。 |

### 仓库设置

| 工具 | 作用 |
|---|---|
| `gh_variable_list/set/delete` | Actions 变量，仓库级或按环境。 |
| `gh_secret_list/set/delete` | Actions 密钥。写入使用 sealed-box 加密，需要可选的 `tweetnacl`；缺失时会明确说明需要安装什么，而不是写入无效值。 |
| `gh_ruleset_list/view/apply/delete` | 仓库 ruleset：读取、创建、更新、删除。 |
| `gh_branch_protection_get/set/delete` | 经典分支保护：必需评审、状态检查、管理员强制、force push 与删除开关。 |

### 插件设置卡片

设置在插件自己的页面上（插件列表座位 `plugins.item`，并保留行座位与旧版
`settings.plugin.item`）：凭据名称、默认仓库、API 地址、请求超时。卡片会检查设置快照的
**状态**，在设置服务不可用时明确说明，而不是画出一个看似可用的表单。

## 后台评审与斜杠命令

`gh_review_job` 立即返回任务 id，`gh_review_job_status` 读取结果。宿主提供任务注册表时，
任务可在界面中查看与取消；否则在插件内部运行。

斜杠命令是人类的快捷入口：`/pr create [title]`、`/review [number]`、
`/issue new <title> | list | show <number>`、`/gh [分组|工具]`。命令本身**不会**写入 GitHub，
只是把指令交给模型，因此写入仍然经过审批关卡。

## 安全边界

- token 只存在于 DSH 凭据服务，设置中只有名称；
- 读取操作不改变状态，写入必须显式确认；删除仓库、转移仓库、删除组织会被直接拒绝；
- 客户端不会输出 token，失败以返回值形式报告（`ok: false` 及 `status`、`code`、`rateLimit`），
  不会中断整个回合；
- `gh_review` 的发现是确定性规则：指出需要关注的地方，绝不冒充正确性结论。

## 路线图

按顺序的发布阻塞项：

1. **功能对齐** —— `pr_create`、`pr_update`、`pr_merge`、`gh_review`、`review_post`、
   `gh_issue`、`issue_open`、`issue_comment`、`issue_close`、`gh_search`、
   `gh_repo_search`、`gh_repo`、`gh_file`、`gh_checks`、`ci_run`。
2. **镜像** —— `gh_mirror_check`、`gh_mirror_publish`：净化后的产品树（白名单取自
   `package.json → files`），在镜像分支之上一个提交，fast-forward，绝不 force。
3. **工作流运行** —— `gh_run_list/view/rerun/cancel/logs`。
4. **仓库设置** —— secrets、variables、rulesets、分支保护、`gh_repo_create`、`gh_repo_edit`。
5. 插件页设置卡片、`en`/`zh` 语言包、设计契约。

## 开发

```bash
npm test        # node --test，不需要 harness，也不访问网络：fetch 是注入的
```

## 许可证

MIT —— 见 [LICENSE](LICENSE)。
