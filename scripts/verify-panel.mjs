/**
 * Client-half verification for v1.2.0: the panel must render as a read-only
 * repository viewer, and must contain NO write affordance at all.
 *
 * Uses a stateful React stub so clicks actually change state and re-render.
 */

import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8');

let loaded;
let lastRegistered = null;
const slots = [];
/**
 * Hook state is keyed per component function: PanelPage and RepoDetail are
 * different components and must not share a useState index space, and state has
 * to survive a re-render for clicks/effects to mean anything.
 */
const hookStore = new Map();
let hookIndex = 0;
let rendering = null;
const fetched = [];

/** React's dependency comparison: same length, same values element-wise. */
function sameDeps(left, right) {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) if (left[i] !== right[i]) return false;
  return true;
}

function makeReact() {
  return {
    createElement(type, props, ...children) {
      if (typeof type === 'function') {
        const previous = rendering;
        rendering = type;
        try {
          return type({ ...(props ?? {}), children });
        } finally {
          rendering = previous;
        }
      }
      return { type, props: props ?? {}, children: children.flat() };
    },
    Fragment: 'Fragment',
    useState(initial) {
      const arr = hookStore.get(rendering) ?? [];
      hookStore.set(rendering, arr);
      const i = hookIndex++;
      if (!(i in arr)) arr[i] = typeof initial === 'function' ? initial() : initial;
      return [arr[i], (next) => { arr[i] = typeof next === 'function' ? next(arr[i]) : next; }];
    },
    /**
     * `useCallback` / `useMemo` must return a STABLE identity when the deps are
     * unchanged — that is the whole contract. Returning the raw function makes
     * every `useEffect(..., [callback])` re-run on every render, which resets the
     * loading state before any promise settles and hides all real data.
     */
    useCallback(fn, deps) {
      const arr = hookStore.get(rendering) ?? [];
      hookStore.set(rendering, arr);
      const i = hookIndex++;
      const key = `callback:${i}`;
      const last = arr[key];
      if (last !== undefined && sameDeps(last.deps, deps)) return last.fn;
      arr[key] = { fn, deps };
      return fn;
    },
    useMemo(fn, deps) {
      const arr = hookStore.get(rendering) ?? [];
      hookStore.set(rendering, arr);
      const i = hookIndex++;
      const key = `memo:${i}`;
      const last = arr[key];
      if (last !== undefined && sameDeps(last.deps, deps)) return last.value;
      const value = fn();
      arr[key] = { value, deps };
      return value;
    },
    /**
     * Dependency-aware effect. Without this the harness re-runs every fetch on
     * every render, so the loading state resets before any promise settles and
     * the tree never observes real data. React only re-runs an effect when its
     * deps change; mirror that.
     */
    useEffect(fn, deps) {
      const arr = hookStore.get(rendering) ?? [];
      hookStore.set(rendering, arr);
      const i = hookIndex++;
      const key = `effect:${i}`;
      const last = arr[key];
      const changed = last === undefined
        || deps === undefined
        || last.deps === undefined
        || deps.length !== last.deps.length
        || deps.some((value, index) => value !== last.deps[index]);
      if (!changed) return undefined;
      arr[key] = { deps };
      const saved = hookIndex;
      hookIndex = 0;
      try { return fn(); } catch { return undefined; } finally { hookIndex = saved; }
    },
    useRef(v) {
      const arr = hookStore.get(rendering) ?? [];
      hookStore.set(rendering, arr);
      const i = hookIndex++;
      if (!(i in arr)) arr[i] = { current: v };
      return arr[i];
    },
  };
}
const React = makeReact();

globalThis.window = {
  __ModuleLoader__: { load({ id, factory }) { loaded = { id, module: factory((n) => (n === 'react' ? React : {})) }; } },
  setTimeout: () => 0,
  clearTimeout: () => {},
};
globalThis.document = { documentElement: { lang: 'zh-CN' } };

const OVERVIEW = {
  ok: true,
  account: {
    id: 'acct-1', login: 'octocat', name: 'The Octocat', avatarUrl: null,
    bio: 'builds things', company: '@github', location: 'SF',
    htmlUrl: 'https://github.com/octocat',
    publicRepos: 8, publicGists: 1, followers: 1234, following: 9,
    scopes: ['repo', 'gist'],
  },
  stats: { loaded: 3, truncated: false, privateCount: 1, archived: 1, stars: 60, languages: [{ name: 'TypeScript', count: 2 }, { name: 'Rust', count: 1 }] },
  repos: [
    { id: 1, owner: 'octocat', name: 'alpha', fullName: 'octocat/alpha', description: 'first repo', htmlUrl: 'https://github.com/octocat/alpha', private: false, fork: false, archived: false, visibility: 'public', defaultBranch: 'main', language: 'TypeScript', topics: ['dsh'], stars: 30, forks: 1, openIssues: 2, watched: 2, sizeKb: 2048, pushedAt: '2025-03-03T00:00:00Z', updatedAt: '2025-03-03T00:00:00Z', createdAt: '2024-01-01T00:00:00Z', homepage: null },
    { id: 2, owner: 'octocat', name: 'beta', fullName: 'octocat/beta', description: null, htmlUrl: 'https://github.com/octocat/beta', private: false, fork: false, archived: true, visibility: 'public', defaultBranch: 'main', language: 'Rust', topics: [], stars: 20, forks: 0, openIssues: 1, watched: 0, sizeKb: 1024, pushedAt: '2025-02-02T00:00:00Z', updatedAt: '2025-02-02T00:00:00Z', createdAt: '2024-01-01T00:00:00Z', homepage: null },
    { id: 3, owner: 'octocat', name: 'gamma', fullName: 'octocat/gamma', description: 'secret', htmlUrl: 'https://github.com/octocat/gamma', private: true, fork: false, archived: false, visibility: 'private', defaultBranch: 'main', language: null, topics: [], stars: 10, forks: 0, openIssues: 0, watched: 0, sizeKb: 512, pushedAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z', createdAt: '2024-01-01T00:00:00Z', homepage: null },
  ],
};

const DETAIL = {
  ok: true,
  repo: OVERVIEW.repos[0],
  languages: [{ name: 'TypeScript', bytes: 800, share: 0.8 }, { name: 'CSS', bytes: 200, share: 0.2 }],
  branches: [{ name: 'main', sha: 'abc' }, { name: 'dev', sha: 'def' }],
  commits: [{ sha: 'abcdef1234', shortSha: 'abcdef1', message: 'fix: things', author: 'Octo', date: '2025-03-02T00:00:00Z', htmlUrl: 'https://github.com/o/r/commit/abcdef1' }],
};

const STATUS = {
  ok: true,
  accounts: [{ id: 'acct-1', login: 'octocat', name: 'The Octocat', tokenPreview: 'ghp_…abcd', scopes: ['repo', 'gist'] }],
  activeAccountId: 'acct-1',
};

globalThis.fetch = async (url, init) => {
  fetched.push(`${(init?.method ?? 'GET')} ${url}`);
  const target = String(url);
  const body = target.includes('/status') ? STATUS : target.includes('/repo?') ? DETAIL : OVERVIEW;
  return { ok: true, status: 200, json: async () => body };
};

new Function('window', 'document', 'fetch', 'React', src)(globalThis.window, globalThis.document, globalThis.fetch, React);

let failures = 0;
function check(name, condition, detail) {
  if (condition) console.log(`  PASS  ${name}`);
  else { failures += 1; console.log(`  FAIL  ${name}${detail === undefined ? '' : ` — ${detail}`}`); }
}

// ── collect helpers ────────────────────────────────────────────────────────
function walk(node, visit) {
  if (node === null || node === undefined) return;
  if (Array.isArray(node)) { for (const item of node) walk(item, visit); return; }
  if (typeof node !== 'object') return;
  visit(node);
  walk(node.children, visit);
}
function findAll(tree, predicate) { const out = []; walk(tree, (node) => { if (predicate(node)) out.push(node); }); return out; }
function textOf(node) {
  const out = [];
  const visit = (n) => {
    if (n === null || n === undefined) return;
    if (typeof n === 'string' || typeof n === 'number') { out.push(String(n)); return; }
    if (Array.isArray(n)) { for (const c of n) visit(c); return; }
    if (typeof n !== 'object') return;
    for (const key of ['placeholder', 'value', 'title', 'href']) {
      if (typeof n.props?.[key] === 'string') out.push(n.props[key]);
    }
    visit(n.children);
  };
  visit(node);
  return out.join(' ');
}
async function settle(rounds = 12) {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}
/**
 * Render the page the way React would: the component body runs with a fresh
 * hook cursor, and effects scheduled during the pass have their fetches applied
 * before the tree is read.
 */
async function renderPage(component) {
  hookIndex = 0;
  rendering = component;
  const tree = component({});
  await settle();
  hookIndex = 0;
  rendering = component;
  return component({});
}

// ── apply ──────────────────────────────────────────────────────────────────
const ctx = {
  slots: {
    inject(name, callback) { lastRegistered = null; callback(); slots.push({ name, ...(lastRegistered ?? {}) }); return () => {}; },
    register(options, component) { lastRegistered = { options, component }; return () => {}; },
  },
  effect(callback) { const result = callback(); return result; },
};
loaded.module.apply(ctx);

console.log('\n== registration ==');
const entry = slots.find((slot) => slot.name === 'sidebar.panellist');
const page = slots.find((slot) => slot.name === 'main');
check('sidebar entry registered', entry !== undefined);
check('entry order is 11', entry?.options?.order === 11, String(entry?.options?.order));
check('main page registered with matching key', page?.options?.key === entry?.options?.id);
check('no session inject (panel no longer drives the AI)', ctx.inject === undefined);

// ── first render (loading) ─────────────────────────────────────────────────
console.log('\n== list view ==');
let tree = await renderPage(page.component);
await settle();
tree = await renderPage(page.component);
let text = textOf(tree);

check('shows title', text.includes('GitHub 仓库'));
check('shows read-only badge', text.includes('只读'));
check('shows account login', text.includes('octocat'));
check('shows repo count', text.includes('仓库'));
check('lists alpha', text.includes('alpha'));
check('lists beta (archived hidden by default)', text.includes('beta') === false, 'archived repo should be filtered out');
check('lists gamma (private shown by default)', text.includes('gamma'));
check('shows language rollup', text.includes('TypeScript'));
check('renders a GitHub link', findAll(tree, (n) => n.type === 'a' && String(n.props?.href ?? '').startsWith('https://github.com')).length > 0);
check('renders a details affordance for each repo', findAll(tree, (n) => n.props?.className === 'gm-repo-name').length === 2);

// ── NO write affordances anywhere ─────────────────────────────────────────
console.log('\n== read-only guarantees ==');
const allButtons = findAll(tree, (n) => n.type === 'button');
const buttonText = allButtons.map((b) => textOf(b)).join(' | ');
check('no login button', !/登录|sign in|add account/i.test(buttonText), buttonText);
check('no remove button', !/移除|remove|delete/i.test(buttonText));
check('no token input', findAll(tree, (n) => n.type === 'input' && (n.props?.type === 'password' || /token/i.test(String(n.props?.placeholder ?? '')))).length === 0);
check('no textarea (no AI handoff box)', findAll(tree, (n) => n.type === 'textarea').length === 0);
check('no device-code UI', !text.includes('设备码'));
check('only read-only fetch used', fetched.every((f) => f.startsWith('GET ')), fetched.join(', '));
check('only the three viewer endpoints are called', fetched.every((f) => /api\/dsh-github-manager\/(status|overview|repo)/.test(f)), fetched.join(', '));

// ── filter behaviour ──────────────────────────────────────────────────────
console.log('\n== filter ==');
const search = findAll(tree, (n) => n.type === 'input' && n.props?.type === 'search')[0];
check('search input present', search !== undefined);
search.props.onChange({ target: { value: 'alph' } });
tree = await renderPage(page.component);
text = textOf(tree);
check('filter narrows to alpha', text.includes('alpha'));
check('filter hides gamma', text.includes('gamma') === false);

// clearing filter
const search2 = findAll(tree, (n) => n.type === 'input' && n.props?.type === 'search')[0];
search2.props.onChange({ target: { value: '' } });
tree = await renderPage(page.component);

// ── archived toggle ───────────────────────────────────────────────────────
console.log('\n== archived toggle ==');
const archivedChip = findAll(tree, (n) => n.type === 'button' && textOf(n).includes('已归档'))[0];
check('archived chip present', archivedChip !== undefined);
archivedChip.props.onClick();
tree = await renderPage(page.component);
text = textOf(tree);
check('archived repo appears when toggled', text.includes('beta'));

// ── private chip ──────────────────────────────────────────────────────────
console.log('\n== scope chips ==');
const privateChip = findAll(tree, (n) => n.type === 'button' && textOf(n).includes('私有'))[0];
privateChip.props.onClick();
tree = await renderPage(page.component);
text = textOf(tree);
check('private-only hides alpha', text.includes('alpha') === false);
check('private-only keeps gamma', text.includes('gamma'));

// reset to all
const allChip = findAll(tree, (n) => n.type === 'button' && textOf(n).includes('全部'))[0];
allChip.props.onClick();
tree = await renderPage(page.component);

// ── sort ──────────────────────────────────────────────────────────────────
console.log('\n== sort ==');
// The archived toggle is still on from the previous block, so all three repos
// are visible: alpha (2025-03), beta (2025-02), gamma (2025-01).
const dateOrder = findAll(tree, (n) => n.props?.className === 'gm-repo-name').map((n) => textOf(n));
check('default order is by push date', dateOrder.join(',') === 'alpha,beta,gamma', dateOrder.join(','));
const select = findAll(tree, (n) => n.type === 'select')[0];
select.props.onChange({ target: { value: 'name' } });
tree = await renderPage(page.component);
const sortedNames = findAll(tree, (n) => n.props?.className === 'gm-repo-name').map((n) => textOf(n));
check('name sort is alphabetical', sortedNames.join(',') === 'alpha,beta,gamma', sortedNames.join(','));
select.props.onChange({ target: { value: 'stars' } });
tree = await renderPage(page.component);
const byStars = findAll(tree, (n) => n.props?.className === 'gm-repo-name').map((n) => textOf(n));
check('stars sort puts alpha first', byStars[0] === 'alpha', byStars.join(','));

// ── detail view ───────────────────────────────────────────────────────────
console.log('\n== detail view ==');
const repoName = findAll(tree, (n) => n.props?.className === 'gm-repo-name')[0];
repoName.props.onClick();
tree = await renderPage(page.component);
await settle();
tree = await renderPage(page.component);
text = textOf(tree);
check('detail shows full name', text.includes('octocat/alpha'));
check('detail shows back button', text.includes('返回列表'));
check('detail shows language breakdown', text.includes('80.0%') || text.includes('80.0'), text.slice(0, 200));
check('detail shows commits', text.includes('abcdef1'));
check('detail shows commit message first line', text.includes('fix: things'));
check('detail shows branches', text.includes('dev'));
check('detail fetch used /repo', fetched.some((f) => f.includes('/repo?')));
check('detail has no write button', !/移除|删除|remove|delete/i.test(findAll(tree, (n) => n.type === 'button').map((b) => textOf(b)).join(' | ')));

const back = findAll(tree, (n) => n.type === 'button' && textOf(n).includes('返回列表'))[0];
back.props.onClick();
tree = await renderPage(page.component);
check('back returns to the list', textOf(tree).includes('仓库'));

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
