#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const inputPath = path.resolve(option('--input'));
const evidence = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const expectedArms = [
  ['baseline-http', 0],
  ['baseline-mcp', 0],
  ['baseline-product-subset', 0],
  ['baseline-eight-routes', 0],
  ['projection-installer-missing', 1],
  ['projection-installer-command-control', 0],
  ['foreign-leak-fail', 1],
  ['foreign-leak-mcp-control', 0],
  ['work-registration-missing', 1],
  ['work-registration-http-control', 0],
  ['wrong-work-id-fail', 1],
  ['wrong-work-id-http-control', 0],
  ['bootstrap-direct-work-fail', 1],
  ['bootstrap-direct-work-type-control', 0],
  ['bootstrap-direct-work-http-control', 0],
  ['bootstrap-direct-work-mcp-control', 0],
];
const failures = [];
assert(evidence.schema === 'mgr-b-work-e4-e5-runtime-v1', 'schema');
assert(/^[0-9a-f]{40}$/.test(evidence.candidate), 'candidate');
assert(/^[0-9a-f]{40}$/.test(evidence.parent), 'parent');
assert(evidence.ok === true, 'runtime_ok');
assert(
  JSON.stringify(evidence.status_before) ===
    JSON.stringify([' D apps/web/node_modules', ' D node_modules']),
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
    .update(fs.readFileSync(inputPath))
    .digest('hex'),
  assertions: {
    exact_arm_set: true,
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
