/**
 * The store cache must not pin a "no account" verdict. A store file can appear
 * after the plugin has already answered once (first sign-in, or an account
 * seeded by another process), and a stale empty cache would make the read-only
 * panel report "no account connected" forever.
 *
 * This drives the REAL route handler against a temp DSH_HOME and creates the
 * accounts.json *after* the first request.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'dsh-github-cache-'));
process.env.DSH_HOME = root;

const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(name);
};

// Offline: never touch the network. /overview only needs the account record
// when there is one; with no account it answers before any fetch.
let calls = 0;
globalThis.fetch = async (url) => {
  calls += 1;
  const body = String(url).includes('/user/repos') ? [] : { login: 'octocat', name: 'The Octocat', public_repos: 0, followers: 0 };
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
};

const { apply } = await import('file:///D:/DeepSeekHarness/dsh-github-manager/index.js');

function makeCtx() {
  const routes = new Map();
  const tools = new Map();
  const ctx = {
    tools: { register: (def) => { tools.set(def.name, def); return () => {}; } },
    skills: { registerProvider: () => () => {} },
    webServer: { register: (def) => { routes.set(def.path, def.handler); return () => {}; } },
    inject: (_names, factory) => factory(ctx),
    effect(callback) {
      const result = typeof callback === 'function' ? callback() : undefined;
      return typeof result === 'function' ? result : () => {};
    },
  };
  return { ctx, routes, tools };
}

const { ctx } = makeCtx();
apply(ctx);
const handler = ctx.__lastHandler ?? null;

// Grab the handler via a second apply that records the route.
const routes = new Map();
ctx.webServer.register = (def) => { routes.set(def.path, def.handler); return () => {}; };

// Re-apply so the handler is captured (register already replaced above).
const fresh = makeCtx();
// patch: capture routes before apply
const captured = [];
fresh.ctx.webServer.register = (def) => { captured.push(def.handler); return () => {}; };
apply(fresh.ctx);
const route = captured[0];
check('route handler captured', typeof route === 'function');

function call(pathname) {
  return new Promise((resolve) => {
    const req = { method: 'GET', url: pathname, headers: { host: '127.0.0.1:58902', origin: 'http://127.0.0.1:58902' } };
    const chunks = [];
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      end(chunk) { if (chunk) chunks.push(Buffer.from(chunk)); resolve({ status: this.statusCode, body: Buffer.concat(chunks).toString('utf8') }); },
      writeHead(code) { this.statusCode = code; },
    };
    route(req, res);
  });
}

process.on('unhandledRejection', (e) => { console.log('  FAIL  unhandled:', e?.message); process.exit(1); });

console.log('\n== store absent ==');
const before = await call('/overview');
check('store absent → error.account.none', before.status === 200 && before.body.includes('error.account.none'), before.body.slice(0, 90));

console.log('\n== store appears afterwards ==');
const dir = join(root, 'storages', 'dsh-github-manager');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'accounts.json'), JSON.stringify({
  version: 1,
  accounts: [{
    id: 'late-account', login: 'octocat', name: 'The Octocat', avatarUrl: 'https://example.invalid/a.png',
    email: null, scopes: ['repo'], tokenKind: 'pat', label: 'octocat',
    token: 'ghp_SECRETtokenVALUE0123456789', addedAt: new Date().toISOString(),
    verifiedAt: new Date().toISOString(), lastError: null, isDefault: true,
  }],
  activeAccountId: 'late-account',
  deviceClientId: '',
}, null, 2));

const after = await call('/overview');
const parsed = JSON.parse(after.body);
check('store appearing later is picked up (no stale empty cache)', parsed.ok === true, after.body.slice(0, 120));
check('picked-up account is the seeded one', parsed.ok === true && parsed.account?.login === 'octocat');
check('token still absent from the body', !after.body.includes('SECRETtoken'));
check('a GitHub call actually happened', calls > 0, `calls=${calls}`);

console.log('\n== /status stays consistent ==');
const status = await call('/status');
const statusJson = JSON.parse(status.body);
check('/status lists the same account', statusJson.accounts?.length === 1 && statusJson.accounts[0].login === 'octocat');

rmSync(root, { recursive: true, force: true });

console.log(failures.length === 0 ? '\nALL CHECKS PASSED' : `\n${failures.length} CHECK(S) FAILED`);
process.exit(failures.length === 0 ? 0 : 1);
