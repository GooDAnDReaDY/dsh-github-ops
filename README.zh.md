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
| `tokenEnv` | `GITHUB_TOKEN` | 存放 GitHub token 的 DSH 凭据名称；token 本身不写入设置。 |
| `defaultRepository` | 空 | 未传 `repository` 时使用的 `owner/repo`。 |
| `baseUrl` | `https://api.github.com` | API 地址，GitHub Enterprise 时修改。 |
| `timeoutMs` | `30000` | 单次请求超时。 |

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

## 安全边界

- token 只存在于 DSH 凭据服务，设置中只有名称；
- 读取操作不改变状态，写入必须显式确认；
- 客户端不会输出 token，失败以返回值形式报告（`ok: false` 及 `status`、`code`、`rateLimit`），
  不会中断整个回合。

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
