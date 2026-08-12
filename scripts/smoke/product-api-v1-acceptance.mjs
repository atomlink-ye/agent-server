#!/usr/bin/env node

import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateRecording } from '../ci/validate-product-recording.mjs';

const SCENARIOS = new Set(['oi38', 'parallel-success', 'rework-once', 'lead-never-accept']);

function fail(code, detail = '') {
  process.stderr.write(`${code}${detail ? `:${detail}` : ''}\n`);
  process.exitCode = 1;
  throw new Error(code);
}

function parseArgs(argv) {
  const allowed = new Set(['--scenario', '--all', '--recordings', '--evidence-dir', '--base-url']);
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (!allowed.has(name)) fail('invalid_cli_arguments');
    if (name === '--all') {
      if (parsed[name]) fail('invalid_cli_arguments');
      parsed[name] = true;
      continue;
    }
    const value = argv[++index];
    if (!value || value.startsWith('--') || parsed[name]) fail('invalid_cli_arguments');
    parsed[name] = value;
  }
  return parsed;
}

async function recordingDirs(root) {
  const found = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (!entry.isDirectory()) continue;
      try {
        await readFile(join(path, 'manifest.json'));
        found.push(path);
      } catch {
        await walk(path);
      }
    }
  }
  await walk(resolve(root));
  return found.sort();
}

function child(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: options.stdio ?? 'pipe', env: process.env });
  return { exit: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

async function oi38(baseUrl) {
  const ownerToken = process.env.AGENT_SERVER_TOKEN ?? process.env.AGENT_SERVER_SERVICE_TOKEN ?? process.env.SERVICE_ACCOUNT_TOKEN;
  const foreignToken = process.env.AGENT_SERVER_FOREIGN_TOKEN ?? process.env.OI38_FOREIGN_TOKEN;
  const workId = process.env.PRODUCT_E2E_WORK_ID;
  if (!ownerToken || !foreignToken || !workId) fail('oi38_environment_required');
  async function request(token, path) {
    const response = await fetch(new URL(path, baseUrl), { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } });
    return { status: response.status, body: await response.json().catch(() => null) };
  }
  const ownerRuns = await request(ownerToken, `/api/v1/works/${workId}/runs?limit=100`);
  if (ownerRuns.status !== 200 || !Array.isArray(ownerRuns.body?.work_runs) || ownerRuns.body.work_runs.length < 1) fail('oi38_owner_positive_control_failed');
  const missingId = randomUUID();
  const foreign = await request(foreignToken, `/api/v1/works/${workId}`);
  const missing = await request(foreignToken, `/api/v1/works/${missingId}`);
  const normalize = (value) => {
    const copy = structuredClone(value.body);
    if (copy?.error) delete copy.error.request_id;
    return JSON.stringify(copy);
  };
  if (foreign.status !== 404 || missing.status !== 404 || normalize(foreign) !== normalize(missing) || foreign.body?.error?.code !== 'work_not_found') fail('oi38_foreign_missing_mismatch');
  process.stdout.write(JSON.stringify({ scenario: 'oi38', owner_work_run_count: ownerRuns.body.work_runs.length, foreign_status: foreign.status, missing_status: missing.status }) + '\n');
}

async function mutationProbe(recording) {
  const temp = await mkdtemp('/tmp/product-api-v1-');
  try {
    await cp(recording, temp, { recursive: true });
    const copy = join(temp, recording.split('/').at(-1));
    const file = join(copy, 'api', 'trace.json');
    const bytes = await readFile(file);
    bytes[0] = bytes[0] === 123 ? 124 : bytes[0] ^ 1;
    await writeFile(file, bytes);
    // Run in the copied recording directory so the checksum command verifies the mutation.
    const checked = spawnSync('sha256sum', ['-c', 'SHA256SUMS'], { cwd: copy, encoding: 'utf8', env: process.env });
    const exit = checked.status ?? 1;
    process.stdout.write(`HASH_MUTATION_EXIT=${exit}\n`);
    if (exit === 0) fail('hash_mutation_probe_not_red');
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const scenario = args['--scenario'];
  if (scenario && !SCENARIOS.has(scenario)) fail('invalid_scenario');
  if (scenario === 'oi38') {
    await oi38(args['--base-url'] ?? process.env.AGENT_SERVER_BASE_URL ?? process.env.AGENT_SERVER_URL);
    process.stdout.write('EXIT=0\n');
    return;
  }
  if (scenario && scenario !== 'oi38') {
    const baseUrl = args['--base-url'] ?? process.env.AGENT_SERVER_BASE_URL ?? process.env.AGENT_SERVER_URL;
    if (!baseUrl) fail('base_url_required');
    const result = child(process.execPath, ['scripts/record/product-projection-real-run.mjs', '--mode', 'product', '--scenario', scenario, '--base-url', baseUrl], { stdio: 'inherit' });
    process.stdout.write(`RECORDER_EXIT=${result.exit}\n`);
    if (result.exit !== 0) process.exitCode = result.exit;
    else process.stdout.write('EXIT=0\n');
    return;
  }
  if (!args['--all']) fail('scenario_or_all_required');
  const root = args['--recordings'];
  if (!root) fail('recordings_required');
  const baseUrl = args['--base-url'] ?? process.env.AGENT_SERVER_BASE_URL ?? process.env.AGENT_SERVER_URL;
  if (!baseUrl) fail('base_url_required');
  const dirs = await recordingDirs(root);
  if (dirs.length !== 3) fail('recording_set_incomplete', String(dirs.length));
  for (const directory of dirs) {
    const result = await validateRecording(directory, 'product');
    process.stdout.write(`${JSON.stringify({ recording: directory, ...result })}\n`);
  }
  await mutationProbe(dirs[0]);
  const foreign = child(process.execPath, ['scripts/record/product-projection-real-run.mjs', '--mode', 'product', '--scenario', 'parallel-success', '--base-url', baseUrl, '--work-run-id', randomUUID()]);
  process.stdout.write(`${foreign.output}`);
  process.stdout.write(`FOREIGN_WORK_RUN_EXIT=${foreign.exit}\n`);
  if (foreign.exit === 0) fail('foreign_work_run_probe_not_red');
  const additive = child(process.execPath, ['scripts/smoke/product-consumer-additive-field.mjs', '--recording', dirs[0]]);
  process.stdout.write(additive.output);
  if (additive.exit !== 0) fail('consumer_compatibility_probe_not_green');
  process.stdout.write('EXIT=0\n');
}

main().catch(() => {
  if (process.exitCode === undefined || process.exitCode === 0) process.exitCode = 1;
});
