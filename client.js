/**
 * dsh-github-manager — Client half.
 *
 * Registers one row in the shell's own left sidebar panel list
 * (`sidebar.panellist`) and the keyed center-column page (`main`) that opens
 * when that row is selected. All data comes from the Host route family over
 * same-origin fetch; tokens never reach the browser.
 */

window.__ModuleLoader__.load({
  id: 'dsh-github-manager',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const PANEL_ID = 'dsh-github-manager';
    const NS = 'dsh-github-manager';
    /** Document-relative on purpose: the GUI is served with <base href="./">. */
    const API = {
      status: 'api/dsh-github-manager/status',
      loginToken: 'api/dsh-github-manager/login/token',
      deviceStart: 'api/dsh-github-manager/login/device/start',
      devicePoll: 'api/dsh-github-manager/login/device/poll',
      remove: 'api/dsh-github-manager/accounts/remove',
      setDefault: 'api/dsh-github-manager/accounts/default',
      refresh: 'api/dsh-github-manager/accounts/refresh',
      repos: 'api/dsh-github-manager/repos',
    };
    const MARKER = 'x-dsh-github-manager';

    // ── copy ───────────────────────────────────────────────────────────────
    const COPY = {
      zh: {
        entry: 'GitHub 管理',
        title: 'GitHub 管理面板',
        subtitle: '在 dsh 内登录 GitHub，并让 AI 用你的账户操作仓库、Issue 与 PR。',
        noAccount: '还没有连接任何 GitHub 账户。',
        addTitle: '添加账户',
        addPat: 'Personal Access Token',
        patHint: '在 GitHub → Settings → Developer settings → Personal access tokens 创建，至少勾选 repo 权限。令牌只保存在本机，不会回传给浏览器。',
        add: '添加',
        adding: '验证中…',
        label: '备注（可选）',
        deviceTitle: '用浏览器登录（设备码）',
        deviceNeed: '需要先填写一个 GitHub OAuth App 的 Client ID（设备流不支持匿名客户端）。',
        deviceStart: '开始设备登录',
        deviceWaiting: '请在 GitHub 页面输入设备码…',
        deviceCode: '设备码',
        accounts: '已连接账户',
        setDefault: '设为默认',
        refresh: '刷新',
        remove: '移除',
        defaultBadge: '默认',
        scopes: '权限',
        repos: '最近仓库',
        reposLoad: '加载仓库',
        reposLoading: '加载中…',
        emptyRepos: '还没有加载仓库。',
        openOnGithub: '在 GitHub 打开',
        error: '出错',
        ok: '完成',
        loading: '加载中…',
        tokenSavedNote: '令牌已保存在本机 dsh 目录，仅你的账户可读。',
        aiHint: '在本对话里直接让我操作 GitHub，例如「列出我最近的仓库」「给 xx 仓库建一个 issue」。',
      },
      en: {
        entry: 'GitHub',
        title: 'GitHub manager',
        subtitle: 'Sign in to GitHub inside dsh and let the AI act on repos, issues and PRs as you.',
        noAccount: 'No GitHub account connected yet.',
        addTitle: 'Add an account',
        addPat: 'Personal access token',
        patHint: 'Create one under GitHub → Settings → Developer settings → Personal access tokens, with at least repo scope. The token stays on this machine and is never sent back to the browser.',
        add: 'Add',
        adding: 'Verifying…',
        label: 'Label (optional)',
        deviceTitle: 'Sign in with a browser (device code)',
        deviceNeed: 'Requires the Client ID of a GitHub OAuth App; the device flow needs one, it cannot run anonymously.',
        deviceStart: 'Start device login',
        deviceWaiting: 'Enter the device code on the GitHub page…',
        deviceCode: 'Device code',
        accounts: 'Connected accounts',
        setDefault: 'Set default',
        refresh: 'Refresh',
        remove: 'Remove',
        defaultBadge: 'Default',
        scopes: 'Scopes',
        repos: 'Recent repositories',
        reposLoad: 'Load repositories',
        reposLoading: 'Loading…',
        emptyRepos: 'No repositories loaded yet.',
        openOnGithub: 'Open on GitHub',
        error: 'Error',
        ok: 'Done',
        loading: 'Loading…',
        tokenSavedNote: 'The token is stored in your local dsh directory and readable only by your account.',
        aiHint: 'Just ask me here, e.g. "list my recent repositories" or "open an issue on the xx repo".',
      },
    };

    function pickCopy() {
      try {
        const lang = document.documentElement.lang || '';
        return lang.toLowerCase().startsWith('zh') ? COPY.zh : COPY.en;
      } catch {
        return COPY.zh;
      }
    }

    const t = pickCopy();

    // ── styles ─────────────────────────────────────────────────────────────
    const CSS = `
.gm-view{height:100%;min-height:0;display:flex;flex-direction:column;overflow:auto;padding:18px 22px;gap:14px;box-sizing:border-box}
.gm-head{display:flex;flex-direction:column;gap:4px}
.gm-title{font-size:18px;font-weight:650;color:var(--dsw-alias-label-primary,#eee)}
.gm-sub{font-size:12.5px;line-height:19px;color:var(--dsw-alias-label-tertiary,#a0a0a0)}
.gm-card{border:0.5px solid var(--dsw-alias-border-l1,#3a3a3a);border-radius:10px;padding:13px 15px;background:var(--dsw-alias-bg-l1,#1c1c1c);display:flex;flex-direction:column;gap:10px}
.gm-card-title{font-size:13.5px;font-weight:600;color:var(--dsw-alias-label-primary,#eee)}
.gm-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.gm-input,.gm-textarea{flex:1 1 220px;min-width:0;background:var(--dsw-alias-bg-l2,#141414);color:var(--dsw-alias-label-primary,#eee);border:0.5px solid var(--dsw-alias-border-l1,#3a3a3a);border-radius:7px;padding:7px 9px;font-size:12.5px;font-family:inherit;outline:none}
.gm-input:focus,.gm-textarea:focus{border-color:var(--dsw-alias-brand-primary,#4f8cff)}
.gm-textarea{resize:vertical;min-height:38px;line-height:17px}
.gm-btn{flex:none;cursor:pointer;border-radius:7px;border:0.5px solid var(--dsw-alias-border-l1,#3a3a3a);background:var(--dsw-alias-interactive-bg-hover,#2a2a2a);color:var(--dsw-alias-label-primary,#eee);font-size:12.5px;padding:6px 12px;font-family:inherit;white-space:nowrap}
.gm-btn:hover:not(:disabled){border-color:var(--dsw-alias-brand-primary,#4f8cff);color:var(--dsw-alias-brand-primary,#4f8cff)}
.gm-btn:disabled{opacity:.55;cursor:not-allowed}
.gm-btn-primary{background:var(--dsw-alias-brand-primary,#4f8cff);border-color:transparent;color:#fff;font-weight:600}
.gm-btn-primary:hover:not(:disabled){color:#fff;filter:brightness(1.08)}
.gm-btn-danger:hover:not(:disabled){border-color:#e05c5c;color:#e05c5c}
.gm-hint{font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-tertiary,#a0a0a0)}
.gm-msg{font-size:12px;padding:7px 10px;border-radius:7px;line-height:17px;word-break:break-word}
.gm-msg-err{background:rgba(224,92,92,.12);color:#f08080;border:0.5px solid rgba(224,92,92,.35)}
.gm-msg-ok{background:rgba(70,170,110,.12);color:#5fc08a;border:0.5px solid rgba(70,170,110,.35)}
.gm-acct{display:flex;align-items:center;gap:10px;padding:9px 0;border-top:0.5px solid var(--dsw-alias-border-l1,#3a3a3a);flex-wrap:wrap}
.gm-acct:first-of-type{border-top:0}
.gm-avatar{width:26px;height:26px;border-radius:50%;flex:none;background:#333;object-fit:cover}
.gm-acct-main{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1 1 140px}
.gm-login{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#eee);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gm-meta{font-size:11px;color:var(--dsw-alias-label-tertiary,#a0a0a0);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gm-badge{font-size:10.5px;padding:1px 6px;border-radius:4px;background:var(--dsw-alias-interactive-bg-hover,#2a2a2a);color:var(--dsw-alias-label-secondary,#b9b9b9);border:0.5px solid var(--dsw-alias-border-l1,#3a3a3a)}
.gm-badge-default{background:rgba(79,140,255,.16);color:#6fa4ff;border-color:rgba(79,140,255,.4)}
.gm-repo{display:flex;align-items:center;gap:9px;padding:7px 0;border-top:0.5px solid var(--dsw-alias-border-l1,#3a3a3a);flex-wrap:wrap}
.gm-repo:first-of-type{border-top:0}
.gm-repo-name{font-size:12.5px;color:var(--dsw-alias-label-primary,#eee);flex:1 1 150px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gm-repo-desc{font-size:11px;color:var(--dsw-alias-label-tertiary,#a0a0a0);flex:1 1 100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gm-link{color:#6fa4ff;text-decoration:none;font-size:11.5px;white-space:nowrap}
.gm-link:hover{text-decoration:underline}
.gm-device{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.gm-device-code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:17px;letter-spacing:2px;font-weight:700;color:#6fa4ff;padding:5px 11px;border-radius:7px;background:rgba(79,140,255,.12);border:0.5px solid rgba(79,140,255,.35)}
`;

    // ── api ────────────────────────────────────────────────────────────────
    async function call(path, body, method) {
      const init = { method: method ?? (body === undefined ? 'GET' : 'POST'), headers: {} };
      if (body !== undefined) {
        init.headers['content-type'] = 'application/json';
        init.headers[MARKER] = '1';
        init.body = JSON.stringify(body);
      }
      const response = await fetch(path, init);
      let payload;
      try {
        payload = await response.json();
      } catch {
        payload = undefined;
      }
      if (!response.ok) {
        const message = payload && typeof payload.error === 'string' ? payload.error : `HTTP ${response.status}`;
        throw new Error(message);
      }
      if (payload && payload.ok === false) throw new Error(payload.error ?? 'GitHub operation failed');
      return payload;
    }

    // ── icons ──────────────────────────────────────────────────────────────
    function PanelIcon({ size }) {
      const edge = typeof size === 'number' ? size : 16;
      return h('svg', {
        'data-dsh-panel-entry': PANEL_ID,
        viewBox: '0 0 16 16', width: edge, height: edge,
        fill: 'none', stroke: 'currentColor', strokeWidth: 1.3,
        strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true',
      },
        h('path', { d: 'M6 2.6C4.6 1.7 2.9 1.7 1.6 1.7v11c1.3 0 3 0 4.4.9 1.4-.9 3.1-.9 4.4-.9v-11c-1.3 0-3 0-4.4.9z' }),
        h('path', { d: 'M6 2.6v11.1' }),
      );
    }

    function GitHubGlyph() {
      return h('svg', { viewBox: '0 0 16 16', width: 15, height: 15, fill: 'currentColor', 'aria-hidden': 'true' },
        h('path', {
          d: 'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z',
        }),
      );
    }

    // ── panel page ─────────────────────────────────────────────────────────
    function PanelPage() {
      const [status, setStatus] = React.useState(null);
      const [busy, setBusy] = React.useState('');
      const [error, setError] = React.useState('');
      const [notice, setNotice] = React.useState('');
      const [token, setToken] = React.useState('');
      const [label, setLabel] = React.useState('');
      const [clientId, setClientId] = React.useState('');
      const [device, setDevice] = React.useState(null);
      const [repos, setRepos] = React.useState([]);
      const [reposBusy, setReposBusy] = React.useState(false);

      const run = React.useCallback(async (key, fn) => {
        setBusy(key);
        setError('');
        setNotice('');
        try {
          const result = await fn();
          return result;
        } catch (caught) {
          setError(String(caught?.message ?? caught));
          return undefined;
        } finally {
          setBusy('');
        }
      }, []);

      const load = React.useCallback(async () => {
        try {
          const result = await call(API.status);
          setStatus(result);
        } catch (caught) {
          setError(String(caught?.message ?? caught));
        }
      }, []);

      React.useEffect(() => { load(); }, [load]);

      // device-flow polling: one timer, cleared on unmount or completion
      React.useEffect(() => {
        if (!device || !device.deviceCode) return undefined;
        let stopped = false;
        let timer;
        const tick = async () => {
          if (stopped) return;
          try {
            const result = await call(API.devicePoll, { clientId: device.clientId, deviceCode: device.deviceCode }, 'POST');
            if (stopped) return;
            if (result && result.pending) {
              timer = window.setTimeout(tick, Math.max(5, Number(device.interval) || 5) * 1000);
              return;
            }
            setDevice(null);
            setNotice(`${t.ok} — ${result?.account?.login ?? ''}`);
            load();
          } catch (caught) {
            if (stopped) return;
            setError(String(caught?.message ?? caught));
            setDevice(null);
          }
        };
        timer = window.setTimeout(tick, Math.max(5, Number(device.interval) || 5) * 1000);
        return () => { stopped = true; if (timer !== undefined) window.clearTimeout(timer); };
      }, [device, load]);

      const addToken = () => run('add', async () => {
        const result = await call(API.loginToken, { token, label }, 'POST');
        setToken('');
        setLabel('');
        setStatus({ ok: true, accounts: result.accounts, activeAccountId: result.activeAccountId, deviceClientId: status?.deviceClientId ?? '' });
        setNotice(`${t.ok} — ${result.account?.login ?? ''}`);
        return result;
      });

      const startDevice = () => run('device', async () => {
        const result = await call(API.deviceStart, { clientId }, 'POST');
        setDevice(result);
        return result;
      });

      const makeDefault = (id) => run(`default:${id}`, async () => {
        const result = await call(API.setDefault, { id }, 'POST');
        setStatus((prev) => ({ ...(prev ?? {}), ...result }));
      });

      const refresh = (id) => run(`refresh:${id}`, async () => {
        const result = await call(API.refresh, { id }, 'POST');
        setStatus((prev) => ({ ...(prev ?? {}), ...result }));
      });

      const remove = (id) => run(`remove:${id}`, async () => {
        const result = await call(API.remove, { id }, 'POST');
        setStatus((prev) => ({ ...(prev ?? {}), ...result }));
      });

      const loadRepos = () => {
        setReposBusy(true);
        setError('');
        call(API.repos, undefined, 'GET')
          .then((result) => {
            const list = Array.isArray(result?.body) ? result.body : [];
            setRepos(list);
          })
          .catch((caught) => setError(String(caught?.message ?? caught)))
          .finally(() => setReposBusy(false));
      };

      const accounts = Array.isArray(status?.accounts) ? status.accounts : [];

      return h('div', { className: 'gm-view', 'data-dsh-plugin': PANEL_ID },
        h('style', null, CSS),
        h('div', { className: 'gm-head' },
          h('div', { className: 'gm-title' }, t.title),
          h('div', { className: 'gm-sub' }, t.subtitle),
        ),
        error !== '' ? h('div', { className: 'gm-msg gm-msg-err' }, error) : null,
        notice !== '' ? h('div', { className: 'gm-msg gm-msg-ok' }, notice) : null,

        // accounts list
        h('div', { className: 'gm-card' },
          h('div', { className: 'gm-card-title' }, t.accounts),
          accounts.length === 0
            ? h('div', { className: 'gm-hint' }, t.noAccount)
            : accounts.map((account) => h('div', { className: 'gm-acct', key: account.id },
                account.avatarUrl
                  ? h('img', { className: 'gm-avatar', src: account.avatarUrl, alt: '', loading: 'lazy' })
                  : h('span', { className: 'gm-avatar', style: { display: 'inline-grid', placeItems: 'center' } }, h(GitHubGlyph, null)),
                h('div', { className: 'gm-acct-main' },
                  h('div', { className: 'gm-login' }, account.login || account.id),
                  h('div', { className: 'gm-meta' },
                    (account.name ? `${account.name} · ` : '') + (account.tokenPreview ?? '') +
                    (Array.isArray(account.scopes) && account.scopes.length ? ` · ${account.scopes.join(',')}` : ''),
                  ),
                  account.lastError ? h('div', { className: 'gm-meta', style: { color: '#f08080' } }, account.lastError) : null,
                ),
                account.isDefault ? h('span', { className: 'gm-badge gm-badge-default' }, t.defaultBadge) : null,
                account.isDefault ? null : h('button', {
                  type: 'button', className: 'gm-btn', disabled: busy !== '',
                  onClick: () => makeDefault(account.id),
                }, t.setDefault),
                h('button', { type: 'button', className: 'gm-btn', disabled: busy !== '', onClick: () => refresh(account.id) }, t.refresh),
                h('button', { type: 'button', className: 'gm-btn gm-btn-danger', disabled: busy !== '', onClick: () => remove(account.id) }, t.remove),
              )),
        ),

        // add by token
        h('div', { className: 'gm-card' },
          h('div', { className: 'gm-card-title' }, t.addTitle),
          h('div', { className: 'gm-row' },
            h('input', {
              className: 'gm-input', type: 'password', autoComplete: 'off', spellCheck: false,
              placeholder: t.addPat, value: token,
              onChange: (event) => setToken(event.target.value),
            }),
          ),
          h('div', { className: 'gm-row' },
            h('input', {
              className: 'gm-input', type: 'text', placeholder: t.label, value: label,
              onChange: (event) => setLabel(event.target.value),
            }),
            h('button', {
              type: 'button', className: 'gm-btn gm-btn-primary',
              disabled: busy !== '' || token.trim() === '',
              onClick: addToken,
            }, busy === 'add' ? t.adding : t.add),
          ),
          h('div', { className: 'gm-hint' }, t.patHint),
        ),

        // device flow
        h('div', { className: 'gm-card' },
          h('div', { className: 'gm-card-title' }, t.deviceTitle),
          device
            ? h('div', { className: 'gm-device' },
                h('span', { className: 'gm-device-code' }, device.userCode),
                h('a', {
                  className: 'gm-link', href: device.verificationUri, target: '_blank', rel: 'noreferrer noopener',
                }, device.verificationUri),
                h('span', { className: 'gm-hint' }, t.deviceWaiting),
              )
            : h(React.Fragment, null,
                h('div', { className: 'gm-row' },
                  h('input', {
                    className: 'gm-input', type: 'text', placeholder: 'OAuth App Client ID', value: clientId,
                    onChange: (event) => setClientId(event.target.value),
                  }),
                  h('button', {
                    type: 'button', className: 'gm-btn', disabled: busy !== '' || clientId.trim() === '',
                    onClick: startDevice,
                  }, t.deviceStart),
                ),
                h('div', { className: 'gm-hint' }, t.deviceNeed),
              ),
        ),

        // repos
        h('div', { className: 'gm-card' },
          h('div', { className: 'gm-row' },
            h('div', { className: 'gm-card-title', style: { flex: '1 1 auto' } }, t.repos),
            h('button', { type: 'button', className: 'gm-btn', disabled: reposBusy || accounts.length === 0, onClick: loadRepos },
              reposBusy ? t.reposLoading : t.reposLoad),
          ),
          repos.length === 0
            ? h('div', { className: 'gm-hint' }, accounts.length === 0 ? t.noAccount : t.emptyRepos)
            : repos.map((repo) => h('div', { className: 'gm-repo', key: repo.full_name ?? repo.name },
                h(GitHubGlyph, null),
                h('span', { className: 'gm-repo-name' }, repo.full_name ?? repo.name ?? ''),
                Array.isArray(repo.topics) && repo.topics.length
                  ? h('span', { className: 'gm-badge' }, repo.topics.slice(0, 2).join(' '))
                  : null,
                h('a', {
                  className: 'gm-link', href: repo.html_url, target: '_blank', rel: 'noreferrer noopener',
                }, t.openOnGithub),
                repo.description ? h('span', { className: 'gm-repo-desc' }, repo.description) : null,
              )),
        ),

        h('div', { className: 'gm-hint' }, t.aiHint),
        h('div', { className: 'gm-hint' }, t.tokenSavedNote),
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const disposers = [];
        // Left sidebar row (shell-owned list) + the keyed center page.
        disposers.push(ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 35,
          label: () => t.entry,
        }, PanelIcon)));
        disposers.push(ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
        }, PanelPage)));
        ctx.effect(() => () => {
          for (const dispose of disposers.splice(0)) {
            try { dispose(); } catch { /* already released */ }
          }
        }, `${NS}: panel registrations`);
      },
    };
  },
});
