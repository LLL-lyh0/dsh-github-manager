/**
 * dsh-github-manager — Client half.
 *
 * Registers a row in the shell's own left sidebar panel list
 * (`sidebar.panellist`), ordered right after the built-in 插件/自动化任务 rows,
 * plus the keyed center-column page (`main`) that opens when it is selected.
 *
 * The panel is a READ-ONLY repository viewer for the selected account: profile,
 * rollup statistics, a filterable repository list and a per-repository detail
 * view. It deliberately has no sign-in, no write call and no AI handoff — every
 * change goes through the `github-manager` skill's tools, which the model loads
 * when the conversation is about GitHub. Nothing here can mutate the account.
 */

window.__ModuleLoader__.load({
  id: 'dsh-github-manager',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const PANEL_ID = 'dsh-github-manager';
    const NS = 'dsh-github-manager';
    /**
     * Sits immediately after the built-in 插件 row (order 0) and 自动化任务 row
     * (order 10), and ahead of Jet Hub (20), 技能中心 (30) and 记忆系统 (30-31).
     * Chosen so the built-in pair is not split and the entry lands in the same
     * top-left group the user asked for.
     */
    const PANEL_ORDER = 11;
    /** Document-relative on purpose: the GUI is served with <base href="./">. */
    const API = {
      status: 'api/dsh-github-manager/status',
      overview: 'api/dsh-github-manager/overview',
      repo: 'api/dsh-github-manager/repo',
    };

    // ── copy ───────────────────────────────────────────────────────────────
    const COPY = {
      zh: {
        entry: 'GitHub 仓库',
        title: 'GitHub 仓库',
        subtitle: '只读查看当前账户的仓库概况。要改动仓库、Issue 或 PR，直接在对话里让 AI 处理。',
        loading: '加载中…',
        reload: '刷新',
        noAccount: '还没有连接任何 GitHub 账户。',
        noAccountHint: '在对话里说「登录 GitHub」，AI 会带你走设备码登录（不需要把令牌贴进聊天）。',
        readOnlyBadge: '只读',
        repositories: '仓库',
        filter: '筛选仓库…',
        sortUpdated: '最近更新',
        sortName: '名称',
        sortStars: '星标',
        showAll: '全部',
        showPublic: '公开',
        showPrivate: '私有',
        showArchived: '含已归档',
        empty: '没有匹配的仓库。',
        emptyRepos: '这个账户还没有可见的仓库。',
        truncated: '仅显示最近更新的 100 个仓库（GitHub 分页上限）。',
        statsRepos: '仓库',
        statsStars: '星标',
        statsPrivate: '私有',
        statsFollowers: '关注者',
        languages: '主要语言',
        openOnGithub: '在 GitHub 打开',
        back: '返回列表',
        detailBranches: '分支',
        detailCommits: '最近提交',
        detailLanguages: '语言构成',
        detailNoCommits: '没有提交记录（仓库可能还是空的）。',
        detailNoBranches: '没有分支（空仓库）。',
        updatedAt: '更新于',
        pushedAt: '推送于',
        visibilityPrivate: '私有',
        visibilityPublic: '公开',
        archived: '已归档',
        fork: '派生',
        openIssues: 'Issue',
        forks: '派生',
        defaultBranch: '默认分支',
        size: '大小',
        homepage: '主页',
        error: '出错了',
        account: '账户',
      },
      en: {
        entry: 'GitHub repos',
        title: 'GitHub repositories',
        subtitle: 'Read-only view of the selected account. To change repos, issues or PRs, ask the AI in the conversation.',
        loading: 'Loading…',
        reload: 'Reload',
        noAccount: 'No GitHub account connected yet.',
        noAccountHint: 'Say "sign in to GitHub" in the conversation — the AI walks you through the device flow, so no token enters the chat.',
        readOnlyBadge: 'Read-only',
        repositories: 'Repositories',
        filter: 'Filter repositories…',
        sortUpdated: 'Recently updated',
        sortName: 'Name',
        sortStars: 'Stars',
        showAll: 'All',
        showPublic: 'Public',
        showPrivate: 'Private',
        showArchived: 'Include archived',
        empty: 'No repository matches.',
        emptyRepos: 'This account has no visible repositories.',
        truncated: 'Showing the 100 most recently updated repositories (GitHub page limit).',
        statsRepos: 'Repos',
        statsStars: 'Stars',
        statsPrivate: 'Private',
        statsFollowers: 'Followers',
        languages: 'Top languages',
        openOnGithub: 'Open on GitHub',
        back: 'Back to list',
        detailBranches: 'Branches',
        detailCommits: 'Recent commits',
        detailLanguages: 'Language breakdown',
        detailNoCommits: 'No commits yet (the repository may be empty).',
        detailNoBranches: 'No branches (empty repository).',
        updatedAt: 'Updated',
        pushedAt: 'Pushed',
        visibilityPrivate: 'Private',
        visibilityPublic: 'Public',
        archived: 'Archived',
        fork: 'Fork',
        openIssues: 'Issues',
        forks: 'Forks',
        defaultBranch: 'Default branch',
        size: 'Size',
        homepage: 'Homepage',
        error: 'Something went wrong',
        account: 'Account',
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
.gm-title-row{display:flex;align-items:center;gap:9px;flex-wrap:wrap}
.gm-title{font-size:18px;font-weight:650;color:var(--dsw-alias-label-primary,#eee)}
.gm-badge-readonly{font-size:10.5px;font-weight:600;padding:2px 7px;border-radius:5px;background:rgba(70,170,110,.14);color:#5fc08a;border:0.5px solid rgba(70,170,110,.4);letter-spacing:.3px}
.gm-sub{font-size:12.5px;line-height:19px;color:var(--dsw-alias-label-tertiary,#a0a0a0)}
.gm-card{border:0.5px solid var(--dsw-alias-border-l1,#3a3a3a);border-radius:10px;padding:13px 15px;background:var(--dsw-alias-bg-l1,#1c1c1c);display:flex;flex-direction:column;gap:11px}
.gm-card-title{font-size:13.5px;font-weight:600;color:var(--dsw-alias-label-primary,#eee)}
.gm-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.gm-btn{flex:none;cursor:pointer;border-radius:7px;border:0.5px solid var(--dsw-alias-border-l1,#3a3a3a);background:var(--dsw-alias-interactive-bg-hover,#2a2a2a);color:var(--dsw-alias-label-primary,#eee);font-size:12.5px;padding:6px 12px;font-family:inherit;white-space:nowrap}
.gm-btn:hover:not(:disabled){border-color:var(--dsw-alias-brand-primary,#4f8cff);color:var(--dsw-alias-brand-primary,#4f8cff)}
.gm-btn:disabled{opacity:.55;cursor:not-allowed}
.gm-btn-ghost{background:none}
.gm-input{flex:1 1 200px;min-width:0;background:var(--dsw-alias-bg-l2,#141414);color:var(--dsw-alias-label-primary,#eee);border:0.5px solid var(--dsw-alias-border-l1,#3a3a3a);border-radius:7px;padding:7px 9px;font-size:12.5px;font-family:inherit;outline:none}
.gm-input:focus{border-color:var(--dsw-alias-brand-primary,#4f8cff)}
.gm-select{flex:none;background:var(--dsw-alias-bg-l2,#141414);color:var(--dsw-alias-label-primary,#eee);border:0.5px solid var(--dsw-alias-border-l1,#3a3a3a);border-radius:7px;padding:6px 8px;font-size:12.5px;font-family:inherit}
.gm-chips{display:flex;gap:6px;flex-wrap:wrap}
.gm-chip{cursor:pointer;border-radius:14px;border:0.5px solid var(--dsw-alias-border-l1,#3a3a3a);background:none;color:var(--dsw-alias-label-tertiary,#a0a0a0);font-size:11.5px;padding:3px 11px;font-family:inherit}
.gm-chip:hover{color:var(--dsw-alias-label-primary,#eee)}
.gm-chip-on{background:rgba(79,140,255,.16);color:#6fa4ff;border-color:rgba(79,140,255,.45);font-weight:600}
.gm-hint{font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-tertiary,#a0a0a0)}
.gm-msg{font-size:12px;padding:7px 10px;border-radius:7px;line-height:17px;word-break:break-word}
.gm-msg-err{background:rgba(224,92,92,.12);color:#f08080;border:0.5px solid rgba(224,92,92,.35)}
.gm-profile{display:flex;align-items:center;gap:13px;flex-wrap:wrap}
.gm-avatar{width:46px;height:46px;border-radius:50%;flex:none;background:#333;object-fit:cover}
.gm-avatar-fb{width:46px;height:46px;border-radius:50%;flex:none;background:#333;display:grid;place-items:center;color:#bbb}
.gm-profile-main{display:flex;flex-direction:column;gap:3px;min-width:0;flex:1 1 180px}
.gm-login{font-size:15px;font-weight:650;color:var(--dsw-alias-label-primary,#eee);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gm-meta{font-size:11.5px;color:var(--dsw-alias-label-tertiary,#a0a0a0);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gm-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(74px,1fr));gap:9px}
.gm-stat{display:flex;flex-direction:column;gap:1px;padding:8px 10px;border-radius:8px;background:var(--dsw-alias-bg-l2,#141414);border:0.5px solid var(--dsw-alias-border-l1,#3a3a3a)}
.gm-stat-num{font-size:16px;font-weight:650;color:var(--dsw-alias-label-primary,#eee);font-variant-numeric:tabular-nums}
.gm-stat-label{font-size:10.5px;color:var(--dsw-alias-label-tertiary,#a0a0a0)}
.gm-langs{display:flex;gap:6px;flex-wrap:wrap}
.gm-lang{font-size:11px;padding:2px 8px;border-radius:5px;border:0.5px solid var(--dsw-alias-border-l1,#3a3a3a);color:var(--dsw-alias-label-secondary,#b9b9b9)}
.gm-repo{display:flex;align-items:flex-start;gap:9px;padding:9px 0;border-top:0.5px solid var(--dsw-alias-border-l1,#3a3a3a);flex-wrap:wrap}
.gm-repo:first-of-type{border-top:0}
.gm-repo-glyph{flex:none;color:var(--dsw-alias-label-tertiary,#a0a0a0);margin-top:2px}
.gm-repo-main{display:flex;flex-direction:column;gap:3px;min-width:0;flex:1 1 200px}
.gm-repo-name{font-size:12.5px;font-weight:600;color:var(--dsw-alias-label-primary,#eee);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer}
.gm-repo-name:hover{color:#6fa4ff;text-decoration:underline}
.gm-repo-desc{font-size:11px;color:var(--dsw-alias-label-tertiary,#a0a0a0);overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;line-height:16px}
.gm-repo-facts{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:10.5px;color:var(--dsw-alias-label-tertiary,#a0a0a0)}
.gm-dot{width:3px;height:3px;border-radius:50%;background:currentColor;flex:none}
.gm-tag{font-size:10px;padding:1px 6px;border-radius:4px;border:0.5px solid var(--dsw-alias-border-l1,#3a3a3a);color:var(--dsw-alias-label-secondary,#b9b9b9)}
.gm-tag-private{background:rgba(230,180,80,.13);color:#e0b45a;border-color:rgba(230,180,80,.4)}
.gm-tag-archived{background:rgba(180,120,220,.13);color:#c79ae8;border-color:rgba(180,120,220,.4)}
.gm-link{color:#6fa4ff;text-decoration:none;font-size:11.5px;white-space:nowrap}
.gm-link:hover{text-decoration:underline}
.gm-kv{display:grid;grid-template-columns:auto 1fr;gap:5px 12px;font-size:11.5px;align-items:baseline}
.gm-kv-k{color:var(--dsw-alias-label-tertiary,#a0a0a0);white-space:nowrap}
.gm-kv-v{color:var(--dsw-alias-label-primary,#eee);min-width:0;overflow:hidden;text-overflow:ellipsis}
.gm-commit{display:flex;align-items:baseline;gap:8px;padding:5px 0;border-top:0.5px solid var(--dsw-alias-border-l1,#333);font-size:11.5px;flex-wrap:wrap}
.gm-commit:first-of-type{border-top:0}
.gm-sha{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10.5px;color:#6fa4ff;flex:none}
.gm-commit-msg{flex:1 1 160px;min-width:0;color:var(--dsw-alias-label-primary,#eee);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gm-commit-meta{font-size:10.5px;color:var(--dsw-alias-label-tertiary,#a0a0a0);flex:none}
.gm-bar{height:6px;border-radius:3px;background:var(--dsw-alias-bg-l2,#141414);overflow:hidden;display:flex}
.gm-bar-seg{height:100%}
.gm-bar-row{display:flex;align-items:center;gap:8px;font-size:11px}
.gm-bar-name{flex:0 0 92px;color:var(--dsw-alias-label-secondary,#b9b9b9);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gm-bar-track{flex:1 1 80px;height:6px;border-radius:3px;background:var(--dsw-alias-bg-l2,#141414);overflow:hidden}
.gm-bar-fill{height:100%;border-radius:3px;background:#4f8cff}
.gm-bar-pct{flex:0 0 42px;text-align:right;color:var(--dsw-alias-label-tertiary,#a0a0a0);font-variant-numeric:tabular-nums}
`;

    // ── api ────────────────────────────────────────────────────────────────
    /** Read-only fetch. Any non-2xx or `ok:false` body becomes a thrown Error. */
    async function fetchView(path) {
      const response = await fetch(path, { method: 'GET', headers: { accept: 'application/json' } });
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
      if (payload && payload.ok === false) throw new Error(payload.error ?? t.error);
      return payload;
    }

    // ── helpers ────────────────────────────────────────────────────────────
    function withParams(path, params) {
      const search = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null || value === '') continue;
        search.set(key, String(value));
      }
      const qs = search.toString();
      return qs === '' ? path : `${path}?${qs}`;
    }

    function formatCount(value) {
      const number = Number(value) || 0;
      if (number < 1000) return String(number);
      if (number < 1_000_000) return `${(number / 1000).toFixed(number < 10_000 ? 1 : 0)}k`;
      return `${(number / 1_000_000).toFixed(1)}M`;
    }

    function formatSize(kb) {
      const number = Number(kb) || 0;
      if (number < 1024) return `${number} KB`;
      if (number < 1024 * 1024) return `${(number / 1024).toFixed(1)} MB`;
      return `${(number / (1024 * 1024)).toFixed(1)} GB`;
    }

    function formatDate(value) {
      if (typeof value !== 'string' || value === '') return '';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return value;
      try {
        return date.toLocaleDateString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' });
      } catch {
        return date.toISOString().slice(0, 10);
      }
    }

    function relativeDate(value) {
      if (typeof value !== 'string' || value === '') return '';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return value;
      const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
      if (days <= 0) return 'today';
      if (days === 1) return '1d';
      if (days < 30) return `${days}d`;
      if (days < 365) return `${Math.floor(days / 30)}mo`;
      return `${Math.floor(days / 365)}y`;
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

    function RepoGlyph() {
      return h('svg', {
        viewBox: '0 0 16 16', width: 13, height: 13, fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round',
        strokeLinejoin: 'round', 'aria-hidden': 'true', className: 'gm-repo-glyph',
      },
        h('path', { d: 'M2.5 2.5h8.5a1.2 1.2 0 0 1 1.2 1.2v9.8H3.7a1.2 1.2 0 0 1-1.2-1.2z' }),
        h('path', { d: 'M2.5 11.2h9.7' }),
        h('path', { d: 'M5 5h4.5' }),
      );
    }

    // ── repository detail ──────────────────────────────────────────────────
    function RepoDetail({ owner, name, accountId, onBack }) {
      const [state, setState] = React.useState({ loading: true, data: null, error: '' });

      const load = React.useCallback(() => {
        setState({ loading: true, data: null, error: '' });
        fetchView(withParams(API.repo, { accountId, owner, name }))
          .then((data) => setState({ loading: false, data, error: '' }))
          .catch((caught) => setState({ loading: false, data: null, error: String(caught?.message ?? caught) }));
      }, [accountId, owner, name]);

      React.useEffect(() => { load(); }, [load]);

      const repo = state.data && state.data.repo ? state.data.repo : null;
      const languages = state.data && Array.isArray(state.data.languages) ? state.data.languages : [];
      const branches = state.data && Array.isArray(state.data.branches) ? state.data.branches : [];
      const commits = state.data && Array.isArray(state.data.commits) ? state.data.commits : [];

      return h('div', { className: 'gm-view', 'data-dsh-plugin': PANEL_ID },
        h('style', null, CSS),
        h('div', { className: 'gm-row' },
          h('button', { type: 'button', className: 'gm-btn gm-btn-ghost', onClick: onBack }, `← ${t.back}`),
          h('div', { style: { flex: '1 1 auto' } }),
          repo && repo.htmlUrl ? h('a', { className: 'gm-link', href: repo.htmlUrl, target: '_blank', rel: 'noreferrer noopener' }, t.openOnGithub) : null,
          h('button', { type: 'button', className: 'gm-btn', disabled: state.loading, onClick: load }, t.reload),
        ),
        state.error !== '' ? h('div', { className: 'gm-msg gm-msg-err' }, state.error) : null,
        state.loading ? h('div', { className: 'gm-hint' }, t.loading) : null,

        repo
          ? h(React.Fragment, null,
              h('div', { className: 'gm-card' },
                h('div', { className: 'gm-title-row' },
                  h('div', { className: 'gm-title' }, repo.fullName || `${owner}/${name}`),
                  repo.private ? h('span', { className: 'gm-tag gm-tag-private' }, t.visibilityPrivate) : h('span', { className: 'gm-tag' }, t.visibilityPublic),
                  repo.archived ? h('span', { className: 'gm-tag gm-tag-archived' }, t.archived) : null,
                  repo.fork ? h('span', { className: 'gm-tag' }, t.fork) : null,
                ),
                repo.description ? h('div', { className: 'gm-sub' }, repo.description) : null,
                h('div', { className: 'gm-kv' },
                  h('span', { className: 'gm-kv-k' }, t.defaultBranch), h('span', { className: 'gm-kv-v' }, repo.defaultBranch ?? '—'),
                  h('span', { className: 'gm-kv-k' }, '★'), h('span', { className: 'gm-kv-v' }, `${formatCount(repo.stars)} · ${t.forks} ${formatCount(repo.forks)} · ${t.openIssues} ${formatCount(repo.openIssues)}`),
                  h('span', { className: 'gm-kv-k' }, t.size), h('span', { className: 'gm-kv-v' }, formatSize(repo.sizeKb)),
                  h('span', { className: 'gm-kv-k' }, t.pushedAt), h('span', { className: 'gm-kv-v' }, formatDate(repo.pushedAt) || '—'),
                  repo.homepage ? h('span', { className: 'gm-kv-k' }, t.homepage) : null,
                  repo.homepage ? h('a', { className: 'gm-link', href: repo.homepage, target: '_blank', rel: 'noreferrer noopener' }, repo.homepage) : null,
                ),
                repo.topics.length > 0
                  ? h('div', { className: 'gm-langs' }, repo.topics.map((topic) => h('span', { className: 'gm-lang', key: topic }, topic)))
                  : null,
              ),
              languages.length > 0
                ? h('div', { className: 'gm-card' },
                    h('div', { className: 'gm-card-title' }, t.detailLanguages),
                    h('div', { className: 'gm-bar' }, languages.map((entry, index) => h('div', {
                      key: entry.name,
                      className: 'gm-bar-seg',
                      style: { width: `${Math.max(1, entry.share * 100)}%`, background: ['#4f8cff', '#e0b45a', '#5fc08a', '#c79ae8', '#e05c5c', '#6fa4ff', '#8ad0c0', '#d0a0a0', '#9ab0d0', '#b0b0b0'][index % 10] },
                    }))),
                    languages.map((entry, index) => h('div', { className: 'gm-bar-row', key: `${entry.name}-row` },
                      h('span', { className: 'gm-bar-name' }, entry.name),
                      h('div', { className: 'gm-bar-track' }, h('div', { className: 'gm-bar-fill', style: { width: `${Math.max(1, entry.share * 100)}%`, background: ['#4f8cff', '#e0b45a', '#5fc08a', '#c79ae8', '#e05c5c', '#6fa4ff', '#8ad0c0', '#d0a0a0', '#9ab0d0', '#b0b0b0'][index % 10] } })),
                      h('span', { className: 'gm-bar-pct' }, `${(entry.share * 100).toFixed(1)}%`),
                    )),
                  )
                : null,
              h('div', { className: 'gm-card' },
                h('div', { className: 'gm-card-title' }, t.detailCommits),
                commits.length === 0
                  ? h('div', { className: 'gm-hint' }, t.detailNoCommits)
                  : commits.map((commit) => h('div', { className: 'gm-commit', key: commit.sha },
                      h('span', { className: 'gm-sha' }, commit.shortSha),
                      h('span', { className: 'gm-commit-msg' }, commit.message),
                      h('span', { className: 'gm-commit-meta' }, `${commit.author} · ${relativeDate(commit.date)}`),
                      commit.htmlUrl ? h('a', { className: 'gm-link', href: commit.htmlUrl, target: '_blank', rel: 'noreferrer noopener' }, '↗') : null,
                    )),
              ),
              h('div', { className: 'gm-card' },
                h('div', { className: 'gm-card-title' }, t.detailBranches),
                branches.length === 0
                  ? h('div', { className: 'gm-hint' }, t.detailNoBranches)
                  : h('div', { className: 'gm-langs' }, branches.map((branch) => h('span', { className: 'gm-lang', key: branch.name }, branch.name))),
              ),
            )
          : null,
      );
    }

    // ── repository list ────────────────────────────────────────────────────
    function PanelPage() {
      const [accountList, setAccountList] = React.useState(null);
      const [accountId, setAccountId] = React.useState('');
      const [state, setState] = React.useState({ loading: true, data: null, error: '' });
      const [filter, setFilter] = React.useState('');
      const [sort, setSort] = React.useState('updated');
      const [scope, setScope] = React.useState('all');
      const [includeArchived, setIncludeArchived] = React.useState(false);
      const [open, setOpen] = React.useState(null);

      const loadAccounts = React.useCallback(() => {
        fetchView(API.status)
          .then((status) => {
            const accounts = Array.isArray(status?.accounts) ? status.accounts : [];
            setAccountList(accounts);
            setAccountId((current) => (current !== '' && accounts.some((a) => a.id === current) ? current : (status?.activeAccountId ?? accounts[0]?.id ?? '')));
          })
          .catch((caught) => {
            setAccountList([]);
            setState({ loading: false, data: null, error: String(caught?.message ?? caught) });
          });
      }, []);

      React.useEffect(() => { loadAccounts(); }, [loadAccounts]);

      const loadOverview = React.useCallback(() => {
        if (accountId === '') return;
        setState({ loading: true, data: null, error: '' });
        fetchView(withParams(API.overview, { accountId }))
          .then((data) => setState({ loading: false, data, error: '' }))
          .catch((caught) => setState({ loading: false, data: null, error: String(caught?.message ?? caught) }));
      }, [accountId]);

      React.useEffect(() => {
        setOpen(null);
        loadOverview();
      }, [loadOverview]);

      const accounts = Array.isArray(accountList) ? accountList : [];
      const connected = accounts.length > 0;
      const data = state.data;
      const account = data && data.account ? data.account : null;
      const stats = data && data.stats ? data.stats : null;
      const allRepos = data && Array.isArray(data.repos) ? data.repos : [];

      const visible = React.useMemo(() => {
        const needle = filter.trim().toLowerCase();
        let list = allRepos.filter((repo) => {
          if (!includeArchived && repo.archived) return false;
          if (scope === 'public' && repo.private) return false;
          if (scope === 'private' && !repo.private) return false;
          if (needle === '') return true;
          return (
            String(repo.name).toLowerCase().includes(needle) ||
            String(repo.fullName).toLowerCase().includes(needle) ||
            String(repo.description ?? '').toLowerCase().includes(needle) ||
            String(repo.language ?? '').toLowerCase().includes(needle) ||
            repo.topics.some((topic) => topic.toLowerCase().includes(needle))
          );
        });
        list = list.slice().sort((left, right) => {
          if (sort === 'name') return String(left.name).localeCompare(String(right.name));
          if (sort === 'stars') return right.stars - left.stars;
          return String(right.pushedAt ?? '').localeCompare(String(left.pushedAt ?? ''));
        });
        return list;
      }, [allRepos, filter, sort, scope, includeArchived]);

      if (open !== null) {
        return h(RepoDetail, {
          owner: open.owner,
          name: open.name,
          accountId,
          onBack: () => setOpen(null),
        });
      }

      return h('div', { className: 'gm-view', 'data-dsh-plugin': PANEL_ID },
        h('style', null, CSS),
        h('div', { className: 'gm-head' },
          h('div', { className: 'gm-title-row' },
            h('div', { className: 'gm-title' }, t.title),
            h('span', { className: 'gm-badge-readonly' }, t.readOnlyBadge),
          ),
          h('div', { className: 'gm-sub' }, t.subtitle),
        ),
        state.error !== '' ? h('div', { className: 'gm-msg gm-msg-err' }, `${t.error}: ${state.error}`) : null,

        // account switcher — only appears with more than one account
        accounts.length > 1
          ? h('div', { className: 'gm-row' },
              h('span', { className: 'gm-hint' }, t.account),
              h('select', {
                className: 'gm-select',
                value: accountId,
                onChange: (event) => setAccountId(event.target.value),
              }, accounts.map((item) => h('option', { key: item.id, value: item.id }, item.login || item.id))),
            )
          : null,

        !connected && state.loading === false
          ? h('div', { className: 'gm-card' },
              h('div', { className: 'gm-card-title' }, t.noAccount),
              h('div', { className: 'gm-hint' }, t.noAccountHint),
            )
          : null,

        state.loading ? h('div', { className: 'gm-hint' }, t.loading) : null,

        account
          ? h('div', { className: 'gm-card' },
              h('div', { className: 'gm-profile' },
                account.avatarUrl
                  ? h('img', { className: 'gm-avatar', src: account.avatarUrl, alt: '', loading: 'lazy' })
                  : h('span', { className: 'gm-avatar-fb' }, h(RepoGlyph, null)),
                h('div', { className: 'gm-profile-main' },
                  h('div', { className: 'gm-login' }, account.name ? `${account.name} (${account.login})` : account.login),
                  h('div', { className: 'gm-meta' }, [account.bio, account.company, account.location].filter(Boolean).join(' · ') || `@${account.login}`),
                ),
                h('a', { className: 'gm-link', href: account.htmlUrl, target: '_blank', rel: 'noreferrer noopener' }, t.openOnGithub),
                h('button', { type: 'button', className: 'gm-btn', disabled: state.loading, onClick: loadOverview }, t.reload),
              ),
              stats
                ? h('div', { className: 'gm-stats' },
                    h('div', { className: 'gm-stat' }, h('span', { className: 'gm-stat-num' }, String(account.publicRepos)), h('span', { className: 'gm-stat-label' }, t.statsRepos)),
                    h('div', { className: 'gm-stat' }, h('span', { className: 'gm-stat-num' }, formatCount(stats.stars)), h('span', { className: 'gm-stat-label' }, t.statsStars)),
                    h('div', { className: 'gm-stat' }, h('span', { className: 'gm-stat-num' }, String(stats.privateCount)), h('span', { className: 'gm-stat-label' }, t.statsPrivate)),
                    h('div', { className: 'gm-stat' }, h('span', { className: 'gm-stat-num' }, formatCount(account.followers)), h('span', { className: 'gm-stat-label' }, t.statsFollowers)),
                  )
                : null,
              stats && stats.languages.length > 0
                ? h('div', null,
                    h('div', { className: 'gm-hint', style: { marginBottom: '5px' } }, t.languages),
                    h('div', { className: 'gm-langs' }, stats.languages.map((entry) => h('span', { className: 'gm-lang', key: entry.name }, `${entry.name} ${entry.count}`))),
                  )
                : null,
              Array.isArray(account.scopes) && account.scopes.length > 0
                ? h('div', { className: 'gm-hint' }, `scopes: ${account.scopes.join(', ')}`)
                : null,
            )
          : null,

        connected
          ? h('div', { className: 'gm-card' },
              h('div', { className: 'gm-row' },
                h('div', { className: 'gm-card-title', style: { flex: '1 1 auto' } }, `${t.repositories}${allRepos.length > 0 ? ` (${visible.length}/${allRepos.length})` : ''}`),
                h('select', { className: 'gm-select', value: sort, onChange: (event) => setSort(event.target.value) },
                  h('option', { value: 'updated' }, t.sortUpdated),
                  h('option', { value: 'name' }, t.sortName),
                  h('option', { value: 'stars' }, t.sortStars),
                ),
              ),
              h('div', { className: 'gm-row' },
                h('input', {
                  className: 'gm-input', type: 'search', placeholder: t.filter, value: filter,
                  onChange: (event) => setFilter(event.target.value),
                }),
              ),
              h('div', { className: 'gm-chips' },
                h('button', { type: 'button', className: `gm-chip${scope === 'all' ? ' gm-chip-on' : ''}`, onClick: () => setScope('all') }, t.showAll),
                h('button', { type: 'button', className: `gm-chip${scope === 'public' ? ' gm-chip-on' : ''}`, onClick: () => setScope('public') }, t.showPublic),
                h('button', { type: 'button', className: `gm-chip${scope === 'private' ? ' gm-chip-on' : ''}`, onClick: () => setScope('private') }, t.showPrivate),
                h('button', { type: 'button', className: `gm-chip${includeArchived ? ' gm-chip-on' : ''}`, onClick: () => setIncludeArchived((value) => !value) }, t.showArchived),
              ),
              stats && stats.truncated ? h('div', { className: 'gm-hint' }, t.truncated) : null,

              allRepos.length === 0
                ? h('div', { className: 'gm-hint' }, t.emptyRepos)
                : visible.length === 0
                  ? h('div', { className: 'gm-hint' }, t.empty)
                  : visible.map((repo) => h('div', { className: 'gm-repo', key: repo.id ?? repo.fullName },
                      h(RepoGlyph, null),
                      h('div', { className: 'gm-repo-main' },
                        h('div', {
                          className: 'gm-repo-name',
                          role: 'button',
                          tabIndex: 0,
                          onClick: () => setOpen({ owner: repo.owner, name: repo.name }),
                          onKeyDown: (event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              setOpen({ owner: repo.owner, name: repo.name });
                            }
                          },
                        }, repo.name),
                        repo.description ? h('div', { className: 'gm-repo-desc' }, repo.description) : null,
                        h('div', { className: 'gm-repo-facts' },
                          repo.private ? h('span', { className: 'gm-tag gm-tag-private' }, t.visibilityPrivate) : h('span', { className: 'gm-tag' }, t.visibilityPublic),
                          repo.archived ? h('span', { className: 'gm-tag gm-tag-archived' }, t.archived) : null,
                          repo.language ? h('span', null, repo.language) : null,
                          h('span', null, `★ ${formatCount(repo.stars)}`),
                          repo.openIssues > 0 ? h('span', null, `${t.openIssues} ${formatCount(repo.openIssues)}`) : null,
                          h('span', null, `${t.updatedAt} ${relativeDate(repo.pushedAt) || '—'}`),
                        ),
                      ),
                      h('a', { className: 'gm-link', href: repo.htmlUrl, target: '_blank', rel: 'noreferrer noopener' }, t.openOnGithub),
                    )),
            )
          : null,

        h('div', { className: 'gm-hint' }, t.subtitle),
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const disposers = [];
        disposers.push(ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: PANEL_ORDER,
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
