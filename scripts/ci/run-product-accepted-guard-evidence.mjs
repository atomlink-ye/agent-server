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
const aggregateVerifier =
  'scripts/ci/verify-product-accepted-guard-evidence.mjs';
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
  aggregateVerifier,
  'src/contracts/product-accepted-subset.v1.json',
  'evidence/product-contract/human-gate-decision.json',
  'evidence/product-contract/human-gate-product-contract-accepted.json',
  'evidence/product-contract/mgr-b-human-gate-format-continuation.json',
];
const productionInputFiles = [
  'src/entrypoints/api/app.ts',
  'src/entrypoints/api/routes/product-work-commands.ts',
  'src/entrypoints/api/routes/product-work.ts',
  'src/contracts/product-work-commands.ts',
  'src/contracts/product-projection/index.ts',
  'src/contracts/http.ts',
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
  const runCheckBackend = argv.includes('--run-check-backend');
  if (tier === 'lineage' && runCheckBackend)
    throw new Error('run_check_backend_runtime_only');
  if (
    argv.some(
      (argument) =>
        argument.startsWith('--') &&
        ![
          '--tier',
          '--output',
          '--output-dir',
          '--candidate-sha',
          '--run-check-backend',
        ].includes(argument),
    )
  )
    throw new Error('unknown_option');
  return {
    tier,
    output: path.resolve(output),
    candidateSha,
    runCheckBackend,
  };
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function gitText(args) {
  const result = spawnSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0 || result.signal || result.error)
    throw new Error(`git:${args.join(' ')}`);
  return result.stdout.trim();
}

function verifyLineageCandidate(output, candidateSha) {
  if (isWithin(repo, output))
    throw new Error('lineage_output_must_be_outside_repo');
  if (gitText(['rev-parse', '--verify', 'HEAD^{commit}']) !== candidateSha)
    throw new Error('lineage_candidate_must_equal_head');
  if (gitText(['status', '--porcelain', '--untracked-files=all']))
    throw new Error('lineage_worktree_must_be_clean');
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
  let result;
  try {
    result = spawnSync(command, args, {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, ...envOverrides },
    });
  } catch (error) {
    result = {
      status: null,
      signal: null,
      stdout: '',
      stderr: '',
      error,
    };
  }
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const signal = result.signal ?? null;
  const spawnError = result.error
    ? result.error instanceof Error
      ? result.error.message
      : String(result.error)
    : null;
  const missing = signal !== null || spawnError !== null;
  const markerLines = stderr
    .split(/\r?\n/u)
    .filter((line) => line.startsWith('MISSING:'));
  const markersOk = expectedMarkers
    ? JSON.stringify(markerLines) === JSON.stringify(expectedMarkers)
    : true;
  return {
    name,
    expected_exit_code: expectedExitCode,
    exit_code: missing ? null : result.status ?? null,
    signal,
    argv: [command, ...args],
    cwd,
    env_overrides: envOverrides,
    stdout,
    stderr,
    spawn_error: spawnError,
    classification: missing ? 'MISSING' : 'OBSERVED',
    ...(expectedMarkers
      ? {
          expected_markers: expectedMarkers,
          observed_markers: markerLines,
          marker_stream: 'stderr',
          markers_ok: markersOk,
        }
      : {}),
    ok:
      !missing &&
      result.status === expectedExitCode &&
      markersOk,
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
    classification: 'MISSING',
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
  arms.push(
    runWiringMutation('wiring-mutation-leaf-product-routes-extra-command', (scripts) => {
      scripts['modularization:verify:product-routes'] =
        `${scripts['modularization:verify:product-routes']} && true`;
    }),
  );
  return arms;
}

function runCheckBackendArm(name, expectedExitCode, envOverrides = {}) {
  const childEnv = { ...envOverrides };
  if (process.env.PRODUCT_ACCEPTED_LINEAGE_ATTESTATION_PATH)
    childEnv.PRODUCT_ACCEPTED_LINEAGE_ATTESTATION_PATH =
      process.env.PRODUCT_ACCEPTED_LINEAGE_ATTESTATION_PATH;
  childEnv.PRODUCT_ACCEPTED_GUARD_CANDIDATE_SHA =
    childEnv.PRODUCT_ACCEPTED_GUARD_CANDIDATE_SHA ??
    process.env.PRODUCT_ACCEPTED_GUARD_CANDIDATE_SHA;
  return runArm({
    name,
    command: 'pnpm',
    args: ['check:backend'],
    cwd: repo,
    envOverrides: childEnv,
    expectedExitCode,
  });
}

function runManifestStatusMutation(candidateSha) {
  const filename = path.join(repo, 'src/contracts/product-accepted-subset.v1.json');
  const original = fs.readFileSync(filename);
  const manifest = JSON.parse(original.toString('utf8'));
  manifest.status = 'mutated_for_guard_evidence';
  fs.writeFileSync(filename, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  try {
    return runCheckBackendArm(
      'runtime-mutation-check-backend-manifest-status',
      1,
      { PRODUCT_ACCEPTED_GUARD_CANDIDATE_SHA: candidateSha },
    );
  } finally {
    fs.writeFileSync(filename, original);
  }
}

function runRuntimeTier(input) {
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
  if (input.runCheckBackend) {
    arms.push(
      runCheckBackendArm('runtime-positive-check-backend', 0, {
        PRODUCT_ACCEPTED_GUARD_CANDIDATE_SHA: input.candidateSha,
      }),
    );
    arms.push(runManifestStatusMutation(input.candidateSha));
    arms.push(
      runCheckBackendArm('runtime-restored-check-backend', 0, {
        PRODUCT_ACCEPTED_GUARD_CANDIDATE_SHA: input.candidateSha,
      }),
    );
  }
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
    production_input_hashes: productionInputFiles.map((file) =>
      sha256File(file),
    ),
  };
}

function main() {
  const input = parseInput(process.argv.slice(2));
  if (input.tier === 'lineage')
    verifyLineageCandidate(input.output, input.candidateSha);
  const arms =
    input.tier === 'lineage' ? runLineageTier() : runRuntimeTier(input);
  const evidence = {
    schema: 'product-accepted-guard-evidence.v2',
    tier: input.tier,
    candidate_sha: input.candidateSha,
    candidate_binding:
      input.tier === 'lineage'
        ? {
            kind: 'git_head_verified',
            verified: true,
            head_sha: input.candidateSha,
            worktree_clean: true,
          }
        : {
            kind: 'candidate_claim',
            verified: false,
          },
    runtime_options: {
      run_check_backend: input.runCheckBackend,
    },
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
