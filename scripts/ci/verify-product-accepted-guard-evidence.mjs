#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const sha1Pattern = /^[a-f0-9]{40}$/u;
const sha256Pattern = /^[a-f0-9]{64}$/u;
const evidenceName = (tier) => `product-accepted-guard-evidence.${tier}.json`;

function fail(code) {
  throw new Error(`guard_evidence_invalid:${code}`);
}

function optionValue(argv, names) {
  for (let index = 0; index < argv.length; index += 1) {
    if (!names.includes(argv[index])) continue;
    const value = argv[index + 1];
    if (!value || value.startsWith('--'))
      fail(`missing_option_value:${argv[index]}`);
    return value;
  }
  return undefined;
}

function resolveEvidence(value, tier) {
  if (!value) fail(`missing_${tier}_evidence`);
  const candidate = path.resolve(value);
  let stat;
  try {
    stat = fs.statSync(candidate);
  } catch {
    fail(`missing_${tier}_evidence:${candidate}`);
  }
  return stat.isDirectory()
    ? path.join(candidate, evidenceName(tier))
    : candidate;
}

function resolveTransportArtifact(value) {
  if (!value) fail('missing_transport_evidence');
  const candidate = path.resolve(value);
  try {
    if (!fs.statSync(candidate).isFile()) fail('transport_must_be_file');
  } catch {
    fail(`missing_transport_evidence:${candidate}`);
  }
  return candidate;
}

function readJson(filename, label) {
  try {
    return JSON.parse(fs.readFileSync(filename, 'utf8'));
  } catch {
    fail(`invalid_json:${label}`);
  }
}

function verifyTransportArtifact(filename) {
  const artifact = readJson(filename, 'transport');
  const recorder = isObject(artifact.recorder) ? artifact.recorder : artifact;
  const command = recorder.command ?? recorder.recorder_command;
  const exitCode =
    recorder.exit_code ?? recorder.exitCode ?? recorder.recorder_exit_code;
  const commandText = Array.isArray(command) ? command.join(' ') : command;
  if (
    typeof commandText !== 'string' ||
    !commandText.includes('run-product-accepted-guard-evidence.mjs') ||
    !commandText.includes('--tier runtime')
  )
    fail('transport.recorder_command');
  if (/(?:^|\s)(?:cat|printf|echo)(?:\s|$)/u.test(commandText))
    fail('transport.recorder_command_not_runner');
  if (exitCode !== 0) fail('transport.recorder_exit_code');
  if (
    (Object.hasOwn(recorder, 'signal') && recorder.signal !== null) ||
    (Object.hasOwn(recorder, 'spawn_error') && recorder.spawn_error !== null)
  )
    fail('transport.recorder_process_state');
  return { command: commandText, exit_code: exitCode };
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function equalJson(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    fail(`mismatch:${label}`);
}

function requireHash(value, label) {
  if (
    !isObject(value) ||
    typeof value.path !== 'string' ||
    !sha256Pattern.test(value.sha256)
  )
    fail(`invalid_hash:${label}`);
  return value;
}

function hashGroups(evidence, label) {
  const groups = new Map();
  const packageHash = requireHash(
    evidence.package_hash,
    `${label}.package_hash`,
  );
  if (packageHash.path !== 'package.json') fail(`${label}.package_path`);
  groups.set('package_hash', [packageHash]);
  for (const field of [
    'guard_hashes',
    'manifest_hashes',
    'evidence_hashes',
    'production_input_hashes',
  ]) {
    if (!Array.isArray(evidence[field]) || evidence[field].length === 0)
      fail(`invalid_hash_group:${label}.${field}`);
    const entries = evidence[field].map((entry, index) =>
      requireHash(entry, `${label}.${field}[${index}]`),
    );
    if (new Set(entries.map((entry) => entry.path)).size !== entries.length)
      fail(`duplicate_hash_path:${label}.${field}`);
    groups.set(field, entries);
  }
  return groups;
}

function flatHashes(groups) {
  return [...groups.values()].flat();
}

function gitBytes(candidate, filename) {
  try {
    return execFileSync('git', [
      '-C',
      repo,
      'show',
      `${candidate}:${filename}`,
    ]);
  } catch {
    fail(`candidate_blob_missing:${filename}`);
  }
}

function verifyCandidate(candidate) {
  if (!sha1Pattern.test(candidate)) fail('candidate_sha');
  let head;
  let status;
  try {
    head = execFileSync(
      'git',
      ['-C', repo, 'rev-parse', '--verify', 'HEAD^{commit}'],
      { encoding: 'utf8' },
    ).trim();
    status = execFileSync(
      'git',
      ['-C', repo, 'status', '--porcelain', '--untracked-files=all'],
      { encoding: 'utf8' },
    ).trim();
  } catch {
    fail('local_git_unavailable');
  }
  if (head !== candidate) fail('candidate_not_head');
  if (status) fail('worktree_not_clean');
}

function verifyBinding(evidence, tier, candidate) {
  if (!isObject(evidence.candidate_binding)) fail(`${tier}.candidate_binding`);
  if (tier === 'lineage') {
    equalJson(
      evidence.candidate_binding.kind,
      'git_head_verified',
      `${tier}.binding.kind`,
    );
    equalJson(
      evidence.candidate_binding.verified,
      true,
      `${tier}.binding.verified`,
    );
    equalJson(
      evidence.candidate_binding.head_sha,
      candidate,
      `${tier}.binding.head_sha`,
    );
    equalJson(
      evidence.candidate_binding.worktree_clean,
      true,
      `${tier}.binding.clean`,
    );
  } else {
    equalJson(
      evidence.candidate_binding.kind,
      'candidate_claim',
      `${tier}.binding.kind`,
    );
    equalJson(
      evidence.candidate_binding.verified,
      false,
      `${tier}.binding.verified`,
    );
  }
}

const COMMAND_MISSING = Object.freeze([
  'MISSING:create_work',
  'MISSING:get_work_definition',
  'MISSING:list_work_runs',
  'MISSING:list_works',
  'MISSING:start_work_run',
]);

const PROJECTION_MISSING = Object.freeze([
  'MISSING:get_run_trace',
  'MISSING:get_work',
  'MISSING:get_work_run',
]);

const ARM_REQUIREMENTS = Object.freeze({
  lineage: Object.freeze([
    { name: 'lineage-positive', expectedExitCode: 0 },
    { name: 'wiring-positive', expectedExitCode: 0 },
    {
      name: 'wiring-mutation-remove-check-backend-guard',
      expectedExitCode: 1,
      outputMarker:
        'guard_wiring_invalid:check_backend_guard_order_or_membership',
    },
    {
      name: 'wiring-mutation-conditional-accepted-guard',
      expectedExitCode: 1,
      outputMarker: 'guard_wiring_invalid:accepted_guard_conditional',
    },
    {
      name: 'wiring-mutation-leaf-product-routes-extra-command',
      expectedExitCode: 1,
      outputMarker:
        'guard_wiring_invalid:modularization_verify_product-routes_definition',
    },
  ]),
  runtime: Object.freeze([
    {
      name: 'runtime-positive-accepted-checker',
      expectedExitCode: 0,
    },
    { name: 'runtime-positive-product-routes', expectedExitCode: 0 },
    {
      name: 'runtime-mutation-corrupt-get-work-response',
      expectedExitCode: 1,
      outputMarker: 'FAIL:response_status:get_work',
    },
    {
      name: 'runtime-mutation-command-prepare',
      expectedExitCode: 0,
    },
    {
      name: 'runtime-mutation-command',
      expectedExitCode: 2,
      markers: COMMAND_MISSING,
    },
    {
      name: 'runtime-mutation-projection-prepare',
      expectedExitCode: 0,
    },
    {
      name: 'runtime-mutation-projection',
      expectedExitCode: 2,
      markers: PROJECTION_MISSING,
    },
    { name: 'runtime-positive-write-byte-equal', expectedExitCode: 0 },
    {
      name: 'runtime-mutation-write-before-gate',
      expectedExitCode: 1,
      outputMarker: 'evidence_mismatch:decision.decision',
    },
    {
      name: 'runtime-mutation-attestation-env-cannot-bypass-gate',
      expectedExitCode: 1,
      outputMarker: 'evidence_mismatch:decision.sha256',
    },
    {
      name: 'runtime-mutation-check-backend-remove-guard',
      expectedExitCode: 1,
      outputMarker:
        'guard_wiring_invalid:check_backend_guard_order_or_membership',
    },
    {
      name: 'runtime-mutation-check-backend-guard-or-true',
      expectedExitCode: 1,
      outputMarker: 'guard_wiring_invalid:accepted_guard_conditional',
    },
    { name: 'runtime-positive-check-backend', expectedExitCode: 0 },
    {
      name: 'runtime-mutation-check-backend-manifest-status',
      expectedExitCode: 1,
      outputMarker: 'accepted_subset_invalid:accepted_subset_mismatch',
    },
    { name: 'runtime-restored-check-backend', expectedExitCode: 0 },
  ]),
});

function verifyArm(arm, requirement, tier) {
  if (!isObject(arm)) fail(`${tier}.arm_not_object:${requirement.name}`);
  equalJson(arm.name, requirement.name, `${tier}.${requirement.name}.name`);
  equalJson(
    arm.expected_exit_code,
    requirement.expectedExitCode,
    `${tier}.${requirement.name}.expected_exit_code`,
  );
  equalJson(
    arm.exit_code,
    requirement.expectedExitCode,
    `${tier}.${requirement.name}.exit_code`,
  );
  equalJson(arm.signal, null, `${tier}.${requirement.name}.signal`);
  equalJson(arm.spawn_error, null, `${tier}.${requirement.name}.spawn_error`);
  if (
    typeof arm.classification !== 'string' ||
    arm.classification === 'MISSING'
  )
    fail(`${tier}.${requirement.name}.classification_missing`);
  equalJson(arm.ok, true, `${tier}.${requirement.name}.ok`);

  if (requirement.markers) {
    equalJson(
      arm.expected_markers,
      requirement.markers,
      `${tier}.${requirement.name}.expected_markers`,
    );
    equalJson(
      arm.observed_markers,
      requirement.markers,
      `${tier}.${requirement.name}.observed_markers`,
    );
    equalJson(
      arm.marker_stream,
      'stderr',
      `${tier}.${requirement.name}.marker_stream`,
    );
    equalJson(arm.markers_ok, true, `${tier}.${requirement.name}.markers_ok`);
  }

  if (requirement.outputMarker) {
    const expected = [requirement.outputMarker];
    equalJson(
      arm.expected_output_markers,
      expected,
      `${tier}.${requirement.name}.expected_output_markers`,
    );
    equalJson(
      arm.output_markers_ok,
      true,
      `${tier}.${requirement.name}.output_markers_ok`,
    );
    if (
      typeof arm.stdout !== 'string' ||
      typeof arm.stderr !== 'string' ||
      !`${arm.stdout}\n${arm.stderr}`.includes(requirement.outputMarker)
    )
      fail(`${tier}.${requirement.name}.output_marker`);
  }
}

function verifyArms(evidence, tier) {
  if (evidence.ok !== true) fail(`${tier}.not_ok`);
  if (!Array.isArray(evidence.arms)) fail(`${tier}.arms`);
  const requirements = ARM_REQUIREMENTS[tier];
  if (evidence.arms.length !== requirements.length) fail(`${tier}.arms_count`);
  const names = evidence.arms.map((arm) => arm?.name);
  if (
    names.some((name) => typeof name !== 'string') ||
    new Set(names).size !== names.length ||
    requirements.some((requirement) => !names.includes(requirement.name))
  )
    fail(`${tier}.arms_names`);
  for (const requirement of requirements) {
    const arm = evidence.arms.find((entry) => entry?.name === requirement.name);
    verifyArm(arm, requirement, tier);
  }
}

function verifyGitHashes(groups, candidate, label) {
  for (const entry of flatHashes(groups)) {
    const digest = crypto
      .createHash('sha256')
      .update(gitBytes(candidate, entry.path))
      .digest('hex');
    if (digest !== entry.sha256)
      fail(`candidate_hash_mismatch:${label}:${entry.path}`);
  }
}

function verifyEqualGroups(left, right) {
  if (left.size !== right.size) fail('hash_group_set_mismatch');
  for (const field of left.keys()) {
    const leftEntries = left.get(field);
    const rightEntries = right.get(field);
    if (!rightEntries) fail(`missing_runtime_hash_group:${field}`);
    equalJson(leftEntries, rightEntries, `hashes.${field}`);
  }
}

function main() {
  const argv = process.argv.slice(2);
  const lineagePath = resolveEvidence(
    optionValue(argv, ['--lineage', '--lineage-evidence']) ??
      process.env.PRODUCT_ACCEPTED_GUARD_LINEAGE_EVIDENCE_PATH,
    'lineage',
  );
  const runtimePath = resolveEvidence(
    optionValue(argv, ['--runtime', '--runtime-evidence']) ??
      process.env.PRODUCT_ACCEPTED_GUARD_RUNTIME_EVIDENCE_PATH,
    'runtime',
  );
  const transportPath = resolveTransportArtifact(
    optionValue(argv, ['--transport-artifact', '--transport']) ??
      process.env.PRODUCT_ACCEPTED_GUARD_RUNTIME_TRANSPORT_ARTIFACT_PATH,
  );
  const lineage = readJson(lineagePath, 'lineage');
  const runtime = readJson(runtimePath, 'runtime');
  if (!isObject(lineage) || !isObject(runtime)) fail('evidence_not_object');
  equalJson(
    lineage.schema,
    'product-accepted-guard-evidence.v2',
    'lineage.schema',
  );
  equalJson(
    runtime.schema,
    'product-accepted-guard-evidence.v2',
    'runtime.schema',
  );
  equalJson(lineage.tier, 'lineage', 'lineage.tier');
  equalJson(runtime.tier, 'runtime', 'runtime.tier');
  if (
    !sha1Pattern.test(lineage.candidate_sha) ||
    lineage.candidate_sha !== runtime.candidate_sha
  )
    fail('candidate_sha_mismatch');
  const claimedCandidate = optionValue(argv, ['--candidate-sha']);
  if (claimedCandidate && claimedCandidate !== lineage.candidate_sha)
    fail('candidate_sha_argument_mismatch');
  verifyCandidate(lineage.candidate_sha);
  verifyBinding(lineage, 'lineage', lineage.candidate_sha);
  verifyBinding(runtime, 'runtime', lineage.candidate_sha);
  verifyArms(lineage, 'lineage');
  if (
    !isObject(runtime.runtime_options) ||
    runtime.runtime_options.run_check_backend !== true
  )
    fail('runtime.runtime_options.run_check_backend');
  verifyArms(runtime, 'runtime');
  const lineageGroups = hashGroups(lineage, 'lineage');
  const runtimeGroups = hashGroups(runtime, 'runtime');
  verifyEqualGroups(lineageGroups, runtimeGroups);
  verifyGitHashes(lineageGroups, lineage.candidate_sha, 'lineage');
  const transport = verifyTransportArtifact(transportPath);
  process.stdout.write(
    `${JSON.stringify({
      schema: 'product-accepted-guard-evidence-aggregate.v1',
      ok: true,
      candidate_sha: lineage.candidate_sha,
      lineage_evidence: lineagePath,
      runtime_evidence: runtimePath,
      transport_artifact: transportPath,
      recorder: transport,
    })}\n`,
  );
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
