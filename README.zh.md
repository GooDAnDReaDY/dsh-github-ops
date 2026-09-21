# 📦 @goodandready/dsh-github-ops

<div align="center">

<h3>面向 DeepSeek Harness 的高级 GitHub 操作、发布、CI 运行、密钥与净化镜像套件</h3>

<p align="center">
  <a href="https://www.npmjs.com/package/@goodandready/dsh-github-ops"><img src="https://img.shields.io/npm/v/@goodandready/dsh-github-ops.svg?style=for-the-badge&color=6366f1&labelColor=1e1b4b" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/GooDAnDReaDY/dsh-github-ops.svg?style=for-the-badge&color=10b981&labelColor=064e3b" alt="license"></a>
  <a href="https://github.com/topics/dsh-plugin"><img src="https://img.shields.io/badge/DSH-Plugin-8b5cf6.svg?style=for-the-badge&labelColor=2e1065" alt="DSH Plugin"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/Node-20%2B-f59e0b.svg?style=for-the-badge&labelColor=451a03" alt="Node version"></a>
</p>

<p align="center">
  <a href="https://goodandready.app/"><img src="https://img.shields.io/badge/作者全部项目-goodandready.app-ff4500.svg?style=for-the-badge&logo=rocket&logoColor=white&labelColor=1a1a2e" alt="作者全部项目"></a>
</p>

<p align="center">
  <a href="README.md"><b>🇬🇧 English</b></a> •
  <a href="README.zh.md"><b>🇨🇳 中文说明</b></a> •
  <a href="README.ru.md"><b>🇷🇺 Русский</b></a>
</p>

<table align="center">
  <tr>
    <td align="center">
      ⭐ <strong>如果您喜欢这个插件，请在 GitHub 上为它点亮 Star</strong> — 这能让我知道插件对您有用，并鼓励我继续开发和维护它。
      <br><br>
      🐛 <strong>如果您发现 Bug 或希望增加功能</strong>，请使用任意语言在 GitHub 上提交 Issue — 我会评估您的建议，并在后续版本中实现有价值的改进。
    </td>
  </tr>
</table>

</div>

---

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
| `reviewJobTimeoutMs` | `120000` | 后台评审任务的最长运行时间。 |
| `cacheTtlMs` | `60000` | 读取结果在内存缓存中的存活时间。写入始终访问网络并清空缓存；设为 `0` 关闭缓存。 |
| `interceptLinks` | `false` | 允许会话中点击的 `github.com` 链接记录仓库，供 Source Control 标签页与侧边栏面板跟随。无论如何链接都会在浏览器中打开。 |
| `guidance` | `true` | 在系统提示中加入一段关于本插件的简短说明。 |
| `guidanceText` | *(空)* | 用自定义文本替换该说明。 |
| `oauthClientId` | 公开的 `gh` CLI 应用 | `gh_auth_login` 使用的 OAuth 应用。 |
| `oauthScope` | `repo workflow gist read:org` | `gh_auth_login` 请求的权限范围。 |
| `oauthClientSecretRef` | *(空)* | 可选的、保存 OAuth 客户端密钥的凭据名称。 |
| `accessFile` | `$DSH_HOME/github-ops-auth.json` | `gh_auth_login` 保存登录信息的位置（权限 `0600`）。 |

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

### 报告

| 工具 | 作用 |
|---|---|
| `gh_repo_report` | 一次调用给出仓库全貌：概览、最新 Release、打开的 Issue、近期提交、主要贡献者。某一部分失败只影响该部分，不会让整份报告失败。 |
| `gh_weekly_digest` | 时间窗口内发生了什么：Release、新 Issue、已合并或关闭的 PR、提交。PR 单独统计，不会被当作“新 Issue”。 |
| `gh_notifications` | 账号的关注队列——提及、评审请求、指派——按原因分组。 |
| `gh_repo_health` | 透明的维护评分：五个加权维度，每项都带证据，另有风险与具体下一步。它是基于公开信号的启发式判断，不是安全审计。 |
| `gh_compare` | 两个仓库并排比较，给出星标、Fork、打开 Issue 的数值差异。 |
| `gh_contributors` | 按提交数排列的主要贡献者。 |
| `gh_user_repos` | 用户或组织的仓库，按星标排序。 |
| `gh_trending` | 近期创建的热门仓库，可按语言筛选（消耗搜索配额）。 |
| `gh_commits` | 近期提交，可按时间与分支过滤。 |
| `gh_help` | 本插件的全部工具，按领域分组，由注册表生成，不会过期。 |

### 文件与分支

无需本地检出即可发布内容：提交按 git 的方式组装。

| 工具 | 作用 |
|---|---|
| `gh_repo_tree` | 指定 ref 的文件树，默认递归，并给出截断标志——比逐层遍历目录便宜得多。 |
| `gh_push_files` | 向分支提交文件：blob → 基于分支树的 tree → commit → 移动 ref。分支不存在会创建。`force` 绝不隐含，且需要 `confirm: true`。 |
| `gh_upload_project` | 创建仓库、发布文件并可选地打开 PR——一次调用。仓库已存在时直接使用，而不是失败。 |
| `gh_delete_file` | 删除单个文件（先解析 blob sha）。需要 `confirm: true`。 |
| `gh_delete_branch` | 删除分支。需要 `confirm: true`。 |

### 账号与登录

| 工具 | 作用 |
|---|---|
| `gh_auth_login` | 启动 GitHub device flow 登录：返回短码与供人工确认的网址。 |
| `gh_auth_finish` | 收取已启动的登录。授权值写入本插件自己的文件（权限 `0600`），绝不会出现在工具结果里。 |
| `gh_auth_status` | 访问来源（凭据、环境变量、本插件登录、`gh` CLI）、账号、已授权范围与剩余速率限制。 |
| `gh_auth_logout` | 忘记本插件保存的登录；其他来源不受影响。需要 `confirm: true`。 |

## 后台评审与斜杠命令

`gh_review_job` 立即返回任务 id，`gh_review_job_status` 读取结果。宿主提供任务注册表时，
任务可在界面中查看与取消；否则在插件内部运行。

斜杠命令是人类的快捷入口：`/pr create [title]`、`/review [number]`、
`/issue new <title> | list | show <number>`、`/gh [分组|工具]`。命令本身**不会**写入 GitHub，
只是把指令交给模型，因此写入仍然经过审批关卡。

## 可靠性

- 读取结果按 `cacheTtlMs` 缓存，因此组合报告或重复列表不会重复消耗速率限制。写入始终访问网络并清空缓存。
- 被取消的回合会取消在途请求，错误会如实说明，而不是伪装成超时。
- 读取会在网络失败、超时或服务端错误时重试；写入从不重试——重复写入是决策，不是意外。
- 每个列表同时会在本地截断，因为 API 有时会忽略请求的分页大小。
- 失败会说明下一步该做什么：缺少凭据、权限范围不足、对象不可见（草稿 Release 只能按 id 访问）、需要重新读取的冲突、需要修正的载荷、可以重试的超时；网络不可达时还会指出 `/etc/hosts` 被写坏。

## 界面

插件提供四个小界面，除两处明确确认外均为只读：

- **插件卡片中的访问状态。** 来源、账号、权限范围、剩余速率限制与缓存状态。数据来自仅本机可访问的宿主路由，访问值不会进入对话。状态：加载中、未配置（附指引）、正常、错误。
- **Source Control 标签页**（会话视图环）：仓库路径与分支的 ahead/behind、变更分组（冲突、已暂存、已修改、未跟踪）、所选文件的差异面板、进行中的 merge/rebase 提示，以及分支、标签与 stash。目前只读：提交栏与分支/stash 操作是下一步。
- **侧边栏 GitHub 面板**——同时注册到 better-sidebar 与内置右侧栏。带公开搜索的仓库切换器、带文件预览的 Code 树，以及 Issues、Pull requests、Actions、Inbox 四个标签。
- **输入框上方的 Pull Request 条**。当分支存在上游没有的提交时出现；其按钮把指令复制到剪贴板而不是直接写入——调用仍走正常的审批链路。

系统提示中会加入一段关于本插件的简短说明（`guidance`）；会话中点击的 `github.com` 链接可以记录要跟随的仓库（`interceptLinks`，默认关闭）。

## 安全边界

- token 只存在于 DSH 凭据服务，设置中只有名称；
- 读取操作不改变状态；写入需要显式 `confirm` 参数，删除仓库、转移仓库、删除组织会被直接拒绝。是否显示确认提示由宿主的审批机制决定——本插件不自行运行审批关卡；
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
