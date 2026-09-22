// dsh-github-ops — browser half: the plugin settings card.
//
// The card lives on the plugin's own page (the plugin-list seat `plugins.item`), the
// seat the current core renders, with the legacy `settings.plugin.item` card kept for
// older cores. The page view renders bare: the host draws the title, the icon, the
// crumb and the padding, so the form must not add a second frame.
//
// Source language is English; Simplified Chinese ships as the second locale. Russian is
// provided by dsh-russian-lang at runtime and is never hardcoded here.

window.__ModuleLoader__.load({
  id: '@goodandready/dsh-github-ops',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    const React = require('react')

    const NS = 'dsh-github-ops'
    const STATUS_PATH = '/dsh-github-ops/status'
    const SCM_PATH = '/dsh-github-ops/scm'
    const PANEL_PATH = '/dsh-github-ops/panel'

    // The repository a github.com link in the conversation pointed at, so the tab and the
    // panel can follow the human instead of asking again.
    const linkState = { repo: '', enabled: false }
    const ROW_ID = 'dsh-github-ops'
    const PKG = '@goodandready/dsh-github-ops'
    const ROW_CONFIG_KEY = PKG + '#' + ROW_ID

    const en = {
      title: 'GitHub ops',
      sub: 'Releases, tags, a guarded API pass-through, mirror publication and repository settings.',
      cardHint: 'Token from DSH credentials; settings keep only its name.',
      tokenEnv: 'Access name',
      tokenSource: 'Access source',
      tokenSourceHint: '"auto" tries the DSH credential, then the environment variable, then the gh CLI session. Pin it to use one source only.',
      tokenEnvHint: 'Name looked up in the DSH credentials, then the environment, then the gh CLI. The value is never stored here.',
      defaultRepository: 'Default repository',
      defaultRepositoryHint: 'owner/repo used when a tool call omits the repository. Leave empty to always pass it explicitly.',
      baseUrl: 'API base URL',
      baseUrlHint: 'Change it for GitHub Enterprise; the default is the public API.',
      timeoutMs: 'Request timeout, ms',
      maxRetries: 'Retries for a failed read',
      maxRetriesHint: 'A read (GET/HEAD) is retried on a network failure, a timeout or a 5xx. Writes are never retried automatically.',
      reviewRules: 'Review rule overrides (JSON)',
      reviewRulesHint: 'Optional. sensitivePaths, sensitiveSeverity, attentionPaths, migrationPaths, testsRequired, sourcePatterns, testPatterns, largeDiffLines. Example: {"largeDiffLines": 400, "sensitivePaths": [".env", "private/**"]}',
      timeoutMsHint: 'How long one GitHub request may take before it is aborted.',
      statusLoading: 'Reading settings…',
      statusUnavailable: 'Settings service is not available in this build: values cannot be edited here.',
      statusReadOnly: 'Settings are read-only for this session.',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved',
      savedPartial: 'Saved, except: ',
      noChanges: 'Nothing to change.',
      invalidNumber: 'Enter a positive number.',
      statusTitle: 'Access',
      statusLoading: 'Checking access…',
      statusNotConfigured: 'No access yet',
      statusError: 'Access check failed',
      statusSource: 'Source',
      statusAccount: 'Account',
      statusScopes: 'Scopes',
      statusRate: 'Rate limit',
      statusCache: 'Read cache',
      statusRefresh: 'Check again',
      scmTitle: 'Source control',
      scmRefresh: 'Refresh',
      scmLoading: 'Reading the working copy…',
      scmNotRepo: 'This workspace is not a git repository, so there is nothing to show here.',
      scmError: 'Could not read the working copy',
      scmStaged: 'Staged',
      scmChanges: 'Changes',
      scmUntracked: 'Untracked',
      scmConflicts: 'Conflicts',
      scmNothing: 'Nothing to commit: the working copy is clean.',
      scmDiffEmpty: 'No diff for this file (it may be binary or untracked).',
      scmBranches: 'Branches',
      scmTags: 'Tags',
      scmStashes: 'Stashes',
      scmInProgress: 'In progress',
      scmNoUpstream: 'no upstream',
      scmCommit: 'Commit',
      scmCommitPush: 'Commit & push',
      scmSync: 'Sync',
      scmAmend: 'amend',
      scmMessage: 'Commit message',
      scmStage: 'Stage',
      scmUnstage: 'Unstage',
      scmDiscard: 'Discard',
      scmConfirm: 'Confirm?',
      scmNewBranch: 'New branch',
      scmCreate: 'Create',
      scmDelete: 'Delete',
      scmSwitch: 'Switch',
      scmStashSave: 'Save stash',
      scmStashApply: 'Apply',
      scmStashPop: 'Pop',
      scmStashDrop: 'Drop',
      scmContinue: 'Continue',
      scmAbort: 'Abort',
      scmWorking: 'Working…',
      scmActionFailed: 'git refused',
      scmNoChanges: 'Nothing staged or changed',
      scmBehindHint: 'Behind the upstream: sync pulls with rebase, then pushes',
      scmPushBranch: 'Push branch',
      scmRepoPath: 'Repository path (optional)',
      scmRepoPathHint: 'Absolute path; empty means the session workspace',
      prBarBranch: 'to',
      prBarCommits: 'commit(s) ahead',
      panelTitle: 'GitHub',
      panelRepo: 'Repository',
      panelSearch: 'Search public repositories…',
      panelChoose: 'Choose a repository to browse.',
      panelBack: 'Up',
      panelIssues: 'Issues',
      panelPulls: 'Pull requests',
      panelRuns: 'Actions',
      panelInbox: 'Inbox',
      panelOpen: 'Open in browser',
      panelEmpty: 'Nothing here yet.',
      panelLoading: 'Loading…',
      panelNoAccess: 'No GitHub access yet: configure a credential, sign in, or use the gh CLI.',
      prBarCreate: 'Create PR',
      prBarReview: 'Review',
      prBarMerge: 'Merge',
      prBarCopied: 'Instruction copied: paste it into the composer and send.',
      prBarCopyFailed: 'Could not copy; the instruction is in the title.',
    }

    const zh = {
      title: 'GitHub 操作',
      sub: '发布、标签、受保护的 API 直通、镜像发布与仓库设置。',
      cardHint: '令牌来自 DSH 凭据服务；设置里只保存凭据名称。',
      tokenEnv: '访问名称',
      tokenSource: '访问来源',
      tokenSourceHint: '"auto" 依次尝试 DSH 凭据、环境变量与 gh CLI 会话；固定为某一项则只使用该来源。',
      tokenEnvHint: '依次在 DSH 凭据、环境变量与 gh CLI 中查找该名称；取值本身不会保存在这里。',
      defaultRepository: '默认仓库',
      defaultRepositoryHint: '调用未指定仓库时使用的 owner/repo；留空表示每次都必须显式传入。',
      baseUrl: 'API 地址',
      baseUrlHint: 'GitHub Enterprise 时修改；默认使用公共 API。',
      timeoutMs: '请求超时（毫秒）',
      maxRetries: '读取失败重试次数',
      maxRetriesHint: '读取（GET/HEAD）在网络故障、超时或 5xx 时重试；写入不会自动重试。',
      reviewRules: '评审规则覆盖（JSON）',
      reviewRulesHint: '可选。sensitivePaths、sensitiveSeverity、attentionPaths、migrationPaths、testsRequired、sourcePatterns、testPatterns、largeDiffLines。',
      timeoutMsHint: '单个 GitHub 请求在被中断前允许的时长。',
      statusLoading: '正在读取设置…',
      statusUnavailable: '当前构建没有设置服务：这里无法编辑取值。',
      statusReadOnly: '本次会话中设置为只读。',
      save: '保存',
      saving: '保存中…',
      saved: '已保存',
      savedPartial: '已保存，除了：',
      noChanges: '没有需要修改的内容。',
      invalidNumber: '请输入正数。',
      statusTitle: '访问状态',
      statusLoading: '正在检查访问…',
      statusNotConfigured: '尚未配置访问',
      statusError: '访问检查失败',
      statusSource: '来源',
      statusAccount: '账号',
      statusScopes: '权限范围',
      statusRate: '速率限制',
      statusCache: '读取缓存',
      statusRefresh: '重新检查',
      scmTitle: '源代码管理',
      scmRefresh: '刷新',
      scmLoading: '正在读取工作副本…',
      scmNotRepo: '当前工作区不是 git 仓库，这里没有可显示的内容。',
      scmError: '无法读取工作副本',
      scmStaged: '已暂存',
      scmChanges: '更改',
      scmUntracked: '未跟踪',
      scmConflicts: '冲突',
      scmNothing: '没有待提交内容：工作副本是干净的。',
      scmDiffEmpty: '该文件没有差异（可能是二进制或未跟踪）。',
      scmBranches: '分支',
      scmTags: '标签',
      scmStashes: '暂存',
      scmInProgress: '进行中',
      scmNoUpstream: '无上游',
      scmCommit: '提交',
      scmCommitPush: '提交并推送',
      scmSync: '同步',
      scmAmend: '修补',
      scmMessage: '提交信息',
      scmStage: '暂存',
      scmUnstage: '取消暂存',
      scmDiscard: '放弃更改',
      scmConfirm: '确认？',
      scmNewBranch: '新分支',
      scmCreate: '创建',
      scmDelete: '删除',
      scmSwitch: '切换',
      scmStashSave: '保存 stash',
      scmStashApply: '应用',
      scmStashPop: '弹出',
      scmStashDrop: '删除',
      scmContinue: '继续',
      scmAbort: '中止',
      scmWorking: '执行中…',
      scmActionFailed: 'git 拒绝',
      scmNoChanges: '没有已暂存或已修改的内容',
      scmBehindHint: '落后于上游：同步会先 rebase 拉取，再推送',
      scmPushBranch: '推送分支',
      scmRepoPath: '仓库路径（可选）',
      scmRepoPathHint: '绝对路径；留空则使用会话工作区',
      prBarBranch: '→',
      prBarCommits: '个提交领先',
      panelTitle: 'GitHub',
      panelRepo: '仓库',
      panelSearch: '搜索公开仓库…',
      panelChoose: '请选择要浏览的仓库。',
      panelBack: '上一级',
      panelIssues: 'Issue',
      panelPulls: 'Pull request',
      panelRuns: 'Actions',
      panelInbox: '收件箱',
      panelOpen: '在浏览器中打开',
      panelEmpty: '这里还没有内容。',
      panelLoading: '加载中…',
      panelNoAccess: '尚未配置 GitHub 访问：请设置凭据、登录或使用 gh CLI。',
      prBarCreate: '创建 PR',
      prBarReview: '评审',
      prBarMerge: '合并',
      prBarCopied: '指令已复制：粘贴到输入框并发送。',
      prBarCopyFailed: '复制失败；指令在提示中。',
    }

    let ChevronIcon = null
    try {
      const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
      ChevronIcon = primitives && (primitives.IconChevronDownOutline14 || primitives.IconChevronDownOutline)
    } catch {
      ChevronIcon = null
    }

    const FALLBACK_CHEVRON = React.createElement(
      'svg',
      { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, 'aria-hidden': 'true' },
      React.createElement('path', { d: 'M3.5 5.25L7 8.75L10.5 5.25' }),
    )


    /**
     * Source Control tab: what the working copy looks like right now.
     *
     * Reads only. Data comes from the host route on the session workspace; nothing here writes
     * to the repository, so a change always starts with an explicit human action.
     */
    function SourceControlView(props) {
      ensureCss()
      const t = props.t || ((key) => key)
      const [state, setState] = React.useState({ phase: 'loading' })
      const [selected, setSelected] = React.useState(null)
      const [diff, setDiff] = React.useState({ phase: 'idle', text: '' })
      const [busy, setBusy] = React.useState('')
      const [actionError, setActionError] = React.useState('')
      const [message, setMessage] = React.useState('')
      const [amend, setAmend] = React.useState(false)
      const [confirming, setConfirming] = React.useState('')
      const [branchName, setBranchName] = React.useState('')
      const [stashMessage, setStashMessage] = React.useState('')
      const [repoPath, setRepoPath] = React.useState(() => {
        try { return localStorage.getItem('gho-scm-cwd') || '' } catch { return '' }
      })

      // The tab reads the session workspace by default; an explicit path lets it look at any
      // repository the local user names.
      const cwdQuery = repoPath ? `cwd=${encodeURIComponent(repoPath)}` : ''
      const rememberPath = (value) => {
        setRepoPath(value)
        try { value ? localStorage.setItem('gho-scm-cwd', value) : localStorage.removeItem('gho-scm-cwd') } catch { /* private mode */ }
      }

      const load = React.useCallback(() => {
        setState({ phase: 'loading' })
        if (typeof fetch !== 'function') {
          setState({ phase: 'error', message: 'fetch is unavailable in this client' })
          return
        }
        fetch(cwdQuery ? `${SCM_PATH}?${cwdQuery}` : SCM_PATH, { headers: { accept: 'application/json' } })
          .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
          .then((payload) => setState({ phase: 'ready', payload }))
          .catch((err) => setState({ phase: 'error', message: String((err && err.message) || err) }))
      }, [repoPath])

      React.useEffect(() => { load() }, [load])

      // Every write is one named action; the host validates it and runs argv, never a shell.
      const runAction = (action, args) => {
        if (typeof fetch !== 'function') return
        setBusy(action)
        setActionError('')
        fetch(SCM_PATH, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(repoPath ? { action, args: args || {}, cwd: repoPath } : { action, args: args || {} }),
        })
          .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
          .then((payload) => {
            setBusy('')
            setConfirming('')
            if (!payload || payload.ok !== true) setActionError((payload && payload.error) || t('scmActionFailed'))
            load()
          })
          .catch((err) => { setBusy(''); setActionError(String((err && err.message) || err)) })
      }

      // Destructive actions ask twice: the first click arms the button, the second runs it.
      const armed = (key, action, args) => {
        if (confirming !== key) { setConfirming(key); return }
        setConfirming('')
        runAction(action, args)
      }

      const openDiff = (file, staged) => {
        setSelected({ path: file.path, staged })
        setDiff({ phase: 'loading', text: '' })
        const query = `?file=${encodeURIComponent(file.path)}${staged ? '&staged=1' : ''}`
        fetch(SCM_PATH + query, { headers: { accept: 'application/json' } })
          .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
          .then((payload) => setDiff({ phase: 'ready', text: payload.diff || '' }))
          .catch((err) => setDiff({ phase: 'error', text: String((err && err.message) || err) }))
      }

      const button = (label, onClick, options) => React.createElement('button', {
        type: 'button',
        className: `gho-scm-btn${options && options.warn ? ' gho-scm-btn-warn' : ''}`,
        disabled: Boolean(busy) || Boolean(options && options.disabled),
        onClick,
      }, label)

      const fileRow = (file, staged) => {
        const discardKey = `discard:${file.path}`
        return React.createElement('div', {
          key: `${staged ? 's' : 'w'}-${file.path}`,
          className: 'gho-scm-file',
          role: 'button',
          tabIndex: 0,
          'aria-selected': selected && selected.path === file.path && selected.staged === staged,
          onClick: () => openDiff(file, staged),
          onKeyDown: (event) => { if (event.key === 'Enter' || event.key === ' ') openDiff(file, staged) },
        },
          React.createElement('span', { className: 'gho-scm-badge' }, file.status),
          React.createElement('span', { className: 'gho-scm-path' }, file.renamedFrom ? `${file.renamedFrom} → ${file.path}` : file.path),
          React.createElement('span', { className: 'gho-scm-actions' },
            staged
              ? button(t('scmUnstage'), () => runAction('unstage', { path: file.path }))
              : button(t('scmStage'), () => runAction('stage', { path: file.path })),
            button(confirming === discardKey ? t('scmConfirm') : t('scmDiscard'), () => armed(discardKey, 'discard', { path: file.path, confirm: true }), { warn: true }),
          ),
        )
      }

      const group = (title, files, staged) => (files && files.length
        ? React.createElement('div', { className: 'gho-scm-group', key: title },
          React.createElement('div', { className: 'gho-scm-group-head' }, `${title} (${files.length})`),
          files.map((file) => fileRow(file, staged)),
        )
        : null)

      if (state.phase === 'loading') return React.createElement('div', { className: 'gho-scm' }, t('scmLoading'))
      if (state.phase === 'error') {
        return React.createElement('div', { className: 'gho-scm' },
          React.createElement('div', { className: 'gho-scm-group-head' }, t('scmError')),
          React.createElement('div', { className: 'gho-scm-meta' }, state.message),
          button(t('scmRefresh'), load),
        )
      }
      const payload = state.payload || {}
      if (!payload.isRepository) {
        return React.createElement('div', { className: 'gho-scm' },
          React.createElement('div', { className: 'gho-scm-group-head' }, t('scmNotRepo')),
          payload.error ? React.createElement('div', { className: 'gho-scm-meta' }, payload.error) : null,
          button(t('scmRefresh'), load),
        )
      }
      const files = payload.files || { staged: [], changes: [], untracked: [], unmerged: [], total: 0 }
      const clean = !files.total
      const canCommit = files.staged.length > 0 && message.trim().length > 0 && !busy
      const ahead = payload.ahead || 0
      const behind = payload.behind || 0

      const commitBar = React.createElement('div', { className: 'gho-scm-bar' },
        React.createElement('input', {
          type: 'text',
          value: message,
          placeholder: t('scmMessage'),
          onChange: (event) => setMessage(event.target.value),
          onKeyDown: (event) => { if (event.key === 'Enter' && canCommit) runAction('commit', { message, amend }) },
        }),
        React.createElement('label', { className: 'gho-scm-check' },
          React.createElement('input', { type: 'checkbox', checked: amend, onChange: (event) => setAmend(event.target.checked) }),
          t('scmAmend'),
        ),
        button(t('scmCommit'), () => runAction('commit', { message, amend }), { disabled: !canCommit }),
        button(t('scmCommitPush'), () => runAction('commit', { message, amend, push: true }), { disabled: !canCommit }),
        button(behind > 0 ? t('scmSync') : t('scmPushBranch'), () => runAction(behind > 0 ? 'sync' : 'push', {}), { disabled: Boolean(busy) || (ahead === 0 && behind === 0) }),
      )

      const mergeBar = payload.mergeState && payload.mergeState.inProgress
        ? React.createElement('div', { className: 'gho-scm-bar' },
          React.createElement('span', null, `${t('scmInProgress')}: ${payload.mergeState.kind}`),
          button(t('scmContinue'), () => runAction('continue', { verb: payload.mergeState.kind })),
          button(confirming === 'abort' ? t('scmConfirm') : t('scmAbort'), () => armed('abort', 'abort', { verb: payload.mergeState.kind, confirm: true }), { warn: true }),
        )
        : null

      const branchBar = React.createElement('div', { className: 'gho-scm-bar' },
        React.createElement('input', {
          type: 'text',
          value: branchName,
          placeholder: t('scmNewBranch'),
          onChange: (event) => setBranchName(event.target.value),
        }),
        button(t('scmCreate'), () => runAction('branchCreate', { branch: branchName }), { disabled: !branchName.trim() || Boolean(busy) }),
        (payload.branches || []).filter((b) => !b.current).slice(0, 6).map((b) => button(
          confirming === `branch:${b.name}` ? `${b.name}: ${t('scmConfirm')}` : `${t('scmSwitch')} ${b.name}`,
          () => armed(`branch:${b.name}`, 'branchCheckout', { branch: b.name }),
        )),
        (payload.branches || []).filter((b) => !b.current).slice(0, 6).map((b) => button(
          confirming === `del:${b.name}` ? `${t('scmDelete')}?` : `${t('scmDelete')} ${b.name}`,
          () => armed(`del:${b.name}`, 'branchDelete', { branch: b.name, confirm: true }),
          { warn: true },
        )),
      )

      const stashBar = React.createElement('div', { className: 'gho-scm-bar' },
        React.createElement('input', {
          type: 'text',
          value: stashMessage,
          placeholder: t('scmStashSave'),
          onChange: (event) => setStashMessage(event.target.value),
        }),
        button(t('scmStashSave'), () => runAction('stashPush', { message: stashMessage }), { disabled: Boolean(busy) }),
        (payload.stashes || []).slice(0, 4).map((entry) => button(`${t('scmStashApply')} ${entry.ref}`, () => runAction('stashApply', { ref: entry.ref }))),
        (payload.stashes || []).slice(0, 4).map((entry) => button(`${t('scmStashPop')} ${entry.ref}`, () => runAction('stashPop', { ref: entry.ref }))),
        (payload.stashes || []).slice(0, 4).map((entry) => button(
          confirming === `stash:${entry.ref}` ? `${entry.ref}: ${t('scmConfirm')}` : `${t('scmStashDrop')} ${entry.ref}`,
          () => armed(`stash:${entry.ref}`, 'stashDrop', { ref: entry.ref, confirm: true }),
          { warn: true },
        )),
      )

      return React.createElement('div', { className: 'gho-scm' },
        React.createElement('div', { className: 'gho-scm-head' },
          React.createElement('span', { className: 'gho-scm-repo' }, payload.cwd || ''),
          React.createElement('span', { className: 'gho-scm-branch' }, payload.branch),
          payload.upstream
            ? React.createElement('span', { className: 'gho-scm-counts' }, `↑${ahead} ↓${behind}`)
            : React.createElement('span', { className: 'gho-scm-counts' }, t('scmNoUpstream')),
          button(busy ? t('scmWorking') : t('scmRefresh'), load, { disabled: Boolean(busy) }),
        ),
        React.createElement('div', { className: 'gho-scm-bar' },
          React.createElement('input', {
            type: 'text',
            value: repoPath,
            placeholder: t('scmRepoPath'),
            title: t('scmRepoPathHint'),
            onChange: (event) => rememberPath(event.target.value),
            onKeyDown: (event) => { if (event.key === 'Enter') load() },
          }),
        ),
        actionError ? React.createElement('div', { className: 'gho-scm-meta gho-scm-error' }, `${t('scmActionFailed')}: ${actionError}`) : null,
        behind > 0 ? React.createElement('div', { className: 'gho-scm-meta' }, t('scmBehindHint')) : null,
        mergeBar,
        commitBar,
        clean ? React.createElement('div', { className: 'gho-scm-meta' }, t('scmNothing')) : null,
        group(t('scmConflicts'), files.unmerged, false),
        group(t('scmStaged'), files.staged, true),
        group(t('scmChanges'), files.changes, false),
        group(t('scmUntracked'), files.untracked, false),
        selected
          ? React.createElement('pre', { className: 'gho-scm-diff' },
            diff.phase === 'loading' ? t('scmLoading') : (diff.text || t('scmDiffEmpty')))
          : null,
        branchBar,
        stashBar,
        React.createElement('div', { className: 'gho-scm-meta' },
          React.createElement('span', null, `${t('scmTags')}: ${(payload.tags || []).join(', ') || '—'}`),
        ),
      )
    }

    /**
     * The pull request bar above the composer.
     *
     * It appears when the branch has commits the upstream does not, and it never writes: the
     * buttons put an instruction on the clipboard for the human to send, so the call still goes
     * through the normal approval contour.
     */
    function PullRequestBar(props) {
      ensureCss()
      const t = props.t || ((key) => key)
      const [state, setState] = React.useState({ phase: 'idle' })
      const [note, setNote] = React.useState('')

      const load = React.useCallback(() => {
        if (typeof fetch !== 'function') return
        fetch(SCM_PATH, { headers: { accept: 'application/json' } })
          .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
          .then((payload) => setState({ phase: 'ready', payload }))
          .catch(() => setState({ phase: 'idle' }))
      }, [])

      React.useEffect(() => { load() }, [load])

      const payload = state.payload
      const ahead = payload && payload.isRepository && payload.upstream ? (payload.ahead || 0) : 0
      if (!payload || !payload.isRepository || ahead <= 0) return null

      const instruction = (kind) => {
        const repo = payload.cwd ? ` (workspace ${payload.cwd})` : ''
        if (kind === 'create') return `Create a GitHub pull request from ${payload.branch}${payload.upstream ? ` into ${payload.upstream.replace(/^[^/]+\//, '')}` : ''}: call pr_create with head=${payload.branch}${repo}.`
        if (kind === 'review') return `Review the open pull request of ${payload.branch}: call gh_review and then ci_run, and summarise the findings.`
        return `Merge the pull request of ${payload.branch} after the review: call pr_merge.`
      }

      const copy = (kind) => {
        const text = instruction(kind)
        try {
          if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text)
            setNote(t('prBarCopied'))
            return
          }
          throw new Error('clipboard unavailable')
        } catch {
          setNote(`${t('prBarCopyFailed')} ${text}`)
        }
      }

      const base = payload.upstream ? payload.upstream.replace(/^[^/]+\//, '') : ''
      return React.createElement('div', { className: 'gho-prbar' },
        React.createElement('span', { className: 'gho-prbar-branch' }, `${payload.branch} ${base ? `→ ${base}` : ''}`.trim()),
        React.createElement('span', null, `↑${ahead} ${t('prBarCommits')}`),
        note ? React.createElement('span', { className: 'gho-prbar-note' }, note) : null,
        React.createElement('span', { className: 'gho-prbar-actions' },
          React.createElement('button', { type: 'button', className: 'gho-prbar-btn', onClick: () => copy('create') }, t('prBarCreate')),
          React.createElement('button', { type: 'button', className: 'gho-prbar-btn', onClick: () => copy('review') }, t('prBarReview')),
          React.createElement('button', { type: 'button', className: 'gho-prbar-btn', onClick: () => copy('merge') }, t('prBarMerge')),
        ),
      )
    }


    /** Remember which repository a github.com link pointed at, when the user opted in. */
    function installLinkWatcher() {
      if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return
      document.addEventListener('click', (event) => {
        if (!linkState.enabled) return
        const anchor = event.target && event.target.closest ? event.target.closest('a[href]') : null
        if (!anchor) return
        const match = String(anchor.getAttribute('href') || '').match(/^https?:\/\/github\.com\/([^/]+)\/([^/?#]+)/)
        if (!match) return
        // the browser still opens the link: this only records where the human is looking
        linkState.repo = `${match[1]}/${match[2].replace(/\.git$/, '')}`
      }, true)
    }


    /**
     * The GitHub panel: browse a repository, its issues, pull requests, runs and the attention
     * inbox from the sidebar.
     *
     * Reads only, and through the host route: the panel never holds a token and never writes.
     */
    function GitHubPanel(props) {
      ensureCss()
      const t = props.t || ((key) => key)
      const [repo, setRepo] = React.useState('')
      const [repos, setRepos] = React.useState([])
      const [search, setSearch] = React.useState('')
      const [tab, setTab] = React.useState('tree')
      const [tree, setTree] = React.useState({ phase: 'idle', path: '', entries: [] })
      const [file, setFile] = React.useState(null)
      const [items, setItems] = React.useState({ phase: 'idle', list: [] })
      const [error, setError] = React.useState('')
      const [loading, setLoading] = React.useState(false)

      const call = React.useCallback((params) => {
        if (typeof fetch !== 'function') return Promise.reject(new Error('fetch is unavailable in this client'))
        const query = new URLSearchParams(params).toString()
        return fetch(`${PANEL_PATH}?${query}`, { headers: { accept: 'application/json' } })
          .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
      }, [])

      const loadRepos = React.useCallback((q) => {
        setLoading(true)
        setError('')
        call(q ? { what: 'repos', q } : { what: 'repos' })
          .then((payload) => {
            if (payload.configured === false) { setError(payload.guidance || t('panelNoAccess')); setRepos([]); return }
            setRepos(payload.repos || [])
          })
          .catch((err) => setError(String((err && err.message) || err)))
          .finally(() => setLoading(false))
      }, [call, t])

      React.useEffect(() => { loadRepos('') }, [loadRepos])

      const loadTree = React.useCallback((path) => {
        if (!repo) return
        setFile(null)
        setTree({ phase: 'loading', path, entries: [] })
        call({ what: 'tree', repo, path })
          .then((payload) => setTree({ phase: 'ready', path: payload.path || path, entries: payload.entries || [], truncated: payload.truncated }))
          .catch((err) => { setTree({ phase: 'error', path, entries: [] }); setError(String((err && err.message) || err)) })
      }, [call, repo])

      const loadList = React.useCallback((which) => {
        if (!repo) return
        setItems({ phase: 'loading', list: [] })
        call({ what: which, repo })
          .then((payload) => setItems({ phase: 'ready', list: payload.items || [] }))
          .catch((err) => { setItems({ phase: 'error', list: [] }); setError(String((err && err.message) || err)) })
      }, [call, repo])

      const loadInbox = React.useCallback(() => {
        setItems({ phase: 'loading', list: [] })
        call({ what: 'inbox' })
          .then((payload) => setItems({ phase: 'ready', list: payload.notifications || [] }))
          .catch((err) => { setItems({ phase: 'error', list: [] }); setError(String((err && err.message) || err)) })
      }, [call])

      React.useEffect(() => {
        if (!repo) return
        if (tab === 'tree') loadTree('')
        else if (tab === 'inbox') loadInbox()
        else loadList(tab)
      }, [repo, tab, loadTree, loadList, loadInbox])

      const openFile = (entry) => {
        if (entry.type === 'tree') { loadTree(entry.path); return }
        call({ what: 'blob', repo, path: entry.path })
          .then((payload) => setFile(payload))
          .catch((err) => setError(String((err && err.message) || err)))
      }

      const tabButton = (id, label) => React.createElement('button', {
        key: id, type: 'button', className: 'gho-panel-tab', 'aria-pressed': tab === id, onClick: () => setTab(id),
      }, label)

      const header = React.createElement('div', { className: 'gho-panel-row' },
        React.createElement('span', { className: 'gho-panel-muted' }, t('panelRepo')),
        React.createElement('span', null, repo || '—'),
        repo ? React.createElement('a', { className: 'gho-link', href: `https://github.com/${repo}`, target: '_blank', rel: 'noreferrer' }, t('panelOpen')) : null,
      )

      const switcher = React.createElement('div', { className: 'gho-panel' },
        React.createElement('div', { className: 'gho-panel-row' },
          React.createElement('input', {
            className: 'gho-panel-input',
            placeholder: t('panelSearch'),
            value: search,
            onChange: (event) => setSearch(event.target.value),
            onKeyDown: (event) => { if (event.key === 'Enter') loadRepos(search) },
          }),
        ),
        repos.length === 0
          ? React.createElement('div', { className: 'gho-panel-muted' }, loading ? t('panelLoading') : t('panelChoose'))
          : repos.slice(0, 30).map((entry) => React.createElement('div', {
            key: entry.fullName, className: 'gho-panel-item', role: 'button', tabIndex: 0,
            onClick: () => setRepo(entry.fullName),
            onKeyDown: (event) => { if (event.key === 'Enter') setRepo(entry.fullName) },
          },
            React.createElement('span', { className: 'gho-panel-file' }, entry.fullName),
            React.createElement('span', { className: 'gho-panel-muted' }, entry.private ? 'private' : 'public'),
            entry.description ? React.createElement('span', { className: 'gho-panel-muted' }, entry.description.slice(0, 40)) : null,
          )),
      )

      if (!repo) return React.createElement('div', null, header, switcher)

      const list = (() => {
        if (items.phase === 'loading') return React.createElement('div', { className: 'gho-panel-muted' }, t('panelLoading'))
        if (!items.list.length) return React.createElement('div', { className: 'gho-panel-muted' }, t('panelEmpty'))
        return items.list.slice(0, 40).map((item, index) => React.createElement('div', { className: 'gho-panel-item', key: `${item.number || item.id || index}` },
          React.createElement('span', { className: 'gho-panel-file' }, item.number ? `#${item.number}` : (item.name || '')),
          React.createElement('span', null, item.title || item.displayTitle || item.reason || item.name || ''),
          item.url || item.html_url ? React.createElement('a', { className: 'gho-link', href: item.url || item.html_url, target: '_blank', rel: 'noreferrer' }, '↗') : null,
        ))
      })()

      const treeView = React.createElement('div', null,
        tree.path ? React.createElement('button', { type: 'button', className: 'gho-link', onClick: () => loadTree(tree.path.split('/').slice(0, -1).join('/')) }, t('panelBack')) : null,
        tree.phase === 'loading' ? React.createElement('div', { className: 'gho-panel-muted' }, t('panelLoading')) : null,
        tree.phase === 'ready' && tree.entries.length === 0 ? React.createElement('div', { className: 'gho-panel-muted' }, t('panelEmpty')) : null,
        (tree.entries || []).map((entry) => React.createElement('div', {
          key: entry.path, className: 'gho-panel-item', role: 'button', tabIndex: 0,
          onClick: () => openFile(entry),
          onKeyDown: (event) => { if (event.key === 'Enter') openFile(entry) },
        },
          React.createElement('span', { className: 'gho-panel-file' }, entry.type === 'tree' ? '▸' : '·'),
          React.createElement('span', { className: 'gho-panel-file' }, entry.name),
          entry.type === 'blob' && entry.size !== undefined ? React.createElement('span', { className: 'gho-panel-muted' }, `${entry.size} B`) : null,
        )),
        file ? React.createElement('pre', { className: 'gho-panel-pre' }, file.truncated ? `${file.text}\n…` : (file.text || t('panelEmpty'))) : null,
      )

      return React.createElement('div', { className: 'gho-panel' },
        header,
        React.createElement('div', { className: 'gho-panel-tabs' },
          tabButton('tree', 'Code'),
          tabButton('issues', t('panelIssues')),
          tabButton('pulls', t('panelPulls')),
          tabButton('runs', t('panelRuns')),
          tabButton('inbox', t('panelInbox')),
          React.createElement('button', { type: 'button', className: 'gho-panel-tab', onClick: () => { setRepo(''); setFile(null) } }, t('panelRepo')),
        ),
        error ? React.createElement('div', { className: 'gho-panel-muted' }, error) : null,
        tab === 'tree' ? treeView : list,
      )
    }

    // This file is the whole client half on purpose: DSH loads it as a single bundle through
    // window.__ModuleLoader__, so splitting the card, the tab, the panel and the pull request
    // bar into several files would need a build step the plugin deliberately does not have.
    let cssInstalled = false
    function ensureCss() {
      if (cssInstalled || typeof document === 'undefined') return
      cssInstalled = true
      if (document.querySelector('style[data-dsh-plugin="dsh-github-ops"]')) return
      const style = document.createElement('style')
      style.dataset.dshPlugin = 'dsh-github-ops'
      style.textContent = [
        '.gho-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;list-style:none}',
        '.gho-head{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;display:flex;align-items:center;gap:12px;padding:14px 16px}',
        '.gho-title{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}',
        '.gho-sub{color:var(--dsw-alias-label-secondary);font-size:13px}',
        '.gho-body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}',
        '.gho-field{display:flex;flex-direction:column;gap:6px;padding:12px 0}',
        '.gho-label{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}',
        '.gho-hint{font-size:12px;color:var(--dsw-alias-label-secondary)}',
        '.gho-status{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:10px 12px;margin:12px 0 0;display:flex;flex-direction:column;gap:6px}',
        '.gho-status-row{display:flex;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary)}',
        '.gho-status-key{min-width:88px;color:var(--dsw-alias-label-tertiary)}',
        '.gho-status-value{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}',
        '.gho-status-head{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}',
        '.gho-status-bad{color:var(--dsw-alias-label-error,#c0392b)}',
        '.gho-link{appearance:none;border:0;background:0 0;font:inherit;font-size:12px;color:var(--dsw-alias-label-secondary);text-decoration:underline;cursor:pointer;padding:0;margin-left:auto}',
        '.gho-scm{display:flex;flex-direction:column;gap:12px;padding:4px 2px;font-size:13px;color:var(--dsw-alias-label-primary)}',
        '.gho-scm-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
        '.gho-scm-repo{font-weight:600}',
        '.gho-scm-branch{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dsw-alias-label-secondary)}',
        '.gho-scm-counts{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}',
        '.gho-scm-group{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;overflow:hidden}',
        '.gho-scm-group-head{display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--dsw-alias-bg-layer-3);font-size:12px;font-weight:600}',
        '.gho-scm-file{display:flex;align-items:center;gap:8px;padding:6px 12px;cursor:pointer;border-top:1px solid var(--dsw-alias-border-l2)}',
        '.gho-scm-file[aria-selected="true"]{background:var(--dsw-alias-bg-layer-3)}',
        '.gho-scm-badge{min-width:18px;text-align:center;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dsw-alias-label-secondary)}',
        '.gho-scm-path{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.gho-scm-diff{margin:0;padding:10px 12px;max-height:420px;overflow:auto;background:var(--dsw-alias-bg-layer-3);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:1.5;white-space:pre}',
        '.gho-scm-meta{display:flex;gap:12px;flex-wrap:wrap;font-size:12px;color:var(--dsw-alias-label-secondary)}',
        '.gho-scm-chip{border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:2px 8px}',
        '.gho-prbar{display:flex;align-items:center;gap:10px;padding:6px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;font-size:12px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-3)}',
        '.gho-prbar-branch{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dsw-alias-label-primary)}',
        '.gho-prbar-actions{display:flex;gap:6px;margin-left:auto}',
        '.gho-prbar-btn{appearance:none;font:inherit;font-size:12px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);background:0 0;color:var(--dsw-alias-label-primary);border-radius:8px;padding:3px 8px}',
        '.gho-prbar-note{color:var(--dsw-alias-label-tertiary)}',
        '.gho-panel{display:flex;flex-direction:column;gap:10px;font-size:12px;color:var(--dsw-alias-label-primary);padding:4px 2px}',
        '.gho-panel-row{display:flex;align-items:center;gap:6px}',
        '.gho-panel-input{flex:1;height:28px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);padding:0 8px;font:inherit}',
        '.gho-panel-tabs{display:flex;gap:4px;flex-wrap:wrap}',
        '.gho-panel-tab{appearance:none;font:inherit;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);background:0 0;color:var(--dsw-alias-label-secondary);border-radius:999px;padding:2px 10px}',
        '.gho-panel-tab[aria-pressed="true"]{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary)}',
        '.gho-panel-item{display:flex;gap:8px;align-items:baseline;padding:5px 2px;border-top:1px solid var(--dsw-alias-border-l2);cursor:pointer}',
        '.gho-panel-item:hover{background:var(--dsw-alias-bg-layer-3)}',
        '.gho-panel-muted{color:var(--dsw-alias-label-tertiary)}',
        '.gho-panel-file{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}',
        '.gho-panel-pre{margin:0;max-height:340px;overflow:auto;background:var(--dsw-alias-bg-layer-3);border-radius:8px;padding:8px;white-space:pre;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}',
        '.gho-scm-bar{display:flex;gap:6px;align-items:center;flex-wrap:wrap;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:8px 10px}',
        '.gho-scm-bar input[type="text"]{flex:1;min-width:160px;height:28px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);padding:0 8px;font:inherit}',
        '.gho-scm-btn{appearance:none;font:inherit;font-size:12px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);background:0 0;color:var(--dsw-alias-label-primary);border-radius:8px;padding:3px 8px}',
        '.gho-scm-btn[disabled]{opacity:.5;cursor:default}',
        '.gho-scm-btn-warn{border-color:var(--dsw-alias-label-error,#c0392b);color:var(--dsw-alias-label-error,#c0392b)}',
        '.gho-scm-actions{display:flex;gap:4px;margin-left:auto}',
        '.gho-scm-check{display:flex;align-items:center;gap:4px;color:var(--dsw-alias-label-secondary)}',
        '.gho-scm-error{color:var(--dsw-alias-label-error,#c0392b)}',
        '.gho-input-area{height:auto;min-height:64px;padding:8px 12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;resize:vertical}',
        '.gho-input{height:34px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font-size:13px}',
        '.gho-foot{border-top:1px solid var(--dsw-alias-border-l2);display:flex;justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px}',
        '.gho-save{appearance:none;font:inherit;cursor:pointer;border:1px solid transparent;border-radius:8px;padding:5px 14px;font-size:13px;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}',
        '.gho-save[disabled]{opacity:.6;cursor:default}',
        '.gho-note{font-size:12px;color:var(--dsw-alias-label-secondary);margin-right:auto}',
        '.gho-chev{margin-left:auto;flex:none;color:var(--dsw-alias-label-tertiary);transition:transform .16s}',
        '.gho-chev-open{transform:rotate(180deg)}',
      ].join('\n')
      document.head.appendChild(style)
    }

    function makeTranslator(locale) {
      const dict = String(locale || '').startsWith('zh') ? zh : en
      const fallback = en
      return (key) => dict[key] || fallback[key] || key
    }

    /**
     * Settings form. It checks the snapshot STATUS, not the value: while the host has
     * not answered, or does not know the namespace, the fields must not look editable.
     */
    function GitHubOpsCard(props) {
      ensureCss()
      const ctx = props.ctx
      const page = !!(props && props.view === 'page')
      const t = props.t || makeTranslator(props.locale)
      const [open, setOpen] = React.useState(!!page)
      const [snapshot, setSnapshot] = React.useState({ status: 'loading', value: {} })
      const [draft, setDraft] = React.useState(null)
      const [saving, setSaving] = React.useState(false)
      const [message, setMessage] = React.useState('')
      const [accessStatus, setAccessStatus] = React.useState(null)
      const [statusError, setStatusError] = React.useState('')

      const loadStatus = React.useCallback(() => {
        setAccessStatus('loading')
        setStatusError('')
        if (typeof fetch !== 'function') {
          setAccessStatus(null)
          setStatusError('fetch is unavailable in this client')
          return
        }
        fetch(STATUS_PATH, { headers: { accept: 'application/json' } })
          .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
          .then((payload) => setAccessStatus(payload))
          .catch((err) => { setAccessStatus(null); setStatusError(String((err && err.message) || err)) })
      }, [])

      React.useEffect(() => {
        if (open && accessStatus === null && !statusError) loadStatus()
      }, [open, accessStatus, statusError, loadStatus])

      let scope = null
      try {
        scope = ctx && ctx.configForms && ctx.configForms.get(NS)
      } catch {
        scope = null
      }

      React.useEffect(() => {
        if (!scope || typeof scope.subscribe !== 'function') {
          setSnapshot({ status: 'unavailable', value: {} })
          return undefined
        }
        const read = () => {
          const next = scope.getSnapshot()
          setSnapshot(next || { status: 'unavailable', value: {} })
          setDraft((current) => current || { ...(next && next.value ? next.value : {}) })
        }
        read()
        return scope.subscribe(read)
      }, [scope])

      if (props && props.view === 'summary') {
        return React.createElement('div', { className: 'gho-sub' }, t('sub'))
      }

      const status = snapshot.status
      const value = snapshot.value || {}
      const ready = status === 'ready'
      const writable = ready && snapshot.writable !== false
      const current = draft || { ...value }

      const change = (key, next) => {
        setMessage('')
        setDraft({ ...current, [key]: next })
      }

      const save = async () => {
        if (!scope || typeof scope.set !== 'function') return
        setSaving(true)
        const failed = []
        const keys = ['tokenEnv', 'tokenSource', 'defaultRepository', 'baseUrl', 'timeoutMs', 'maxRetries', 'reviewRulesJson']
        for (const key of keys) {
          if (current[key] === value[key]) continue
          let next = current[key]
          if (key === 'timeoutMs' || key === 'maxRetries') {
            const numeric = Number(next)
            if (!Number.isFinite(numeric) || numeric <= 0) {
              failed.push(`${t(key)}: ${t('invalidNumber')}`)
              continue
            }
            next = numeric
          }
          try {
            await scope.set(key, next)
          } catch (err) {
            failed.push(`${key}: ${(err && err.message) || err}`)
          }
        }
        setSaving(false)
        setMessage(failed.length ? t('savedPartial') + failed.join('; ') : t('saved'))
        setDraft({ ...current })
      }

      const field = (key, labelKey, hintKey, kind) => React.createElement('div', { className: 'gho-field' },
        React.createElement('label', { className: 'gho-label', htmlFor: `${NS}-${key}` }, t(labelKey)),
        React.createElement('div', { className: 'gho-hint' }, t(hintKey)),
        kind === 'json'
          ? React.createElement('textarea', {
            id: `${NS}-${key}`,
            className: 'gho-input gho-input-area',
            rows: 3,
            spellCheck: false,
            value: current[key] === undefined || current[key] === null ? '' : String(current[key]),
            disabled: !writable,
            onChange: (event) => change(key, event.target.value),
          })
          : React.createElement('input', {
            id: `${NS}-${key}`,
            className: 'gho-input',
            type: kind === 'number' ? 'number' : 'text',
            value: current[key] === undefined || current[key] === null ? '' : String(current[key]),
            disabled: !writable,
            onChange: (event) => change(key, event.target.value),
          }),
      )

      const body = React.createElement('div', { className: 'gho-body' },
        status === 'loading' ? React.createElement('div', { className: 'gho-hint' }, t('statusLoading')) : null,
        status === 'unavailable' ? React.createElement('div', { className: 'gho-hint' }, t('statusUnavailable')) : null,
        ready && snapshot.writable === false ? React.createElement('div', { className: 'gho-hint' }, t('statusReadOnly')) : null,
        field('tokenEnv', 'tokenEnv', 'tokenEnvHint'),
        field('tokenSource', 'tokenSource', 'tokenSourceHint'),
        field('defaultRepository', 'defaultRepository', 'defaultRepositoryHint'),
        field('baseUrl', 'baseUrl', 'baseUrlHint'),
        field('timeoutMs', 'timeoutMs', 'timeoutMsHint', 'number'),
        field('maxRetries', 'maxRetries', 'maxRetriesHint', 'number'),
        field('reviewRulesJson', 'reviewRules', 'reviewRulesHint', 'json'),
        React.createElement('div', { className: 'gho-status' },
          React.createElement('div', { className: 'gho-status-head' },
            t('statusTitle'),
            React.createElement('button', { type: 'button', className: 'gho-link', onClick: loadStatus }, t('statusRefresh')),
          ),
          accessStatus === 'loading' ? React.createElement('div', { className: 'gho-status-row' }, t('statusLoading')) : null,
          statusError ? React.createElement('div', { className: 'gho-status-row gho-status-bad' }, `${t('statusError')}: ${statusError}`) : null,
          accessStatus && accessStatus !== 'loading' && !accessStatus.configured
            ? React.createElement('div', { className: 'gho-status-row' }, t('statusNotConfigured'))
            : null,
          accessStatus && accessStatus !== 'loading' && accessStatus.guidance
            ? React.createElement('div', { className: 'gho-status-row' }, accessStatus.guidance)
            : null,
          accessStatus && accessStatus !== 'loading' && accessStatus.configured
            ? React.createElement('div', null,
              React.createElement('div', { className: 'gho-status-row' },
                React.createElement('span', { className: 'gho-status-key' }, t('statusSource')),
                React.createElement('span', { className: 'gho-status-value' }, accessStatus.source || '—'),
              ),
              React.createElement('div', { className: 'gho-status-row' },
                React.createElement('span', { className: 'gho-status-key' }, t('statusAccount')),
                React.createElement('span', { className: 'gho-status-value' }, accessStatus.login || '—'),
              ),
              accessStatus.scopes ? React.createElement('div', { className: 'gho-status-row' },
                React.createElement('span', { className: 'gho-status-key' }, t('statusScopes')),
                React.createElement('span', { className: 'gho-status-value' }, accessStatus.scopes),
              ) : null,
              accessStatus.rateLimit ? React.createElement('div', { className: 'gho-status-row' },
                React.createElement('span', { className: 'gho-status-key' }, t('statusRate')),
                React.createElement('span', { className: 'gho-status-value' }, `${accessStatus.rateLimit.remaining ?? '?'}/${accessStatus.rateLimit.limit ?? '?'}${accessStatus.rateLimit.resetAt ? ` · ${accessStatus.rateLimit.resetAt}` : ''}`),
              ) : null,
              accessStatus.cache ? React.createElement('div', { className: 'gho-status-row' },
                React.createElement('span', { className: 'gho-status-key' }, t('statusCache')),
                React.createElement('span', { className: 'gho-status-value' }, `${accessStatus.cache.size} · ${accessStatus.cache.ttlMs} ms`),
              ) : null,
            )
            : null,
        ),
        React.createElement('div', { className: 'gho-foot' },
          React.createElement('span', { className: 'gho-note' }, message),
          React.createElement('button', {
            type: 'button',
            className: 'gho-save',
            disabled: !writable || saving,
            onClick: save,
          }, saving ? t('saving') : t('save')),
        ),
      )

      return React.createElement(page ? 'div' : 'li', { className: page ? 'gho-page' : 'gho-card' },
        React.createElement('button', {
          type: 'button',
          className: 'gho-head',
          style: page ? { display: 'none' } : undefined,
          'aria-expanded': page ? true : open,
          onClick: () => setOpen((v) => !v),
        },
          React.createElement('span', { className: 'gho-head-text' },
            React.createElement('span', { className: 'gho-title' }, t('title')),
            React.createElement('span', { className: 'gho-sub' }, t('cardHint')),
          ),
          React.createElement('span', { className: 'gho-chev' + (open ? ' gho-chev-open' : '') }, ChevronIcon ? React.createElement(ChevronIcon) : FALLBACK_CHEVRON),
        ),
        (page || open) ? body : null,
      )
    }

    function apply(ctx) {
      try {
        if (ctx.locale && typeof ctx.locale.register === 'function') {
          ctx.locale.register(NS, { en, zh })
        }
      } catch {
        /* dictionary already registered */
      }
      const seats = [
        { name: 'plugins.item', key: null, id: ROW_ID, order: 60, label: () => 'GitHub ops' },
        { name: 'plugins.row.config', key: ROW_CONFIG_KEY },
        { name: 'settings.plugin.item', key: NS },
      ]
      for (const seat of seats) {
        try {
          ctx.slots.inject(seat.name, () => {
            const entry = { name: seat.name, locale: NS, inject: () => ({ ctx }) }
            if (seat.key) entry.key = seat.key
            if (seat.id) entry.id = seat.id
            if (seat.order) entry.order = seat.order
            if (seat.label) entry.label = seat.label
            return ctx.slots.register(entry, GitHubOpsCard)
          })
        } catch {
          /* a core without this seat: the remaining seats still carry the card */
        }
      }
    }

      // The panel goes into the sidebar: better-sidebar first (its contract is explicit), and
      // the built-in right sidebar through its tab registry. Both are feature-detected, so a
      // composition without either still loads the plugin.
      try {
        ctx.inject(['betterSidebar'], (sctx) => {
          try {
            sctx.effect(() => sctx.betterSidebar.registerTab({
              id: 'github-ops:panel',
              title: 'GitHub',
              component: (viewProps) => React.createElement(GitHubPanel, { t: ctx.locale.bind(NS), scope: viewProps && viewProps.scope }),
            }), 'dsh-github-ops: better-sidebar panel')
          } catch {
            /* an older better-sidebar without registerTab */
          }
        })
      } catch {
        /* no better-sidebar in this composition */
      }
      try {
        ctx.inject(['sidebarRightTabs'], (sctx) => {
          try {
            sctx.effect(() => sctx.sidebarRightTabs.register({
              id: 'github-ops:panel',
              kind: 'github',
              patterns: ['dsh-resource://github/**'],
              priority: 'builtin',
              canOpen: (address) => String(address || '').startsWith('dsh-resource://github/'),
              title: () => 'GitHub',
            }), 'dsh-github-ops: sidebar tab')
          } catch {
            /* a core without the right-sidebar tab registry */
          }
        })
      } catch {
        /* no built-in right sidebar in this composition */
      }
      // The pull request bar above the composer: a suggestion, never a write.
      try {
        ctx.slots.inject('conversation.composer.bar', () => ctx.slots.register(
          { name: 'conversation.composer.bar', locale: NS, inject: () => ({ t: ctx.locale.bind(NS) }) },
          PullRequestBar,
        ))
      } catch {
        /* a core without the composer bar: the rest of the plugin still works */
      }
      installLinkWatcher()
      // The Source Control tab lives in the session view ring, the same seat the Memory tab
      // of dsh-memory-meter uses: a session-scoped view, not a navigation of our own.
      try {
        ctx.slots.inject('conversation.view', () => ctx.slots.register(
          {
            name: 'conversation.view',
            id: 'github-scm',
            order: 40,
            label: () => 'Source control',
            locale: NS,
            inject: () => ({ t: ctx.locale.bind(NS) }),
          },
          SourceControlView,
        ))
      } catch {
        /* a core without the session view ring: the rest of the plugin still works */
      }

    exports.inject = ['slots', 'locale', 'configForms']
    exports.apply = apply
    exports.GitHubOpsCard = GitHubOpsCard
    exports.SourceControlView = SourceControlView
    exports.SCM_ACTIONS = [
      'stage', 'unstage', 'discard', 'commit', 'push', 'sync',
      'branchCreate', 'branchCheckout', 'branchDelete',
      'stashPush', 'stashApply', 'stashPop', 'stashDrop', 'continue', 'abort',
    ]
    exports.PullRequestBar = PullRequestBar
    exports.GitHubPanel = GitHubPanel
    return module.exports
  },
})
