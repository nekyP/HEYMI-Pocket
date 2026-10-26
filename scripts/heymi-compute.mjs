#!/usr/bin/env node
/** Source-only consumer of the shared HEYMI compute engine. No core is bundled. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const ownFile = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(ownFile), '..');
const OPTIONS = Object.freeze({
  pack: ['--query', '--scope', '--max-files', '--state-dir'],
  check: ['--pack-dir'],
  doctor: ['--config', '--probe'],
});
const fail = code => { const error = new Error(code); error.code = code; throw error; };

export async function buildInvocation(argv, { root = projectRoot, env = process.env } = {}) {
  root = await fs.realpath(root);
  if (Number(process.versions.node.split('.')[0]) < 24) fail('compute-requires-node-24');
  const [mode, ...tokens] = argv;
  if (!Object.hasOwn(OPTIONS, mode)) fail('unsupported-compute-command');
  const values = {};
  for (let i = 0; i < tokens.length; i += 2) {
    const name = tokens[i], value = tokens[i + 1];
    if (!OPTIONS[mode].includes(name) || typeof value !== 'string' || !value || Object.hasOwn(values, name)) fail('invalid-compute-options');
    values[name] = value;
  }
  const manifestFile = path.join(root, 'integrations/heymi-compute.json');
  const manifestStat = await fs.lstat(manifestFile);
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink() || manifestStat.size > 32768) fail('invalid-compute-manifest');
  const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
  if (manifest.schema !== 'heymi-compute-consumer@1' || !Array.isArray(manifest.sourceScopes) || !manifest.sourceScopes.length) fail('invalid-compute-manifest');
  if (mode === 'pack') {
    if (!values['--query']?.trim() || Buffer.byteLength(values['--query']) > 1024) fail('compute-query-required');
    const scope = values['--scope'] ?? manifest.sourceScopes[0];
    if (typeof scope !== 'string' || (!/^[A-Za-z0-9_./-]+$/.test(scope)) || scope.split('/').some(p => !p || p === '..' || (p === '.' && scope !== '.')) || path.isAbsolute(scope)) fail('invalid-compute-scope');
    if (!manifest.sourceScopes.some(allowed => allowed === '.' || scope === allowed || scope.startsWith(allowed + '/'))) fail('compute-scope-not-registered');
    values['--scope'] = scope;
    if (values['--max-files'] && (!/^[0-9]+$/.test(values['--max-files']) || Number(values['--max-files']) < 1 || Number(values['--max-files']) > 32)) fail('invalid-compute-file-limit');
  }
  if (mode === 'check' && !values['--pack-dir']) fail('compute-pack-directory-required');
  if (values['--probe'] && !['true', 'false'].includes(values['--probe'])) fail('invalid-compute-probe');
  const selected = env.HEYMI_COMPUTE_CLI ?? path.resolve(root, '../HEYMI/tools/black-sheep-compute/cli.mjs');
  if (!path.isAbsolute(selected)) fail('compute-engine-path-must-be-absolute');
  let cli;
  try {
    cli = await fs.realpath(selected);
    if (!(await fs.stat(cli)).isFile() || path.basename(cli) !== 'cli.mjs' || cli === ownFile) fail('shared-compute-engine-unavailable');
  } catch { fail('shared-compute-engine-unavailable'); }
  const command = { pack: 'local-pack', check: 'local-check', doctor: 'doctor' }[mode];
  const args = [cli, command, '--project-root', root];
  for (const [name, value] of Object.entries(values)) args.push(name, value);
  return { binary: process.execPath, args, cwd: root, env };
}

export async function main(argv = process.argv.slice(2), options = {}) {
  if (!argv.length || ['--help', '-h', 'help'].includes(argv[0])) {
    console.log(`HEYMI shared source compute (Node.js 24+)

node scripts/heymi-compute.mjs pack --query TEXT [--scope DIR] [--max-files N] [--state-dir DIR]
node scripts/heymi-compute.mjs check --pack-dir DIR
node scripts/heymi-compute.mjs doctor [--config FILE] [--probe true]

Uses HEYMI_COMPUTE_CLI or ../HEYMI/tools/black-sheep-compute/cli.mjs.
Pack/check need no inference, provider key or GitHub Actions runner.
Doctor probes model metadata only when --probe true is explicit.
This developer client never runs AI generation, deploys, or changes application data.`);
    return 0;
  }
  try {
    const invocation = await buildInvocation(argv, options);
    const result = spawnSync(invocation.binary, invocation.args, {
      cwd: invocation.cwd, env: invocation.env, shell: false,
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120000, maxBuffer: 2 * 1024 * 1024, windowsHide: true,
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error || !Number.isInteger(result.status)) fail('shared-compute-process-failed');
    return result.status;
  } catch (error) {
    const code = typeof error.code === 'string' && /^[a-z][a-z0-9-]{2,79}$/.test(error.code) ? error.code : 'compute-consumer-failed';
    console.error(JSON.stringify({ status: 'blocked', errorCode: code, nextStep: 'Use --help. Install a trusted HEYMI checkout with Node.js 24+ and set HEYMI_COMPUTE_CLI to its absolute cli.mjs path if it is not a sibling checkout.' }));
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = await main();
