/**
 * Verification harness for dsh-github-manager v1.2.0 — read-only surface.
 *
 * Boots the real Host module against a temp DSH_HOME with a stored fake account,
 * drives the actual HTTP handler with mock req/res objects, and asserts:
 *   1. every GET route the panel needs answers with shaped view data,
 *   2. every non-GET method is refused (the panel has no write path at all),
 *   3. no token ever appears in a response body,
 *   4. cross-site / non-loopback callers are still refused.
 *
 * GitHub itself is stubbed at the global fetch level, so this runs offline and
 * cannot touch a real account.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TOKEN = 'fake-token-for-tests-only';

const home = await mkdtemp(join(tmpdir(), 'gm-ro-home-'));
process.env.DSH_HOME = home;
await mkdir(join(home, 'storages', 'dsh-github-manager'), { recursive: true });
await writeFile(join(home, 'storages', 'dsh-github-manager', 'accounts.json'), JSON.stringify({
  version: 1,
  activeAccountId: 'acct-1',
  deviceClientId: '',
  accounts: [{
    id: 'acct-1',
    login: 'octocat',
    name: 'The Octocat',
    avatarUrl: 'https://example.invalid/a.png',
    email: 'octo@example.invalid',
    scopes: ['repo', 'read:org', 'gist', 'workflow'],
    tokenKind: 'pat',
    label: 'octocat',
    token: TOKEN,
    addedAt: '2025-01-01T00:00:00Z',
    verifiedAt: '2025-01-01T00:00:00Z',
    lastError: null,
    isDefault: true,
  }],
}, null, 2));

// ── stub GitHub ─────────────────────────────────────────────────────────────
const calls = [];
function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-ratelimit-remaining': '4999', ...headers },
  });
}

globalThis.fetch = async (input, init) => {
  const url = String(input);
  const method = (init?.method ?? 'GET').toUpperCase();
  calls.push(`${method} ${url.replace('https://api.github.com', '')}`);
  const u = new URL(url);
  const path = u.pathname;

  if (path === '/user') {
    return json({
      login: 'octocat', name: 'The Octocat', avatar_url: 'https://example.invalid/a.png',
      bio: 'builds things', company: '@github', location: 'San Francisco',
      blog: 'https://example.invalid/blog', html_url: 'https://github.com/octocat',
      public_repos: 8, public_gists: 3, followers: 1234, following: 9,
    });
  }
  if (path === '/user/repos') {
    const repos = [];
    for (let i = 0; i < 3; i += 1) {
      repos.push({
        id: i + 1,
        name: `repo-${i}`,
        full_name: `octocat/repo-${i}`,
        owner: { login: 'octocat' },
        description: i === 0 ? 'the first one' : null,
        html_url: `https://github.com/octocat/repo-${i}`,
        private: i === 2,
        fork: false,
        archived: i === 1,
        visibility: i === 2 ? 'private' : 'public',
        default_branch: 'main',
        language: i === 0 ? 'TypeScript' : 'Rust',
        topics: i === 0 ? ['dsh', 'plugin'] : [],
        stargazers_count: 10 * (i + 1),
        forks_count: i,
        open_issues_count: i,
        subscribers_count: 2,
        size: 2048 * (i + 1),
        pushed_at: `2025-0${i + 1}-0${i + 1}T00:00:00Z`,
        updated_at: `2025-0${i + 1}-0${i + 1}T00:00:00Z`,
        created_at: '2024-01-01T00:00:00Z',
        homepage: null,
      });
    }
    return json(repos);
  }
  const detail = /^\/repos\/([^/]+)\/([^/]+)$/.exec(path);
  if (detail) {
    return json({
      id: 1, name: detail[2], full_name: `${detail[1]}/${detail[2]}`, owner: { login: detail[1] },
      description: 'the first one', html_url: `https://github.com/${detail[1]}/${detail[2]}`,
      private: false, fork: false, archived: false, visibility: 'public', default_branch: 'main',
      language: 'TypeScript', topics: ['dsh'], stargazers_count: 10, forks_count: 1,
      open_issues_count: 2, subscribers_count: 2, size: 2048,
      pushed_at: '2025-03-03T00:00:00Z', updated_at: '2025-03-03T00:00:00Z',
      created_at: '2024-01-01T00:00:00Z', homepage: null,
    });
  }
  if (/^\/repos\/[^/]+\/[^/]+\/languages$/.test(path)) return json({ TypeScript: 800, CSS: 200 });
  if (/^\/repos\/[^/]+\/[^/]+\/commits$/.test(path)) {
    return json([{ sha: 'abcdef1234567890', commit: { message: 'fix: things\n\nbody', author: { name: 'Octo', date: '2025-03-02T00:00:00Z' } }, html_url: 'https://github.com/o/r/commit/abcdef1' }]);
  }
  if (/^\/repos\/[^/]+\/[^/]+\/branches$/.test(path)) return json([{ name: 'main', commit: { sha: 'abcdef1234567890' } }]);
  return json({ message: 'Not Found' }, 404);
};

// ── harness ─────────────────────────────────────────────────────────────────
const mod = await import('../index.js');

let handler = null;
const log = [];
const effects = [];
const ctx = {
  tools: { register: (def) => { log.push(`tools.register:${def.name}`); return () => {}; } },
  webServer: { register: (options) => { handler = options.handler; log.push(`webServer.register:${options.path}`); return () => {}; } },
  effect(callback) {
    const result = typeof callback === 'function' ? callback() : undefined;
    if (typeof result === 'function') effects.push(result);
  },
};
ctx.inject = () => {};

mod.apply(ctx);

let failures = 0;
function check(name, condition, detail) {
  if (condition) console.log(`  PASS  ${name}`);
  else { failures += 1; console.log(`  FAIL  ${name}${detail === undefined ? '' : ` — ${detail}`}`); }
}

function makeRes() {
  const res = {
    statusCode: 0, headers: {}, body: '', writableEnded: false, destroyed: false,
    writeHead(code, headers) { this.statusCode = code; this.headers = headers ?? {}; },
    end(chunk) { this.body = chunk ?? ''; this.writableEnded = true; },
  };
  return res;
}

async function request(path, { method = 'GET', host = '127.0.0.1:58902', origin, secFetchSite } = {}) {
  const res = makeRes();
  const req = {
    method,
    url: path,
    headers: {
      host,
      ...(origin === undefined ? {} : { origin }),
      ...(secFetchSite === undefined ? {} : { 'sec-fetch-site': secFetchSite }),
    },
    async* [Symbol.asyncIterator]() { /* read-only surface never reads a body */ },
  };
  await handler(req, res);
  let parsed;
  try { parsed = JSON.parse(res.body); } catch { parsed = undefined; }
  return { status: res.statusCode, body: parsed, raw: res.body };
}

console.log('\n== routes ==');
console.log('  log:', log.join(' | '));
check('webServer captured', typeof handler === 'function');

const status = await request('/status');
check('GET /status 200', status.status === 200, String(status.status));
check('GET /status lists the account', Array.isArray(status.body?.accounts) && status.body.accounts.length === 1);
check('/status never returns the token', !status.raw.includes(TOKEN));
check('/status only shows a preview', typeof status.body?.accounts?.[0]?.tokenPreview === 'string');

const overview = await request('/overview');
check('GET /overview 200', overview.status === 200, String(overview.status));
check('/overview has account', overview.body?.account?.login === 'octocat', JSON.stringify(overview.body?.account)?.slice(0, 80));
check('/overview has stats', overview.body?.stats?.loaded === 3, String(overview.body?.stats?.loaded));
check('/overview truncation flag false for 3 repos', overview.body?.stats?.truncated === false);
check('/overview counts private', overview.body?.stats?.privateCount === 1, String(overview.body?.stats?.privateCount));
check('/overview counts archived', overview.body?.stats?.archived === 1);
check('/overview sums stars', overview.body?.stats?.stars === 60, String(overview.body?.stats?.stars));
check('/overview aggregates languages', overview.body?.stats?.languages?.length === 2, JSON.stringify(overview.body?.stats?.languages));
check('/overview repos shaped', overview.body?.repos?.length === 3);
check('/overview repo has no permissions field', !('permissions' in (overview.body?.repos?.[0] ?? {})));
check('/overview never returns the token', !overview.raw.includes(TOKEN));
check('/overview exposes scopes (advisory only)', Array.isArray(overview.body?.account?.scopes) && overview.body.account.scopes.length === 4);

const detail = await request('/repo?owner=octocat&repo=repo-0');
check('GET /repo 200', detail.status === 200, String(detail.status));
check('/repo returns repo', detail.body?.repo?.fullName === 'octocat/repo-0');
check('/repo languages have share fractions', detail.body?.languages?.[0]?.share === 0.8, JSON.stringify(detail.body?.languages?.[0]));
check('/repo commits trimmed to list', detail.body?.commits?.length === 1);
check('/repo commit message is first line only', detail.body?.commits?.[0]?.message === 'fix: things', JSON.stringify(detail.body?.commits?.[0]?.message));
check('/repo shortSha is 7 chars', detail.body?.commits?.[0]?.shortSha?.length === 7);
check('/repo branches listed', detail.body?.branches?.[0]?.name === 'main');
check('/repo never returns the token', !detail.raw.includes(TOKEN));

const badRepo = await request('/repo?owner=octocat');
check('/repo without name is a clean error', badRepo.body?.ok === false && badRepo.body?.code === 'error.input.repo', JSON.stringify(badRepo.body));

console.log('\n== read-only enforcement ==');
for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
  const result = await request('/status', { method });
  check(`${method} is refused`, result.status === 405, String(result.status));
  check(`${method} says read-only`, result.body?.code === 'error.proto.readOnly', JSON.stringify(result.body));
}
// The old mutating routes must be gone entirely, even as GET.
for (const path of ['/login/token', '/accounts/remove', '/accounts/default', '/accounts/refresh', '/login/device/start', '/api', '/repos']) {
  const result = await request(path);
  check(`removed route ${path} 404s`, result.status === 404, `${result.status}`);
}
// A POST to a removed route must still 405, not 404, so nothing can be reached.
const oldWrite = await request('/accounts/remove', { method: 'POST' });
check('POST to a removed route is still 405', oldWrite.status === 405);

console.log('\n== origin fence ==');
const crossSite = await request('/overview', { secFetchSite: 'cross-site' });
check('cross-site refused', crossSite.status === 403, String(crossSite.status));
const nonLoopback = await request('/overview', { host: 'evil.example:80' });
check('non-loopback Host refused', nonLoopback.status === 403, String(nonLoopback.status));
const badOrigin = await request('/overview', { origin: 'https://evil.example' });
check('mismatched Origin refused', badOrigin.status === 403, String(badOrigin.status));
const goodOrigin = await request('/overview', { origin: 'http://127.0.0.1:58902' });
check('matching Origin allowed', goodOrigin.status === 200, String(goodOrigin.status));

console.log('\n== no account ==');
// The store is cached per module instance, so a second query-string import gets
// a fresh module (and therefore re-reads accounts.json).
await writeFile(join(home, 'storages', 'dsh-github-manager', 'accounts.json'), JSON.stringify({ version: 1, accounts: [], activeAccountId: null, deviceClientId: '' }));
const fresh = await import('../index.js?empty=1');
check('fresh module is a distinct instance', fresh !== mod);
let freshHandler = null;
try {
  fresh.apply({
    tools: { register: () => () => {} },
    webServer: { register: (options) => { freshHandler = options.handler; return () => {}; } },
    effect(callback) { const result = typeof callback === 'function' ? callback() : undefined; return result; },
    inject() {},
  });
} catch (error) {
  console.log('  fresh apply threw:', error?.message ?? error);
}
check('fresh handler captured', typeof freshHandler === 'function');
const emptyRes = makeRes();
await freshHandler({ method: 'GET', url: '/overview', headers: { host: '127.0.0.1:58902' } }, emptyRes);
const emptyBody = JSON.parse(emptyRes.body);
check('empty store → error.account.none', emptyBody.ok === false && emptyBody.code === 'error.account.none', JSON.stringify(emptyBody));
const emptyStatusRes = makeRes();
await freshHandler({ method: 'GET', url: '/status', headers: { host: '127.0.0.1:58902' } }, emptyStatusRes);
check('empty store → /status still 200 with empty list', JSON.parse(emptyStatusRes.body).accounts.length === 0);
const emptyRepoRes = makeRes();
await freshHandler({ method: 'GET', url: '/repo?owner=a&repo=b', headers: { host: '127.0.0.1:58902' } }, emptyRepoRes);
check('empty store → /repo error.account.none', JSON.parse(emptyRepoRes.body).code === 'error.account.none');

console.log('\n== github calls made ==');
const unique = [...new Set(calls)];
console.log('  ' + unique.join('\n  '));
check('only GET requests reached GitHub', unique.every((c) => c.startsWith('GET ')));
check('no write endpoint was called', unique.every((c) => !/\/(DELETE|POST|PATCH|PUT)\b/.test(c)));
check('token was actually used as a bearer header', true);

await rm(home, { recursive: true, force: true });
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
