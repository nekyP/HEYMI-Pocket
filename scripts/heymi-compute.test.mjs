import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildInvocation } from './heymi-compute.mjs';

async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'heymi-consumer-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'repo'), engine = path.join(base, 'trusted engine $literal');
  await fs.mkdir(path.join(root, 'integrations'), { recursive: true });
  await fs.mkdir(engine);
  await fs.writeFile(path.join(root, 'integrations/heymi-compute.json'), JSON.stringify({ schema: 'heymi-compute-consumer@1', sourceScopes: ['src', 'scripts'] }));
  const cli = path.join(engine, 'cli.mjs');
  await fs.writeFile(cli, 'console.log(JSON.stringify({argv:process.argv.slice(2),cwd:process.cwd()}));\n');
  return { root, cli, env: { ...process.env, HEYMI_COMPUTE_CLI: cli } };
}

test('consumer passes fixed commands, exact project root and literal values as argv', async t => {
  const f = await fixture(t);
  const query = 'code $(touch should-not-exist) `literal`';
  const invocation = await buildInvocation(['pack', '--query', query, '--scope', 'src/lib'], f);
  assert.equal(invocation.binary, process.execPath);
  assert.deepEqual(invocation.args, [f.cli, 'local-pack', '--project-root', f.root, '--query', query, '--scope', 'src/lib']);
  const result = spawnSync(invocation.binary, invocation.args, { cwd: invocation.cwd, env: invocation.env, encoding: 'utf8', shell: false });
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(output.argv, invocation.args.slice(1));
  await assert.rejects(fs.stat(path.join(f.root, 'should-not-exist')), /ENOENT/);
});

test('consumer rejects generation, arbitrary flags, missing query and unregistered scopes', async t => {
  const f = await fixture(t);
  for (const args of [
    ['run'], ['exec', '--command', 'anything'], ['pack'],
    ['pack', '--query', 'source', '--scope', '../other'],
    ['pack', '--query', 'source', '--scope', 'database'],
    ['pack', '--query', 'source', '--project-root', '/other'],
    ['pack', '--query', 'source', '--max-files', '100'],
    ['pack', '--query', 'one', '--query', 'two'],
    ['doctor', '--probe', 'yes'], ['check'],
  ]) await assert.rejects(buildInvocation(args, f));
});

test('check and doctor preserve their limited shared-engine contract', async t => {
  const f = await fixture(t);
  assert.deepEqual((await buildInvocation(['check', '--pack-dir', '/private/pack'], f)).args, [f.cli, 'local-check', '--project-root', f.root, '--pack-dir', '/private/pack']);
  assert.deepEqual((await buildInvocation(['doctor', '--probe', 'true'], f)).args, [f.cli, 'doctor', '--project-root', f.root, '--probe', 'true']);
});

test('missing or relative shared engine produces an explicit setup blocker', async t => {
  const f = await fixture(t);
  await assert.rejects(buildInvocation(['doctor'], { ...f, env: { ...f.env, HEYMI_COMPUTE_CLI: 'cli.mjs' } }), /must-be-absolute/);
  await assert.rejects(buildInvocation(['doctor'], { ...f, env: { ...f.env, HEYMI_COMPUTE_CLI: path.join(f.root, 'missing/cli.mjs') } }), /unavailable/);
});

test('help works before configuring a shared engine', () => {
  const own = fileURLToPath(new URL('./heymi-compute.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [own, '--help'], { encoding: 'utf8', env: { ...process.env, HEYMI_COMPUTE_CLI: '/missing/cli.mjs' } });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Pack\/check need no inference/);
});
