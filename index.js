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

import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const inject = ['webServer', 'tools'];

const NS = 'dsh-github-manager';
const ROUTE_BASE = '/api/dsh-github-manager';
const API_BASE = 'https://api.github.com';
const API_VERSION = '2022-11-28';
const UA = 'dsh-github-manager/1.0';
/** Mutating requests must carry this header (client marker, CSRF fence). */
const CLIENT_MARKER_HEADER = 'x-dsh-github-manager';
const MAX_BODY_BYTES = 1 << 20;

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

function emptyStore() {
  return { version: 1, accounts: [], activeAccountId: null, deviceClientId: '' };
}

async function loadStore() {
  if (cache) return cache;
  try {
    const raw = await readFile(storeFile(), 'utf8');
    const parsed = JSON.parse(raw);
    cache = {
      ...emptyStore(),
      ...parsed,
      accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
    };
  } catch {
    cache = emptyStore();
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

async function ghFetch(token, path, init) {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  let response;
  try {
    response = await fetch(url, { ...init, headers: ghHeaders(token, init?.headers) });
  } catch (error) {
    return { ok: false, status: 0, code: 'error.github.unreachable', error: `无法连接 GitHub：${error?.message ?? String(error)}` };
  }
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

/** Resolve the token's identity + scopes; used at login and on refresh. */
async function fetchIdentity(token) {
  const user = await ghFetch(token, '/user');
  if (!user.ok) return { ok: false, code: user.code, error: user.error };
  let scopes = [];
  try {
    const probe = await fetch(`${API_BASE}/user`, { headers: ghHeaders(token) });
    const header = probe.headers.get('x-oauth-scopes');
    if (typeof header === 'string') scopes = header.split(',').map((s) => s.trim()).filter(Boolean);
  } catch {
    /* scopes are advisory */
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

// Device flow (optional; needs an OAuth App client id).

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

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('body too large');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  if (text.trim() === '') return {};
  return JSON.parse(text);
}

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
    let path = '/';
    try {
      const url = new URL(req.url, 'http://localhost');
      path = url.pathname.replace(/\/+$/, '') || '/';
      if (path.startsWith(ROUTE_BASE)) path = path.slice(ROUTE_BASE.length) || '/';
    } catch {
      sendJson(res, 400, { ok: false, code: 'error.proto.url', error: 'bad url' });
      return;
    }

    const isMutation = req.method !== 'GET' && req.method !== 'HEAD';
    if (isMutation && req.headers[CLIENT_MARKER_HEADER] !== '1') {
      sendJson(res, 403, { ok: false, code: 'error.proto.forbidden', error: 'forbidden mutation request' });
      return;
    }

    let body = {};
    if (isMutation) {
      try {
        body = await readJsonBody(req);
      } catch (error) {
        sendJson(res, 400, { ok: false, code: 'error.input.body', error: String(error?.message ?? error) });
        return;
      }
    }

    try {
      switch (path) {
        case '/status':
          sendJson(res, 200, await opStatus());
          return;
        case '/login/token':
          sendJson(res, 200, await opLoginToken(body ?? {}));
          return;
        case '/login/device/start':
          sendJson(res, 200, await opDeviceStart(body ?? {}));
          return;
        case '/login/device/poll':
          sendJson(res, 200, await opDevicePoll(body ?? {}));
          return;
        case '/accounts/remove':
          sendJson(res, 200, await opRemoveAccount(body ?? {}));
          return;
        case '/accounts/default':
          sendJson(res, 200, await opSetDefault(body ?? {}));
          return;
        case '/accounts/refresh':
          sendJson(res, 200, await opRefresh(body ?? {}));
          return;
        case '/repos': {
          const result = await opApi({
            accountId: body?.accountId,
            method: 'GET',
            path: '/user/repos',
            query: { per_page: 100, sort: 'updated', affiliation: 'owner,collaborator,organization_member' },
          });
          sendJson(res, 200, result);
          return;
        }
        case '/api':
          sendJson(res, 200, await opApi(body ?? {}));
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
    description: 'Manage the GitHub accounts connected to this dsh session: list them, add one by Personal Access Token, set the default, refresh, or remove one. Use when the user asks which GitHub account is connected or wants to log in/switch. Never echo the token back.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'add', 'default', 'refresh', 'remove'], description: 'Which operation to perform.' },
        token: { type: 'string', description: 'Personal Access Token, for action=add. Required for add.' },
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

// ── plugin entry ────────────────────────────────────────────────────────────

export function apply(ctx) {
  registerTools(ctx);
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_BASE,
    handler: routeHandler(ctx),
  }), 'dsh-github-manager: http surface');
}
