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
        scope = ctx && ctx.settingsScope && ctx.settingsScope.bind({ namespace: NS })
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

    exports.inject = ['slots', 'locale', 'settingsScope']
    exports.apply = apply
    exports.GitHubOpsCard = GitHubOpsCard
    return module.exports
  },
})
