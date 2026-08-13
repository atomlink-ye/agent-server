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
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
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
  expectedOutputMarkers,
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
  const output = `${stdout}\n${stderr}`;
  const outputMarkersOk = expectedOutputMarkers
    ? expectedOutputMarkers.every((marker) => output.includes(marker))
    : true;
  return {
    name,
    expected_exit_code: expectedExitCode,
    exit_code: missing ? null : (result.status ?? null),
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
    ...(expectedOutputMarkers
      ? {
          expected_output_markers: expectedOutputMarkers,
          output_markers_ok: outputMarkersOk,
        }
      : {}),
    ok:
      !missing &&
      result.status === expectedExitCode &&
      markersOk &&
      outputMarkersOk,
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
    fs.copyFileSync(path.join(repo, file), path.join(directory, file));
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

function runWiringMutation(name, mutate, expectedOutputMarker) {
  const copy = writePackageMutation(mutate);
  const arm = runArm({
    name,
    command: process.execPath,
    args: [wiringChecker, '--package', copy.filename],
    cwd: repo,
    expectedExitCode: 1,
    expectedOutputMarkers: [expectedOutputMarker],
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
      'guard_wiring_invalid:check_backend_guard_order_or_membership',
    ),
  );
  arms.push(
    runWiringMutation(
      'wiring-mutation-conditional-accepted-guard',
      (scripts) => {
        scripts['guard:product-accepted-subset'] =
          `${scripts['guard:product-accepted-subset']} || true`;
      },
      'guard_wiring_invalid:accepted_guard_conditional',
    ),
  );
  arms.push(
    runWiringMutation(
      'wiring-mutation-leaf-product-routes-extra-command',
      (scripts) => {
        scripts['modularization:verify:product-routes'] =
          `${scripts['modularization:verify:product-routes']} && true`;
      },
      'guard_wiring_invalid:modularization_verify_product-routes_definition',
    ),
  );
  return arms;
}

function withFileMutation(filename, mutate, run) {
  const original = fs.readFileSync(filename);
  fs.writeFileSync(filename, mutate(original));
  try {
    return run();
  } finally {
    fs.writeFileSync(filename, original);
  }
}

function runGateMutationArm(name, command, args, envOverrides, marker) {
  const gate = path.join(
    repo,
    'evidence/product-contract/human-gate-decision.json',
  );
  return withFileMutation(
    gate,
    () => Buffer.from('{}\n'),
    () =>
      runArm({
        name,
        command,
        args,
        cwd: repo,
        envOverrides,
        expectedExitCode: 1,
        expectedOutputMarkers: [marker],
      }),
  );
}

function runWriteBeforeGateArm() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-write-gate-'));
  const output = path.join(directory, 'generated.json');
  const arm = runGateMutationArm(
    'runtime-mutation-write-before-gate',
    process.execPath,
    ['--import', 'tsx', checker, '--write', '--output', output],
    {},
    'evidence_mismatch:decision.decision',
  );
  arm.output_path = output;
  arm.output_absent = !fs.existsSync(output);
  arm.ok = arm.ok && arm.output_absent;
  fs.rmSync(directory, { recursive: true, force: true });
  return arm;
}

function runEndpointDeletionManifestArm() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'guard-manifest-endpoint-'),
  );
  const signedPath = path.join(
    repo,
    'src/contracts/product-accepted-subset.v1.json',
  );
  const mutatedPath = path.join(directory, 'product-accepted-subset.v1.json');
  const signedBytes = fs.readFileSync(signedPath);
  const signed = JSON.parse(signedBytes.toString('utf8'));
  const targetEndpointId = 'get_work';
  const originalIds = signed.endpoints.map((endpoint) => endpoint.id);
  const targetIndex = originalIds.indexOf(targetEndpointId);
  if (
    targetIndex < 0 ||
    targetIndex !== originalIds.lastIndexOf(targetEndpointId)
  )
    throw new Error('endpoint_deletion_target_not_unique');
  const mutated = structuredClone(signed);
  mutated.endpoints.splice(targetIndex, 1);
  const mutatedBytes = Buffer.from(`${JSON.stringify(mutated, null, 2)}\n`);
  fs.writeFileSync(mutatedPath, mutatedBytes);
  const remainingIds = mutated.endpoints.map((endpoint) => endpoint.id);
  const nonTargetInvariant =
    JSON.stringify(remainingIds) ===
      JSON.stringify(originalIds.filter((id) => id !== targetEndpointId)) &&
    mutated.status === signed.status &&
    mutated.api_major === signed.api_major &&
    mutated.accepted_revision === signed.accepted_revision;
  const arm = runArm({
    name: 'runtime-mutation-temp-manifest-delete-get-work',
    command: process.execPath,
    args: [
      '--import',
      'tsx',
      checker,
      '--check',
      '--mutation',
      '--manifest',
      mutatedPath,
    ],
    cwd: repo,
    expectedExitCode: 1,
    expectedOutputMarkers: [
      'accepted_subset_invalid:evidence_mismatch:manifest.current_raw_sha256',
    ],
  });
  arm.target_endpoint_id = targetEndpointId;
  arm.target_index = targetIndex;
  arm.original_endpoint_ids = originalIds;
  arm.mutated_endpoint_ids = remainingIds;
  arm.signed_manifest_sha256 = crypto
    .createHash('sha256')
    .update(signedBytes)
    .digest('hex');
  arm.mutated_manifest_sha256 = crypto
    .createHash('sha256')
    .update(mutatedBytes)
    .digest('hex');
  arm.non_target_invariant = nonTargetInvariant;
  arm.signed_manifest_unchanged = fs
    .readFileSync(signedPath)
    .equals(signedBytes);
  arm.ok = arm.ok && nonTargetInvariant && arm.signed_manifest_unchanged;
  fs.rmSync(directory, { recursive: true, force: true });
  return arm;
}

function runBackendPackageMutation(name, mutate, marker) {
  const filename = path.join(repo, 'package.json');
  return withFileMutation(
    filename,
    (original) => {
      const pkg = JSON.parse(original.toString('utf8'));
      mutate(pkg.scripts);
      return Buffer.from(`${JSON.stringify(pkg, null, 2)}\n`);
    },
    () => runCheckBackendArm(name, 1, {}, marker),
  );
}

function runCheckBackendArm(
  name,
  expectedExitCode,
  envOverrides = {},
  expectedOutputMarker,
) {
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
    ...(expectedOutputMarker
      ? { expectedOutputMarkers: [expectedOutputMarker] }
      : {}),
  });
}

function runManifestStatusMutation(candidateSha) {
  const filename = path.join(
    repo,
    'src/contracts/product-accepted-subset.v1.json',
  );
  const original = fs.readFileSync(filename);
  const originalText = original.toString('utf8');
  const acceptedStatus = '"status": "accepted"';
  const provisionalStatus = '"status": "provisional"';
  const first = originalText.indexOf(acceptedStatus);
  if (first < 0 || first !== originalText.lastIndexOf(acceptedStatus))
    throw new Error('manifest_status_target_not_unique');
  const mutatedText =
    originalText.slice(0, first) +
    provisionalStatus +
    originalText.slice(first + acceptedStatus.length);
  fs.writeFileSync(filename, Buffer.from(mutatedText, 'utf8'));
  try {
    return runCheckBackendArm(
      'runtime-mutation-check-backend-manifest-status',
      1,
      { PRODUCT_ACCEPTED_GUARD_CANDIDATE_SHA: candidateSha },
      'accepted_subset_invalid:evidence_mismatch:manifest.current_raw_sha256',
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
      expectedOutputMarkers: ['FAIL:response_status:get_work'],
    }),
  );
  fs.rmSync(behaviorCopy, { recursive: true, force: true });
  arms.push(...runRegistrarMutation('command'));
  arms.push(...runRegistrarMutation('projection'));
  const writeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-write-'));
  const writeOutput = path.join(writeDirectory, 'generated.json');
  const writeArm = runArm({
    name: 'runtime-positive-write-byte-equal',
    command: process.execPath,
    args: ['--import', 'tsx', checker, '--write', '--output', writeOutput],
    cwd: repo,
    expectedExitCode: 0,
  });
  writeArm.byte_equal =
    writeArm.ok &&
    fs.existsSync(writeOutput) &&
    fs
      .readFileSync(writeOutput)
      .equals(
        fs.readFileSync(
          path.join(repo, 'src/contracts/product-accepted-subset.v1.json'),
        ),
      );
  writeArm.ok = writeArm.ok && writeArm.byte_equal;
  arms.push(writeArm);
  fs.rmSync(writeDirectory, { recursive: true, force: true });
  arms.push(runWriteBeforeGateArm());
  arms.push(runEndpointDeletionManifestArm());
  arms.push(
    runGateMutationArm(
      'runtime-mutation-attestation-env-cannot-bypass-gate',
      'pnpm',
      ['check:backend'],
      {
        PRODUCT_ACCEPTED_LINEAGE_ATTESTATION_PATH:
          process.env.PRODUCT_ACCEPTED_LINEAGE_ATTESTATION_PATH ?? input.output,
        PRODUCT_ACCEPTED_GUARD_CANDIDATE_SHA: input.candidateSha,
      },
      'evidence_mismatch:decision.sha256',
    ),
  );
  arms.push(
    runBackendPackageMutation(
      'runtime-mutation-check-backend-remove-guard',
      (scripts) => {
        scripts['check:backend'] = scripts['check:backend']
          .split(' && ')
          .filter((part) => part !== 'pnpm guard:product-accepted-subset')
          .join(' && ');
      },
      'guard_wiring_invalid:check_backend_guard_order_or_membership',
    ),
  );
  arms.push(
    runBackendPackageMutation(
      'runtime-mutation-check-backend-guard-or-true',
      (scripts) => {
        scripts['guard:product-accepted-subset'] += ' || true';
      },
      'guard_wiring_invalid:accepted_guard_conditional',
    ),
  );
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
