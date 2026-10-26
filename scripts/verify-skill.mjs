/**
 * Verification harness for dsh-github-manager v1.2.0.
 *
 * Simulates the Cordis surfaces the plugin touches: ctx.inject, ctx.effect
 * (including generator form, where the callback runs immediately and yielded
 * functions are disposers), ctx.tools.register, ctx.skills.registerProvider,
 * ctx.webServer.register. Then asserts the skill is registered with a real
 * description, that its resources are readable, and that the temp copy is
 * cleaned up on dispose.
 */

import { existsSync, readdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = await mkdtemp(join(tmpdir(), 'gm-test-home-'));
process.env.DSH_HOME = home;

const mod = await import('../index.js');

const log = [];
const disposers = [];
const tools = [];
let skillProviders = [];
let disposedSkillResources = null;

function makeScope(label) {
  const scope = {
    tools: {
      register(definition) {
        tools.push(definition);
        log.push(`tools.register:${definition.name}`);
        return () => log.push(`tools.dispose:${definition.name}`);
      },
    },
    webServer: {
      register(options) {
        log.push(`webServer.register:${options.path}`);
        return () => log.push('webServer.dispose');
      },
    },
    skills: {
      registerProvider(create) {
        const provider = create({ invalidate: () => log.push('invalidate'), signal: new AbortController().signal });
        skillProviders.push(provider);
        log.push(`skills.registerProvider:${provider.name}`);
        return () => {
          skillProviders = skillProviders.filter((p) => p !== provider);
          log.push('skills.disposeProvider');
        };
      },
    },
    effect(callback) {
      // Cordis: the callback runs immediately; a generator yields disposers,
      // which Cordis releases in reverse order (LIFO) when the fiber disposes.
      if (typeof callback === 'function' && callback.constructor?.name === 'GeneratorFunction') {
        const iterator = callback();
        let step = iterator.next();
        while (!step.done) {
          const yielded = step.value;
          if (typeof yielded === 'function') {
            yielded.__fromGenerator = true;
            disposers.push(yielded);
          }
          step = iterator.next();
        }
        return;
      }
      const result = typeof callback === 'function' ? callback() : undefined;
      if (typeof result === 'function') disposers.push(result);
    },
  };
  scope.get = (name) => (name === 'skills' ? scope.skills : undefined);
  scope.__label = label;
  return scope;
}

const ctx = makeScope('root');
ctx.inject = (deps, callback) => {
  log.push(`inject:[${deps.join(',')}]`);
  const scope = makeScope(`inject(${deps.join(',')})`);
  callback(scope);
  return () => log.push('inject.dispose');
};

let failures = 0;
function check(name, condition, detail) {
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${name}${detail === undefined ? '' : ` — ${detail}`}`);
  }
}

console.log('\n== apply ==');
mod.apply(ctx);
console.log('  log:', log.join(' | '));

check('tools registered', tools.length === 2, `got ${tools.length}`);
check('tool github_accounts present', tools.some((t) => t.name === 'github_accounts'));
check('tool github_api present', tools.some((t) => t.name === 'github_api'));
check('http surface registered', log.some((l) => l.startsWith('webServer.register:/api/dsh-github-manager')));
check('skills.inject requested', log.some((l) => l === 'inject:[skills]'));
check('skill provider registered', skillProviders.length === 1, `got ${skillProviders.length}`);

console.log('\n== skill catalog ==');
const provider = skillProviders[0];
const candidates = await provider.list();
check('exactly one skill', candidates.length === 1, `got ${candidates.length}`);
const candidate = candidates[0];
console.log('  name       :', candidate.name);
console.log('  provider   :', candidate.provider);
console.log('  source     :', candidate.source);
console.log('  rank       :', candidate.rank);
console.log('  resourceBase:', candidate.resourceBase.kind, candidate.resourceBase.path);
console.log('  description:', candidate.description.slice(0, 120) + '…');

check('name is kebab-case', /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(candidate.name), candidate.name);
check('description from frontmatter (not fallback)', candidate.description.includes('dsh-github-manager tools'));
check('description is one line', !candidate.description.includes('\n'));
check('modelInvocable', candidate.invocation.modelInvocable === true);
check('userInvocable', candidate.invocation.userInvocable === true);
check('provider name matches', candidate.provider === provider.name);
check('rank is bundled (600)', candidate.rank === 600);
check('resourceBase is a private temp dir', candidate.resourceBase.kind === 'directory' && candidate.resourceBase.path.includes('dsh-github-skill-'));
check('SKILL.md copied into temp dir', existsSync(join(candidate.resourceBase.path, 'SKILL.md')));
check('resources/ copied into temp dir', existsSync(join(candidate.resourceBase.path, 'resources')));

console.log('\n== skill load ==');
const loaded = await provider.get(candidate, { signal: new AbortController().signal });
check('content returned', typeof loaded.content === 'string' && loaded.content.length > 1000, `${loaded.content?.length ?? 0} chars`);
check('frontmatter stripped from body', !loaded.content.startsWith('---'));
check('body mentions github_api tool', loaded.content.includes('github_api'));
check('body mentions prompt-injection rule', loaded.content.includes('untrusted') || loaded.content.includes('not instructions'));
console.log('  content length:', loaded.content.length, 'chars');

const resourceDir = join(candidate.resourceBase.path, 'resources');
const resources = readdirSync(resourceDir);
console.log('  resources:', resources.join(', '));
for (const file of resources) {
  const text = await import('node:fs').then((fs) => fs.readFileSync(join(resourceDir, file), 'utf8'));
  check(`resource ${file} non-trivial`, text.length > 500, `${text.length} bytes`);
  check(`resource ${file} has no unfilled placeholder`, !/\b(?:TODO|TBD|FIXME|XXX)\b/u.test(text));
}

// Every resource file named in SKILL.md must exist, and every existing resource
// must be referenced — a dangling reference costs a wasted tool call at runtime.
const skillText = loaded.content;
for (const file of resources) {
  check(`SKILL.md references ${file}`, skillText.includes(`resources/${file}`));
}
const referenced = [...skillText.matchAll(/resources\/([a-z0-9-]+\.md)/gu)].map((m) => m[1]);
for (const name of new Set(referenced)) {
  check(`referenced file ${name} exists`, resources.includes(name));
}

console.log('\n== dispose ==');
// The generator yielded two disposers: remove the temp dir, then unregister the
// provider. Cordis releases them LIFO, so assert that order explicitly.
const skillDisposers = disposers.filter((d) => d.__fromGenerator === true);
check('generator yielded two disposers', skillDisposers.length === 2, `got ${skillDisposers.length}`);
const tempDir = candidate.resourceBase.path;
const [removeDir, unregisterProvider] = skillDisposers;
check('first yielded disposer removes the dir', typeof removeDir === 'function');
check('temp dir exists before dispose', existsSync(tempDir), tempDir);

// LIFO: provider unregisters first.
await unregisterProvider();
check('provider unregistered', skillProviders.length === 0, `got ${skillProviders.length}`);
check('temp dir still present mid-teardown', existsSync(tempDir), tempDir);

await removeDir();
check('temp resource dir removed on dispose', !existsSync(tempDir), tempDir);

await rm(home, { recursive: true, force: true });

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
