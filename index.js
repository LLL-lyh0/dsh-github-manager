/**
 * dsh-github-manager — Host half.
 *
 * Gives this dsh profile a per-account GitHub access path:
 *  - stores personal access tokens locally (never returned to the browser),
 *  - exposes a same-origin HTTP surface the management panel drives,
 *  - exposes agent tools so the AI can operate the user's GitHub.
 *
 * Every operation is implemented once (as a function) and called by both the
 * HTTP surface and the tools, so the UI and the agent cannot drift apart.
 */

import { mkdir, readFile, rm, stat, writeFile, rename } from 'node:fs/promises';
import { cpSync, existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const inject = ['webServer', 'tools'];

const NS = 'dsh-github-manager';
const ROUTE_BASE = '/api/dsh-github-manager';
const API_BASE = 'https://api.github.com';
const API_VERSION = '2022-11-28';
const UA = 'dsh-github-manager/1.2.1';

// ── local store ─────────────────────────────────────────────────────────────

function dshHome() {
  const fromEnv = process.env.DSH_HOME;
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv;
  return join(homedir(), '.dsh');
}

function storeDir() {
  return join(dshHome(), 'storages', NS);
}

function storeFile() {
  return join(storeDir(), 'accounts.json');
}

/** @type {{ accounts: Array<object>, deviceClientId?: string } | null} */
let cache = null;
/**
 * mtime of the file the cache was built from. A negative result is never
 * cached: the file can appear later (first sign-in, or a store seeded by
 * another process), and a stale empty cache would make the panel claim no
 * account is connected forever.
 * @type {number | null}
 */
let cacheStamp = null;

function emptyStore() {
  return { version: 1, accounts: [], activeAccountId: null, deviceClientId: '' };
}

async function loadStore() {
  let stamp = null;
  try {
    stamp = (await stat(storeFile())).mtimeMs;
  } catch {
    stamp = null;
  }
  if (cache !== null && stamp !== null && stamp === cacheStamp) return cache;
  if (stamp === null) return emptyStore();
  try {
    const raw = await readFile(storeFile(), 'utf8');
    const parsed = JSON.parse(raw);
    cache = {
      ...emptyStore(),
      ...parsed,
      accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
    };
    cacheStamp = stamp;
  } catch {
    return emptyStore();
  }
  return cache;
}

async function saveStore(store) {
  await mkdir(storeDir(), { recursive: true });
  const target = storeFile();
  const tmp = `${target}.tmp`;
  // Tokens live in the user's own dsh home; keep the file owner-only where the
  // platform honours it (Windows maps this to a best-effort ACL).
  await writeFile(tmp, JSON.stringify(store, null, 2), { encoding: 'utf8', mode: 0o600 });
  await rename(tmp, target);
  cache = store;
  try {
    cacheStamp = (await stat(target)).mtimeMs;
  } catch {
    cacheStamp = null;
  }
  return store;
}

function publicAccount(account) {
  return {
    id: account.id,
    login: account.login,
    name: account.name ?? null,
    avatarUrl: account.avatarUrl ?? null,
    email: account.email ?? null,
    scopes: account.scopes ?? [],
    tokenKind: account.tokenKind ?? 'pat',
    isDefault: account.isDefault === true,
    addedAt: account.addedAt ?? null,
    verifiedAt: account.verifiedAt ?? null,
    lastError: account.lastError ?? null,
    tokenPreview: typeof account.token === 'string' ? account.token.slice(0, 4) + '…' + account.token.slice(-4) : null,
  };
}

function pickAccount(store, accountId) {
  if (typeof accountId === 'string' && accountId !== '') {
    return store.accounts.find((a) => a.id === accountId) ?? null;
  }
  if (store.activeAccountId) {
    const active = store.accounts.find((a) => a.id === store.activeAccountId);
    if (active) return active;
  }
  return store.accounts.find((a) => a.isDefault) ?? store.accounts[0] ?? null;
}

// ── GitHub client ───────────────────────────────────────────────────────────

function ghHeaders(token, extra) {
  return {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'user-agent': UA,
    'x-github-api-version': API_VERSION,
    ...(extra ?? {}),
  };
}

/**
 * Transport-level failures worth retrying: a connection error, or a gateway
 * hiccup. In this environment an intercepting proxy in front of api.github.com
 * intermittently answers 502 with an empty body — retrying an idempotent GET is
 * correct there, while a 401/403/404/422 must never be retried.
 */
const RETRYABLE_STATUS = new Set([502, 503, 504]);
const RETRY_DELAYS = [150, 450];

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function ghFetchOnce(url, init, headers) {
  const response = await fetch(url, { ...init, headers });
  const text = await response.text();
  let body;
  try {
    body = text === '' ? null : JSON.parse(text);
  } catch {
    body = text === '' ? null : text;
  }
  const remaining = response.headers.get('x-ratelimit-remaining');
  const reset = response.headers.get('x-ratelimit-reset');
  const rate = remaining === null ? null : { remaining: Number(remaining), resetAt: reset ? new Date(Number(reset) * 1000).toISOString() : null };
  if (!response.ok) {
    const message = body && typeof body === 'object' && typeof body.message === 'string' ? body.message : `HTTP ${response.status}`;
    return {
      ok: false,
      status: response.status,
      code: response.status === 401 ? 'error.github.unauthorized' : response.status === 403 ? 'error.github.forbidden' : 'error.github.request',
      error: message,
      rate,
      body,
    };
  }
  return { ok: true, status: response.status, body, rate };
}

async function ghFetch(token, path, init) {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  const method = (init?.method ?? 'GET').toUpperCase();
  const idempotent = method === 'GET' || method === 'HEAD';
  const attempts = idempotent ? RETRY_DELAYS.length + 1 : 1;
  const headers = ghHeaders(token, init?.headers);

  let last;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      last = await ghFetchOnce(url, init, headers);
    } catch (error) {
      if (attempt + 1 >= attempts) {
        return { ok: false, status: 0, code: 'error.github.unreachable', error: `无法连接 GitHub：${error?.message ?? String(error)}` };
      }
      await sleep(RETRY_DELAYS[attempt]);
      continue;
    }
    if (last.ok || !RETRYABLE_STATUS.has(last.status) || attempt + 1 >= attempts) return last;
    await sleep(RETRY_DELAYS[attempt]);
  }
  return last;
}

/** Resolve the token's identity + scopes; used at login and on refresh. */
async function fetchIdentity(token) {
  const user = await ghFetch(token, '/user');
  if (!user.ok) return { ok: false, code: user.code, error: user.error };
  let scopes = [];
  for (let attempt = 0; attempt < RETRY_DELAYS.length + 1; attempt += 1) {
    try {
      const probe = await fetch(`${API_BASE}/user`, { headers: ghHeaders(token) });
      if (probe.ok) {
        const header = probe.headers.get('x-oauth-scopes');
        if (typeof header === 'string') scopes = header.split(',').map((s) => s.trim()).filter(Boolean);
        break;
      }
    } catch {
      /* scopes are advisory */
    }
    await sleep(RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)]);
  }
  const b = user.body ?? {};
  return {
    ok: true,
    identity: {
      login: typeof b.login === 'string' ? b.login : '',
      name: typeof b.name === 'string' ? b.name : null,
      avatarUrl: typeof b.avatar_url === 'string' ? b.avatar_url : null,
      email: typeof b.email === 'string' ? b.email : null,
      id: b.id ?? null,
      scopes,
    },
  };
}

// ── operations (one implementation, two callers) ────────────────────────────

async function opStatus() {
  const store = await loadStore();
  const active = pickAccount(store, null);
  return {
    ok: true,
    activeAccountId: active ? active.id : null,
    deviceClientId: store.deviceClientId ?? '',
    accounts: store.accounts.map(publicAccount),
  };
}

async function opLoginToken({ token, label }) {
  const trimmed = typeof token === 'string' ? token.trim() : '';
  if (trimmed === '') return { ok: false, code: 'error.input.token', error: '请填写 GitHub Personal Access Token。' };
  const identity = await fetchIdentity(trimmed);
  if (!identity.ok) return { ok: false, code: identity.code, error: identity.error };
  return upsertAccount(trimmed, identity.identity, { kind: 'pat', label });
}

async function upsertAccount(token, identity, { kind, label }) {
  const store = await loadStore();
  const now = new Date().toISOString();
  const existing = store.accounts.find((a) => identity.login !== '' && a.login === identity.login);
  const record = {
    id: existing?.id ?? `${identity.login || 'account'}-${Math.random().toString(36).slice(2, 10)}`,
    login: identity.login,
    name: identity.name,
    avatarUrl: identity.avatarUrl,
    email: identity.email,
    scopes: identity.scopes ?? [],
    tokenKind: kind,
    label: typeof label === 'string' && label !== '' ? label : identity.login,
    token,
    addedAt: existing?.addedAt ?? now,
    verifiedAt: now,
    lastError: null,
    isDefault: existing?.isDefault ?? store.accounts.length === 0,
  };
  const accounts = existing
    ? store.accounts.map((a) => (a.id === existing.id ? record : a))
    : [...store.accounts, record];
  const next = {
    ...store,
    accounts,
    activeAccountId: store.activeAccountId ?? record.id,
  };
  await saveStore(next);
  return { ok: true, account: publicAccount(record), accounts: next.accounts.map(publicAccount), activeAccountId: next.activeAccountId };
}

async function opRemoveAccount({ id }) {
  const store = await loadStore();
  const accounts = store.accounts.filter((a) => a.id !== id);
  if (accounts.length === store.accounts.length) return { ok: false, code: 'error.account.notFound', error: '账户不存在。' };
  const activeAccountId = store.activeAccountId === id ? accounts[0]?.id ?? null : store.activeAccountId;
  await saveStore({ ...store, accounts, activeAccountId });
  return { ok: true, accounts: accounts.map(publicAccount), activeAccountId };
}

async function opSetDefault({ id }) {
  const store = await loadStore();
  if (!store.accounts.some((a) => a.id === id)) return { ok: false, code: 'error.account.notFound', error: '账户不存在。' };
  const accounts = store.accounts.map((a) => ({ ...a, isDefault: a.id === id }));
  await saveStore({ ...store, accounts, activeAccountId: id });
  return { ok: true, accounts: accounts.map(publicAccount), activeAccountId: id };
}

async function opRefresh({ id }) {
  const store = await loadStore();
  const account = pickAccount(store, id);
  if (!account) return { ok: false, code: 'error.account.none', error: '还没有登录 GitHub 账户。' };
  const identity = await fetchIdentity(account.token);
  if (!identity.ok) {
    const accounts = store.accounts.map((a) => (a.id === account.id ? { ...a, lastError: identity.error } : a));
    await saveStore({ ...store, accounts });
    return { ok: false, code: identity.code, error: identity.error, accounts: accounts.map(publicAccount) };
  }
  const accounts = store.accounts.map((a) => (
    a.id === account.id
      ? { ...a, ...identity.identity, verifiedAt: new Date().toISOString(), lastError: null }
      : a
  ));
  await saveStore({ ...store, accounts });
  const updated = accounts.find((a) => a.id === account.id);
  return { ok: true, account: publicAccount(updated), accounts: accounts.map(publicAccount) };
}

/** Generic authenticated GitHub API call, used by the tool and the panel. */
async function opApi({ accountId, method, path, query, body }) {
  const store = await loadStore();
  const account = pickAccount(store, accountId);
  if (!account) return { ok: false, code: 'error.account.none', error: '还没有登录 GitHub 账户，请先在管理面板里添加。' };
  const verb = typeof method === 'string' && method !== '' ? method.toUpperCase() : 'GET';
  if (typeof path !== 'string' || path.trim() === '') return { ok: false, code: 'error.input.path', error: '缺少 GitHub API 路径。' };
  let target = path.startsWith('http') ? path : path.startsWith('/') ? `${API_BASE}${path}` : `${API_BASE}/${path}`;
  const params = new URLSearchParams();
  if (query && typeof query === 'object') {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === '') continue;
      params.set(k, String(v));
    }
  }
  let qs = params.toString();
  if (qs === '') {
    const qIndex = target.indexOf('?');
    if (qIndex !== -1) {
      try {
        const parsed = new URL(target);
        parsed.searchParams.forEach((v, k) => params.set(k, v));
        qs = params.toString();
        target = `${parsed.origin}${parsed.pathname}`;
      } catch {
        /* leave as-is */
      }
    }
  }
  const url = qs === '' ? target : `${target}${target.includes('?') ? '&' : '?'}${qs}`;
  const init = { method: verb };
  if (body !== undefined && body !== null && verb !== 'GET' && verb !== 'HEAD') {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
    init.headers = { 'content-type': 'application/json' };
  }
  const result = await ghFetch(account.token, url, init);
  if (!result.ok) {
    if (result.status === 401) {
      const accounts = store.accounts.map((a) => (a.id === account.id ? { ...a, lastError: 'token 已失效或无权限' } : a));
      await saveStore({ ...store, accounts });
    }
    return { ok: false, code: result.code, status: result.status, error: result.error, rate: result.rate, account: account.login };
  }
  return { ok: true, status: result.status, body: result.body, rate: result.rate, account: account.login };
}

// ── read-only views (the panel's only job) ──────────────────────────────────
//
// The panel renders these; it never performs GitHub writes. Keeping the shaping
// here means the browser receives a small, stable view model instead of raw API
// payloads, and cannot be coaxed into an arbitrary API call.

/** A repository as the viewer needs it — no permission or token material. */
function publicRepo(repo) {
  const owner = repo?.owner ?? {};
  return {
    id: repo?.id ?? null,
    owner: typeof owner.login === 'string' ? owner.login : '',
    name: typeof repo?.name === 'string' ? repo.name : '',
    fullName: typeof repo?.full_name === 'string' ? repo.full_name : '',
    description: typeof repo?.description === 'string' ? repo.description : null,
    htmlUrl: typeof repo?.html_url === 'string' ? repo.html_url : '',
    private: repo?.private === true,
    fork: repo?.fork === true,
    archived: repo?.archived === true,
    visibility: typeof repo?.visibility === 'string' ? repo.visibility : null,
    defaultBranch: typeof repo?.default_branch === 'string' ? repo.default_branch : null,
    language: typeof repo?.language === 'string' ? repo.language : null,
    topics: Array.isArray(repo?.topics) ? repo.topics.filter((x) => typeof x === 'string').slice(0, 8) : [],
    stars: Number(repo?.stargazers_count) || 0,
    forks: Number(repo?.forks_count) || 0,
    openIssues: Number(repo?.open_issues_count) || 0,
    watched: Number(repo?.subscribers_count) || 0,
    sizeKb: Number(repo?.size) || 0,
    pushedAt: typeof repo?.pushed_at === 'string' ? repo.pushed_at : null,
    updatedAt: typeof repo?.updated_at === 'string' ? repo.updated_at : null,
    createdAt: typeof repo?.created_at === 'string' ? repo.created_at : null,
    homepage: typeof repo?.homepage === 'string' && repo.homepage !== '' ? repo.homepage : null,
  };
}

/**
 * Profile + repository rollup for one account.
 *
 * Two GitHub calls, both cheap. `repos` is capped at one page on purpose: the
 * panel advertises itself as a viewer, and paging through thousands of repos is
 * a job for the skill, which can page deliberately.
 */
async function opOverview({ accountId }) {
  const store = await loadStore();
  const account = pickAccount(store, accountId);
  if (!account) {
    return { ok: false, code: 'error.account.none', error: '还没有登录 GitHub 账户。在对话里说「登录 GitHub」即可添加。' };
  }
  const [profile, repos] = await Promise.all([
    ghFetch(account.token, '/user'),
    ghFetch(account.token, '/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member'),
  ]);
  if (!profile.ok) return { ok: false, code: profile.code, status: profile.status, error: profile.error, account: account.login };
  if (!repos.ok) return { ok: false, code: repos.code, status: repos.status, error: repos.error, account: account.login };

  const list = Array.isArray(repos.body) ? repos.body.map(publicRepo) : [];
  const languages = new Map();
  let stars = 0;
  let privateCount = 0;
  let archived = 0;
  for (const repo of list) {
    stars += repo.stars;
    if (repo.private) privateCount += 1;
    if (repo.archived) archived += 1;
    if (repo.language) languages.set(repo.language, (languages.get(repo.language) ?? 0) + 1);
  }
  const p = profile.body ?? {};
  return {
    ok: true,
    account: {
      id: account.id,
      login: account.login,
      name: typeof p.name === 'string' ? p.name : account.name ?? null,
      avatarUrl: typeof p.avatar_url === 'string' ? p.avatar_url : account.avatarUrl ?? null,
      bio: typeof p.bio === 'string' ? p.bio : null,
      company: typeof p.company === 'string' ? p.company : null,
      location: typeof p.location === 'string' ? p.location : null,
      blog: typeof p.blog === 'string' && p.blog !== '' ? p.blog : null,
      htmlUrl: typeof p.html_url === 'string' ? p.html_url : `https://github.com/${account.login}`,
      publicRepos: Number(p.public_repos) || 0,
      publicGists: Number(p.public_gists) || 0,
      followers: Number(p.followers) || 0,
      following: Number(p.following) || 0,
      scopes: Array.isArray(account.scopes) ? account.scopes : [],
    },
    stats: {
      loaded: list.length,
      // A full page means GitHub has more; the count is a floor, not a total.
      truncated: list.length >= 100,
      privateCount,
      archived,
      stars,
      languages: [...languages.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => ({ name, count })),
    },
    repos: list,
    rate: repos.rate,
  };
}

/** One repository plus the detail the viewer expands into. */
async function opRepoDetail({ accountId, owner, repo }) {
  if (typeof owner !== 'string' || owner === '' || typeof repo !== 'string' || repo === '') {
    return { ok: false, code: 'error.input.repo', error: '缺少仓库的 owner/name。' };
  }
  const store = await loadStore();
  const account = pickAccount(store, accountId);
  if (!account) return { ok: false, code: 'error.account.none', error: '还没有登录 GitHub 账户。' };
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const [detail, languages, commits, branches] = await Promise.all([
    ghFetch(account.token, base),
    ghFetch(account.token, `${base}/languages`),
    ghFetch(account.token, `${base}/commits?per_page=8`),
    ghFetch(account.token, `${base}/branches?per_page=20`),
  ]);
  if (!detail.ok) return { ok: false, code: detail.code, status: detail.status, error: detail.error };
  const languageBytes = languages.ok && languages.body && typeof languages.body === 'object' ? languages.body : {};
  const totalBytes = Object.values(languageBytes).reduce((sum, value) => sum + (Number(value) || 0), 0);
  return {
    ok: true,
    repo: publicRepo(detail.body),
    languages: Object.entries(languageBytes)
      .map(([name, bytes]) => ({ name, bytes: Number(bytes) || 0, share: totalBytes === 0 ? 0 : (Number(bytes) || 0) / totalBytes }))
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 10),
    branches: branches.ok && Array.isArray(branches.body)
      ? branches.body.map((b) => ({ name: b?.name ?? '', sha: b?.commit?.sha ?? '' })).slice(0, 20)
      : [],
    commits: commits.ok && Array.isArray(commits.body)
      ? commits.body.map((c) => ({
          sha: typeof c?.sha === 'string' ? c.sha : '',
          shortSha: typeof c?.sha === 'string' ? c.sha.slice(0, 7) : '',
          message: typeof c?.commit?.message === 'string' ? c.commit.message.split('\n')[0].slice(0, 120) : '',
          author: typeof c?.commit?.author?.name === 'string' ? c.commit.author.name : '',
          date: typeof c?.commit?.author?.date === 'string' ? c.commit.author.date : null,
          htmlUrl: typeof c?.html_url === 'string' ? c.html_url : '',
        }))
      : [],
  };
}

// ── device flow (skill-side only) ───────────────────────────────────────────
async function opDeviceStart({ clientId }) {
  const id = typeof clientId === 'string' ? clientId.trim() : '';
  if (id === '') return { ok: false, code: 'error.input.clientId', error: '设备登录需要一个 GitHub OAuth App 的 Client ID。' };
  let response;
  try {
    response = await fetch('https://github.com/login/device/code', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': UA },
      body: JSON.stringify({ client_id: id, scope: 'repo read:org gist workflow' }),
    });
  } catch (error) {
    return { ok: false, code: 'error.github.unreachable', error: `无法连接 GitHub：${error?.message ?? String(error)}` };
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data || typeof data.device_code !== 'string') {
    return { ok: false, code: 'error.device.start', error: data?.error_description ?? `HTTP ${response.status}` };
  }
  const store = await loadStore();
  await saveStore({ ...store, deviceClientId: id });
  return {
    ok: true,
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    expiresIn: data.expires_in,
    interval: data.interval ?? 5,
    clientId: id,
  };
}

async function opDevicePoll({ clientId, deviceCode }) {
  const id = typeof clientId === 'string' && clientId.trim() !== '' ? clientId.trim() : (await loadStore()).deviceClientId;
  if (!id || typeof deviceCode !== 'string' || deviceCode === '') {
    return { ok: false, code: 'error.input.device', error: '缺少设备登录参数。' };
  }
  let response;
  try {
    response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': UA },
      body: JSON.stringify({ client_id: id, device_code: deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
    });
  } catch (error) {
    return { ok: false, code: 'error.github.unreachable', error: `无法连接 GitHub：${error?.message ?? String(error)}` };
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) return { ok: false, code: 'error.device.poll', error: `HTTP ${response.status}` };
  if (typeof data.error === 'string') {
    if (data.error === 'authorization_pending') return { ok: true, pending: true };
    if (data.error === 'slow_down') return { ok: true, pending: true, slowDown: true };
    return { ok: false, code: `error.device.${data.error}`, error: data.error_description ?? data.error };
  }
  if (typeof data.access_token !== 'string' || data.access_token === '') {
    return { ok: false, code: 'error.device.token', error: 'GitHub 未返回访问令牌。' };
  }
  const identity = await fetchIdentity(data.access_token);
  if (!identity.ok) return { ok: false, code: identity.code, error: identity.error };
  const result = await upsertAccount(data.access_token, identity.identity, { kind: 'device', label: identity.identity.login });
  return { ...result, pending: false };
}

// ── HTTP surface ────────────────────────────────────────────────────────────

function sendJson(res, code, payload) {
  if (!res || res.writableEnded || res.destroyed) return;
  try {
    const body = JSON.stringify(payload);
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
    res.end(body);
  } catch {
    /* client gone */
  }
}

function isLoopbackAuthority(host) {
  if (typeof host !== 'string' || host === '') return false;
  let parsed;
  try {
    parsed = new URL(`http://${host}`);
  } catch {
    return false;
  }
  const name = parsed.hostname;
  if (name === 'localhost' || name === '[::1]' || name === '::1') return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(name);
}

/** Reject cross-site callers: Host must be loopback, Origin must match it. */
function checkOrigin(req) {
  const host = req.headers.host;
  if (!isLoopbackAuthority(host)) return { code: 'error.proto.forbiddenHost', error: 'forbidden host' };
  if (req.headers['sec-fetch-site'] === 'cross-site') return { code: 'error.proto.forbiddenHost', error: 'forbidden host' };
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin !== '') {
    let originHost;
    try {
      originHost = new URL(origin).host;
    } catch {
      return { code: 'error.proto.forbiddenHost', error: 'forbidden host' };
    }
    if (originHost !== host) return { code: 'error.proto.forbiddenHost', error: 'forbidden host' };
  }
  return null;
}

function routeHandler(ctx) {
  return async (req, res) => {
    const denied = checkOrigin(req);
    if (denied) {
      sendJson(res, 403, { ok: false, ...denied });
      return;
    }
    let url;
    let path = '/';
    try {
      url = new URL(req.url, 'http://localhost');
      path = url.pathname.replace(/\/+$/, '') || '/';
      if (path.startsWith(ROUTE_BASE)) path = path.slice(ROUTE_BASE.length) || '/';
    } catch {
      sendJson(res, 400, { ok: false, code: 'error.proto.url', error: 'bad url' });
      return;
    }

    // Read-only surface. Every mutation lives on the `github_accounts` /
    // `github_api` tools, so the browser literally has no write path: a request
    // that is not a GET is refused before anything else runs.
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { ok: false, code: 'error.proto.readOnly', error: 'this surface is read-only; use the github_* tools to change anything' });
      return;
    }

    const accountId = url.searchParams.get('accountId') ?? undefined;

    try {
      switch (path) {
        case '/status':
          sendJson(res, 200, await opStatus());
          return;
        case '/overview':
          sendJson(res, 200, await opOverview({ accountId }));
          return;
        case '/repo':
          sendJson(res, 200, await opRepoDetail({
            accountId,
            owner: url.searchParams.get('owner') ?? '',
            repo: url.searchParams.get('repo') ?? '',
          }));
          return;
        default:
          sendJson(res, 404, { ok: false, code: 'error.proto.notFound', error: `unknown route: ${path}` });
      }
    } catch (error) {
      sendJson(res, 500, { ok: false, code: 'error.internal', error: String(error?.message ?? error) });
    }
  };
}

// ── agent tools ─────────────────────────────────────────────────────────────

function textRender(args, value) {
  if (value && value.ok === false) {
    return [{ type: 'text', text: `GitHub 操作失败${typeof value.code === 'string' ? ` (${value.code})` : ''}: ${value.error ?? '未知错误'}` }];
  }
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }];
}

function registerTools(ctx) {
  ctx.effect(() => ctx.tools.register({
    name: 'github_accounts',
    description: 'Manage the GitHub accounts connected to this dsh profile. Actions: list (which accounts exist, which is default), add (Personal Access Token — only when the user already has one and accepts that it enters the transcript), device-start / device-poll (the recommended sign-in: no token ever reaches the chat), default (switch active account), refresh, remove. Use whenever the user asks which GitHub account is connected, wants to sign in, or switch accounts. Never echo a token back.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'add', 'device-start', 'device-poll', 'default', 'refresh', 'remove'], description: 'Which operation to perform.' },
        token: { type: 'string', description: 'Personal Access Token, for action=add only.' },
        clientId: { type: 'string', description: 'GitHub OAuth App Client ID, for device-start / device-poll.' },
        deviceCode: { type: 'string', description: 'The device_code returned by device-start, for device-poll.' },
        id: { type: 'string', description: 'Account id for default/refresh/remove.' },
        label: { type: 'string', description: 'Optional display label for action=add.' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object' }, render: textRender },
    async execute(args) {
      switch (args?.action) {
        case 'list':
          return opStatus();
        case 'add':
          return opLoginToken({ token: args.token, label: args.label });
        case 'device-start':
          return opDeviceStart({ clientId: args.clientId });
        case 'device-poll':
          return opDevicePoll({ clientId: args.clientId, deviceCode: args.deviceCode });
        case 'default':
          return opSetDefault({ id: args.id });
        case 'refresh':
          return opRefresh({ id: args.id });
        case 'remove':
          return opRemoveAccount({ id: args.id });
        default:
          return { ok: false, code: 'error.input.action', error: `未知操作：${args?.action}` };
      }
    },
  }), 'dsh-github-manager: github_accounts tool');

  ctx.effect(() => ctx.tools.register({
    name: 'github_api',
    description: 'Call the authenticated GitHub REST API with the connected personal account. Use for repos, issues, pull requests, releases, gists, notifications and anything else GitHub exposes: path is the API path such as /user/repos or /repos/{owner}/{repo}/issues, body is the JSON payload for POST/PATCH/PUT/DELETE. Returns the parsed response.',
    parameters: {
      type: 'object',
      properties: {
        method: { type: 'string', enum: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'], description: 'HTTP method, default GET.' },
        path: { type: 'string', description: 'GitHub API path, e.g. /user/repos, /repos/owner/repo, /repos/owner/repo/issues.' },
        query: { type: 'object', description: 'Optional query string parameters.' },
        body: { type: 'object', description: 'Optional JSON body for write methods.' },
        accountId: { type: 'string', description: 'Optional account id; defaults to the active account.' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object' }, render: textRender },
    async execute(args) {
      return opApi(args ?? {});
    },
  }), 'dsh-github-manager: github_api tool');
}

// ── GitHub management skill ─────────────────────────────────────────────────
//
// The panel is read-only on purpose: control lives in a skill the model loads
// when the conversation is about GitHub. The skill body is authored here rather
// than fetched from the internet, so the profile keeps working offline and the
// reference files cannot drift out from under the tools it documents.

const GITHUB_SKILL = 'github-manager';
const SKILL_PROVIDER = 'dsh-github-manager';
/** Same precedence as the other packaged skill providers (see @deepseek-ai/dsh-skill). */
const BUNDLED_SKILL_RANK = 600;
/**
 * Fallback description. The authoritative copy is the frontmatter of
 * `skill/SKILL.md`; this is only used if the asset is unreadable so skill
 * registration can never take the plugin down.
 */
const SKILL_DESCRIPTION = 'Operate the user\'s real GitHub account through the dsh-github-manager tools: repositories, branches, file contents, commits, releases, issues, pull requests, Actions runs, gists and notifications. Use whenever a request touches GitHub or a hosted git repository.';

const SKILL_SOURCE_DIR = fileURLToPath(new URL('./skill/', import.meta.url));

/** Split `---` frontmatter off a SKILL.md body; tolerant of plain `key: value`. */
function parseFrontmatter(raw) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(raw);
  if (match === null) return { attributes: {}, content: raw };
  const attributes = {};
  for (const line of match[1].split(/\r?\n/u)) {
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^["']|["']$/gu, '');
    if (key !== '') attributes[key] = value;
  }
  return { attributes, content: raw.slice(match[0].length).trim() };
}

function registerGithubSkill(ctx) {
  if (typeof ctx.inject !== 'function') return;
  try {
    ctx.inject(['skills'], (scope) => {
      scope.effect(function* () {
        // The plugin may live inside an ASAR archive, where an ordinary file
        // read by other tools is not possible, so the skill owns a private copy
        // of its resources for the lifetime of the registration.
        const directory = mkdtempSync(join(tmpdir(), 'dsh-github-skill-'));
        yield async () => { await rm(directory, { recursive: true, force: true }); };
        let locator = join(directory, 'SKILL.md');
        let description = SKILL_DESCRIPTION;
        try {
          cpSync(SKILL_SOURCE_DIR, directory, { recursive: true });
          const raw = readFileSync(locator, 'utf8');
          const parsed = parseFrontmatter(raw);
          if (typeof parsed.attributes.description === 'string' && parsed.attributes.description !== '') {
            description = parsed.attributes.description;
          }
        } catch (error) {
          // Keep the skill available with its fallback description rather than
          // failing activation over a packaging mistake.
          console.warn(`[${NS}] GitHub 技能资源不可用，仍以最小描述注册：`, error);
          locator = join(SKILL_SOURCE_DIR, 'SKILL.md');
        }
        const candidate = {
          name: GITHUB_SKILL,
          description,
          invocation: { modelInvocable: true, userInvocable: true },
          provider: SKILL_PROVIDER,
          source: 'bundled',
          rank: BUNDLED_SKILL_RANK,
          resourceBase: { kind: 'directory', path: directory },
          locator,
        };
        const provider = {
          name: SKILL_PROVIDER,
          list: () => Promise.resolve([candidate]),
          async get(entry, options) {
            const { rank: _rank, locator: entryPath, ...summary } = entry;
            const raw = await readFile(entryPath, { encoding: 'utf8', signal: options?.signal });
            return { ...summary, content: parseFrontmatter(raw).content };
          },
        };
        yield scope.skills.registerProvider(() => provider);
      }, `${NS}: GitHub management skill resources`);
    });
  } catch (error) {
    console.warn(`[${NS}] 技能服务不可用，GitHub 技能未注册：`, error);
  }
}

// ── plugin entry ────────────────────────────────────────────────────────────

export function apply(ctx) {
  registerTools(ctx);
  registerGithubSkill(ctx);
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_BASE,
    handler: routeHandler(ctx),
  }), 'dsh-github-manager: http surface');
}
