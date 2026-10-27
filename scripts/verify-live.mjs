/**
 * End-to-end proof with the REAL account store and the REAL GitHub API, driven
 * through the plugin's own route handler — i.e. exactly what the read-only
 * panel will load. Uses Node's fetch (curl in this environment is proxied and
 * returns 502 against api.github.com).
 *
 * Read-only: it never writes the account store, and every GitHub call is a GET.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

process.env.DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh');

const { apply } = await import(new URL('../index.js', import.meta.url).href);

const seen = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  seen.push(`${init?.method ?? 'GET'} ${String(url).replace('https://api.github.com', '')}`);
  return realFetch(url, init);
};

const captured = [];
const ctx = {
  tools: { register: () => () => {} },
  skills: { registerProvider: () => () => {} },
  webServer: { register: (def) => { captured.push(def.handler); return () => {}; } },
  inject: () => {},
  effect(callback) {
    const result = typeof callback === 'function' ? callback() : undefined;
    return typeof result === 'function' ? result : () => {};
  },
};
apply(ctx);
const route = captured[0];

const call = (pathname) => new Promise((resolve) => {
  const req = { method: 'GET', url: pathname, headers: { host: '127.0.0.1:58902', origin: 'http://127.0.0.1:58902' } };
  const chunks = [];
  const res = {
    statusCode: 200,
    setHeader() {},
    writeHead(code) { this.statusCode = code; },
    end(chunk) { if (chunk) chunks.push(Buffer.from(chunk)); resolve({ status: this.statusCode, body: Buffer.concat(chunks).toString('utf8') }); },
  };
  route(req, res);
});

const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(name);
};
/** The only token material the HTTP surface may expose is the masked preview. */
const leaksToken = (text) => /(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/u.test(text) && !/gh[pousr]_…/u.test(text.replace(/gh[pousr]_[A-Za-z0-9]{20,}/gu, ''));

console.log('== /status ==');
const status = JSON.parse((await call('/status')).body);
check('account present', status.accounts?.length === 1, JSON.stringify(status.accounts?.map((a) => a.login)));
check('no raw token in /status', !/(?:gh[pousr]_|github_pat_)[A-Za-z0-9]{20,}/u.test(JSON.stringify(status)));

console.log('\n== /overview (real GitHub) ==');
const ovRes = await call('/overview');
const ov = JSON.parse(ovRes.body);
check('/overview ok', ov.ok === true, ovRes.body.slice(0, 160));
if (ov.ok) {
  check('login is LLL-lyh0', ov.account.login === 'LLL-lyh0', ov.account.login);
  check('repos loaded', ov.repos.length > 0, `repos=${ov.repos.length}`);
  check('stats present', typeof ov.stats?.privateCount === 'number', JSON.stringify(ov.stats));
  check('top languages computed', Array.isArray(ov.stats?.languages) && ov.stats.languages.length > 0, JSON.stringify(ov.stats?.languages));
  check('no raw token in /overview', !/(?:gh[pousr]_|github_pat_)[A-Za-z0-9]{20,}/u.test(ovRes.body));
  console.log('  repos:', ov.repos.map((r) => `${r.fullName}${r.private ? '*' : ''}`).join(', '));
  console.log('  languages:', ov.stats.languages.map((l) => `${l.name} ${l.count}`).join(', '));
}

console.log('\n== /repo (real GitHub) ==');
const target = ov.ok ? ov.repos.find((r) => !r.fork) ?? ov.repos[0] : null;
if (target) {
  const dRes = await call(`/repo?owner=${encodeURIComponent(target.owner)}&repo=${encodeURIComponent(target.name)}`);
  const d = JSON.parse(dRes.body);
  check('/repo ok', d.ok === true, dRes.body.slice(0, 160));
  if (d.ok) {
    check('commits listed', Array.isArray(d.commits), `commits=${d.commits?.length}`);
    check('shortSha is 7 chars', !d.commits?.[0] || d.commits[0].shortSha.length === 7);
    check('branches listed', Array.isArray(d.branches), `branches=${d.branches?.length}`);
    check('language share in 0..1', !d.languages?.[0] || (d.languages[0].share > 0 && d.languages[0].share <= 1), JSON.stringify(d.languages?.[0]));
    check('no raw token in /repo', !/(?:gh[pousr]_|github_pat_)[A-Za-z0-9]{20,}/u.test(dRes.body));
    console.log('  repo:', `${target.owner}/${target.name}`);
    console.log('  languages:', (d.languages ?? []).map((l) => `${l.name} ${(l.share * 100).toFixed(0)}%`).join(', ') || '(none)');
    console.log('  latest commit:', d.commits?.[0] ? `${d.commits[0].shortSha} ${d.commits[0].message.slice(0, 50)}` : '(none)');
    console.log('  branches:', (d.branches ?? []).slice(0, 5).join(', ') || '(none)');
  }
}

console.log('\n== read-only surface ==');
for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
  const r = await new Promise((resolve) => {
    const req = { method, url: '/status', headers: { host: '127.0.0.1:58902', origin: 'http://127.0.0.1:58902' } };
    const chunks = [];
    const res = {
      statusCode: 200, setHeader() {}, writeHead(c) { this.statusCode = c; },
      end(chunk) { if (chunk) chunks.push(Buffer.from(chunk)); resolve({ status: this.statusCode, body: Buffer.concat(chunks).toString('utf8') }); },
    };
    route(req, res);
  });
  check(`${method} → 405 readOnly`, r.status === 405 && r.body.includes('error.proto.readOnly'));
}

console.log('\n== GitHub calls made ==');
for (const line of seen) console.log('  ' + line);
check('only GET requests', seen.every((l) => l.startsWith('GET ')));
check('token never printed', !seen.some((l) => /gh[pousr]_[A-Za-z0-9]{20,}/u.test(l)));

console.log(failures.length === 0 ? '\nALL CHECKS PASSED' : `\n${failures.length} CHECK(S) FAILED`);
process.exit(failures.length === 0 ? 0 : 1);
