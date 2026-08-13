#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const shaPattern = /^[a-f0-9]{40}$/u;
const verifier = 'scripts/ci/verify-product-accepted-gate-lineage.mjs';
const checker = 'scripts/ci/check-product-accepted-subset.ts';
const wiringChecker = 'scripts/ci/check-product-accepted-guard-wiring.mjs';
const routeGuard = 'scripts/ci/guard-create-app-product-endpoints.mjs';
const mutator = 'scripts/ci/mutate-create-app-product-registrar.mjs';
const commandMissing = [
  'MISSING:create_work',
  'MISSING:get_work_definition',
  'MISSING:list_work_runs',
  'MISSING:list_works',
  'MISSING:start_work_run',
];
const projectionMissing = [
  'MISSING:get_run_trace',
  'MISSING:get_work',
  'MISSING:get_work_run',
];
const guardedFiles = [
  'package.json',
  verifier,
  checker,
  wiringChecker,
  routeGuard,
  mutator,
  'scripts/ci/run-product-accepted-guard-evidence.mjs',
  'src/contracts/product-accepted-subset.v1.json',
  'evidence/product-contract/human-gate-decision.json',
  'evidence/product-contract/human-gate-product-contract-accepted.json',
  'evidence/product-contract/mgr-b-human-gate-format-continuation.json',
];

function optionValue(argv, names) {
  for (let index = 0; index < argv.length; index += 1) {
    if (!names.includes(argv[index])) continue;
    const value = argv[index + 1];
    if (!value || value.startsWith('--'))
      throw new Error(`missing_option_value:${argv[index]}`);
    return value;
  }
  return undefined;
}

function parseInput(argv) {
  const tier = optionValue(argv, ['--tier']);
  if (tier !== 'lineage' && tier !== 'runtime')
    throw new Error('tier_must_be_lineage_or_runtime');
  const output =
    optionValue(argv, ['--output', '--output-dir']) ??
    process.env.PRODUCT_ACCEPTED_GUARD_OUTPUT_DIR;
  if (!output) throw new Error('missing_explicit_output_dir');
  const candidateSha =
    optionValue(argv, ['--candidate-sha']) ??
    process.env.PRODUCT_ACCEPTED_GUARD_CANDIDATE_SHA ??
    process.env.CANDIDATE_SHA;
  if (!candidateSha || !shaPattern.test(candidateSha))
    throw new Error('candidate_sha_must_be_40_lowercase_hex_chars');
  return { tier, output: path.resolve(output), candidateSha };
}

function sha256File(relativePath, root = repo) {
  try {
    return {
      path: relativePath,
      sha256: crypto
        .createHash('sha256')
        .update(fs.readFileSync(path.join(root, relativePath)))
        .digest('hex'),
    };
  } catch (error) {
    return {
      path: relativePath,
      sha256: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function runArm({
  name,
  command,
  args,
  cwd,
  envOverrides = {},
  expectedExitCode,
  expectedMarkers,
}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...envOverrides },
  });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const markerLines = stderr
    .split(/\r?\n/u)
    .filter((line) => line.startsWith('MISSING:'));
  const markersOk = expectedMarkers
    ? JSON.stringify(markerLines) === JSON.stringify(expectedMarkers)
    : true;
  return {
    name,
    expected_exit_code: expectedExitCode,
    exit_code: result.status ?? 1,
    signal: result.signal ?? null,
    argv: [command, ...args],
    cwd,
    env_overrides: envOverrides,
    stdout,
    stderr,
    spawn_error: result.error?.message ?? null,
    ...(expectedMarkers
      ? {
          expected_markers: expectedMarkers,
          observed_markers: markerLines,
          marker_stream: 'stderr',
          markers_ok: markersOk,
        }
      : {}),
    ok: (result.status ?? 1) === expectedExitCode && markersOk,
  };
}

function skippedArm(name, cwd, expectedExitCode, reason) {
  return {
    name,
    expected_exit_code: expectedExitCode,
    exit_code: null,
    signal: null,
    argv: [],
    cwd,
    env_overrides: {},
    stdout: '',
    stderr: '',
    spawn_error: null,
    skipped: true,
    skip_reason: reason,
    ok: false,
  };
}

function createRuntimeCopy() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'product-accepted-guard-'),
  );
  fs.cpSync(path.join(repo, 'src'), path.join(directory, 'src'), {
    recursive: true,
  });
  fs.mkdirSync(path.join(directory, 'scripts/ci'), { recursive: true });
  for (const file of [routeGuard, mutator])
    fs.copyFileSync(
      path.join(repo, file),
      path.join(directory, file),
    );
  fs.symlinkSync(
    path.join(repo, 'node_modules'),
    path.join(directory, 'node_modules'),
    'dir',
  );
  return directory;
}

function runRegistrarMutation(kind) {
  const directory = createRuntimeCopy();
  const source = path.join(directory, 'src/entrypoints/api/app.ts');
  const mutated = path.join(
    directory,
    `src/entrypoints/api/app.${kind}.mutated.ts`,
  );
  const prep = runArm({
    name: `runtime-mutation-${kind}-prepare`,
    command: process.execPath,
    args: [path.join(directory, mutator), source, mutated, kind],
    cwd: directory,
    expectedExitCode: 0,
  });
  let harness;
  if (prep.ok) {
    fs.copyFileSync(mutated, source);
    harness = runArm({
      name: `runtime-mutation-${kind}`,
      command: process.execPath,
      args: ['--import', 'tsx', path.join(directory, routeGuard)],
      cwd: directory,
      expectedExitCode: 2,
      expectedMarkers: kind === 'command' ? commandMissing : projectionMissing,
    });
  } else {
    harness = skippedArm(
      `runtime-mutation-${kind}`,
      directory,
      2,
      'mutation_prepare_failed',
    );
  }
  fs.rmSync(directory, { recursive: true, force: true });
  return [prep, harness];
}

function writePackageMutation(mutatorFn) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'product-accepted-wiring-'),
  );
  const filename = path.join(directory, 'package.json');
  const pkg = JSON.parse(
    fs.readFileSync(path.join(repo, 'package.json'), 'utf8'),
  );
  mutatorFn(pkg.scripts);
  fs.writeFileSync(filename, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
  return { directory, filename };
}

function runWiringMutation(name, mutate) {
  const copy = writePackageMutation(mutate);
  const arm = runArm({
    name,
    command: process.execPath,
    args: [wiringChecker, '--package', copy.filename],
    cwd: repo,
    expectedExitCode: 1,
  });
  fs.rmSync(copy.directory, { recursive: true, force: true });
  return arm;
}

function runLineageTier() {
  const arms = [];
  arms.push(
    runArm({
      name: 'lineage-positive',
      command: process.execPath,
      args: [verifier],
      cwd: repo,
      expectedExitCode: 0,
    }),
  );
  arms.push(
    runArm({
      name: 'wiring-positive',
      command: process.execPath,
      args: [wiringChecker, '--package', path.join(repo, 'package.json')],
      cwd: repo,
      expectedExitCode: 0,
    }),
  );
  arms.push(
    runWiringMutation(
      'wiring-mutation-remove-check-backend-guard',
      (scripts) => {
        scripts['check:backend'] = scripts['check:backend']
          .split(' && ')
          .filter((part) => part !== 'pnpm guard:product-accepted-subset')
          .join(' && ');
      },
    ),
  );
  arms.push(
    runWiringMutation(
      'wiring-mutation-conditional-accepted-guard',
      (scripts) => {
        scripts['guard:product-accepted-subset'] =
          `${scripts['guard:product-accepted-subset']} || true`;
      },
    ),
  );
  return arms;
}

function runRuntimeTier() {
  const arms = [];
  arms.push(
    runArm({
      name: 'runtime-positive-accepted-checker',
      command: 'pnpm',
      args: ['check:product-accepted-subset'],
      cwd: repo,
      expectedExitCode: 0,
    }),
  );
  arms.push(
    runArm({
      name: 'runtime-positive-product-routes',
      command: 'pnpm',
      args: ['modularization:verify:product-routes'],
      cwd: repo,
      expectedExitCode: 0,
    }),
  );
  const behaviorCopy = createRuntimeCopy();
  arms.push(
    runArm({
      name: 'runtime-mutation-corrupt-get-work-response',
      command: process.execPath,
      args: ['--import', 'tsx', path.join(behaviorCopy, routeGuard)],
      cwd: behaviorCopy,
      envOverrides: { GUARD_CREATE_APP_MUTATION: 'corrupt_get_work_response' },
      expectedExitCode: 1,
    }),
  );
  fs.rmSync(behaviorCopy, { recursive: true, force: true });
  arms.push(...runRegistrarMutation('command'));
  arms.push(...runRegistrarMutation('projection'));
  return arms;
}

function hashes() {
  return {
    package_hash: sha256File('package.json'),
    guard_hashes: guardedFiles
      .filter((file) => file.startsWith('scripts/ci/'))
      .map((file) => sha256File(file)),
    manifest_hashes: guardedFiles
      .filter((file) => file.startsWith('src/contracts/'))
      .map((file) => sha256File(file)),
    evidence_hashes: guardedFiles
      .filter((file) => file.startsWith('evidence/'))
      .map((file) => sha256File(file)),
  };
}

function main() {
  const input = parseInput(process.argv.slice(2));
  const arms =
    input.tier === 'lineage' ? runLineageTier() : runRuntimeTier();
  const evidence = {
    schema: 'product-accepted-guard-evidence.v2',
    tier: input.tier,
    candidate_sha: input.candidateSha,
    ...hashes(),
    arms,
    ok: arms.every((arm) => arm.ok === true),
  };
  fs.mkdirSync(input.output, { recursive: true });
  fs.writeFileSync(
    path.join(
      input.output,
      `product-accepted-guard-evidence.${input.tier}.json`,
    ),
    `${JSON.stringify(evidence, null, 2)}\n`,
    'utf8',
  );
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
  return evidence.ok ? 0 : 1;
}

try {
  process.exitCode = main();
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
