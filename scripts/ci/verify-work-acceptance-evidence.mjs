#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const inputPath = path.resolve(option('--input'));
let inputBytes;
try {
  inputBytes = fs.readFileSync(inputPath);
} catch (error) {
  console.error(
    `work_acceptance_evidence_missing:path=${inputPath}:reason=${error.code ?? 'unreadable'}`,
  );
  process.exit(2);
}
let evidence;
try {
  evidence = JSON.parse(inputBytes.toString('utf8'));
} catch (error) {
  console.error(
    `work_acceptance_evidence_invalid:malformed_json:${error.message}`,
  );
  process.exit(1);
}
const expectedArms = [
  ['classifier-outcome-matrix', 0],
  ['canonical-http-database-missing', 2],
  ['canonical-http-zero-execution', 2],
  ['canonical-http-zero-execution-mcp-control', 0],
  ['canonical-mcp-zero-execution', 2],
  ['canonical-mcp-zero-execution-http-control', 0],
  ['canonical-mcp-database-missing', 2],
  ['classifier-success', 0],
  ['classifier-registered-marker-raw-three-fail', 1],
  ['classifier-registered-marker-signal-fail', 1],
  ['classifier-recognized-missing', 2],
  ['classifier-near-miss-fail', 1],
  ['verifier-input-missing', 2],
  ['classifier-unmarked-exit-two-fail', 1],
  ['classifier-raw-three-fail', 1],
  ['classifier-wrong-kind-marker-fail', 1],
  ['classifier-child-signal-fail', 1],
  ['classifier-spawn-unavailable-fail', 1],
  ['classifier-missing-kind-option', 2],
  ['classifier-missing-command', 2],
  ['classifier-unknown-kind', 2],
  ['baseline-http', 0],
  ['baseline-mcp', 0],
  ['baseline-product-subset', 0],
  ['baseline-eight-routes', 0],
  ['projection-installer-missing', 2],
  ['projection-installer-command-control', 0],
  ['foreign-leak-fail', 1],
  ['foreign-leak-mcp-control', 0],
  ['work-registration-missing', 2],
  ['work-registration-http-control', 0],
  ['wrong-work-id-fail', 1],
  ['wrong-work-id-http-control', 0],
  ['bootstrap-direct-work-independent-guard-bypassed', 0],
  ['bootstrap-direct-work-e5-fail', 1],
  ['bootstrap-direct-work-type-control', 0],
  ['bootstrap-direct-work-http-control', 0],
  ['bootstrap-direct-transfer-independent-guard-bypassed', 0],
  ['bootstrap-direct-transfer-e5-fail', 1],
  ['bootstrap-direct-transfer-type-control', 0],
  ['bootstrap-direct-transfer-http-control', 0],
  ['bootstrap-parser-api-missing-e5', 2],
  ['bootstrap-parser-api-missing-type-control', 0],
  ['bootstrap-parser-api-missing-http-control', 0],
  ['bootstrap-template-static-text-e5-control', 0],
  ['bootstrap-template-static-text-type-control', 0],
  ['bootstrap-template-static-text-http-control', 0],
  ['bootstrap-template-independent-guard-bypassed', 0],
  ['bootstrap-template-e5-fail', 1],
  ['bootstrap-template-type-control', 0],
  ['bootstrap-template-http-control', 0],
];
const failures = [];
assert(evidence.schema === 'mgr-b-work-e4-e5-runtime-v1', 'schema');
assert(/^[0-9a-f]{40}$/.test(evidence.candidate), 'candidate');
assert(/^[0-9a-f]{40}$/.test(evidence.parent), 'parent');
assert(evidence.ok === true, 'runtime_ok');
assert(
  JSON.stringify(evidence.status_before) === JSON.stringify([]),
  'status_before',
);
assert(
  JSON.stringify(evidence.status_after) ===
    JSON.stringify(evidence.status_before),
  'status_after',
);
assert(
  evidence.dependency_paths.node_modules.directory === true &&
    evidence.dependency_paths.node_modules.symlink === false &&
    evidence.dependency_paths.web_node_modules.directory === true &&
    evidence.dependency_paths.web_node_modules.symlink === false,
  'dependency_directories',
);
assert(
  JSON.stringify(evidence.input_hashes) ===
    JSON.stringify(evidence.restored_hashes),
  'restored_hashes',
);
assert(
  JSON.stringify(evidence.arms.map((arm) => [arm.name, arm.expected_exit])) ===
    JSON.stringify(expectedArms),
  'exact_arm_set',
);
assert(
  JSON.stringify(evidence.arms.map((arm) => [arm.name, arm.raw_exit])) ===
    JSON.stringify(expectedArms),
  'exact_raw_exit_map',
);
for (const arm of evidence.arms) {
  assert(arm.raw_exit === arm.expected_exit, `${arm.name}:exit`);
  assert(arm.ok === true, `${arm.name}:ok`);
  assert(
    Object.values(arm.marker_assertions).every((value) => value === true),
    `${arm.name}:markers`,
  );
}

const result = {
  schema: 'mgr-b-work-e4-e5-aggregate-v1',
  candidate: evidence.candidate,
  parent: evidence.parent,
  evidence_input_sha256: crypto
    .createHash('sha256')
    .update(inputBytes)
    .digest('hex'),
  assertions: {
    exact_arm_set: true,
    exact_raw_exit_map: true,
    restored_inputs: true,
    exact_status: true,
  },
  failures,
  all_assertions: failures.length === 0,
  ok: failures.length === 0,
};
console.log(JSON.stringify(result, null, 2));
process.exit(failures.length === 0 ? 0 : 1);

function assert(condition, marker) {
  if (!condition) failures.push(marker);
}
function option(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) {
    console.error(`missing_option:${name}`);
    process.exit(2);
  }
  return process.argv[index + 1];
}
