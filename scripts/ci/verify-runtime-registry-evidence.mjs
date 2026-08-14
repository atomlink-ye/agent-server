#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const input = option('--input');
if (!input || !readable(input))
  missing(`input_unreadable:${input ?? 'absent'}`);
let evidence;
try {
  evidence = JSON.parse(fs.readFileSync(input, 'utf8'));
} catch {
  fail('input_invalid_json');
}
const candidate = git(['rev-parse', 'HEAD']);
const parent = git(['rev-parse', 'HEAD^']);
const expectedExits = {
  'classifier-outcome-matrix': 0,
  'baseline-runtime-tools': 0,
  'canonical-database-missing': 2,
  'canonical-database-unreachable': 2,
  'baseline-change-budget': 0,
  'verifier-input-missing': 2,
  'canonical-zero-execution': 2,
  'zero-execution-change-budget-control': 0,
  'remove-work-registration': 2,
  'remove-work-registration-type-control': 0,
  'remove-work-registration-budget-control': 0,
  'remove-memory-registration': 2,
  'remove-memory-registration-type-control': 0,
  'remove-memory-registration-budget-control': 0,
  'memory-handler-wrongness': 1,
  'memory-handler-wrongness-type-control': 0,
  'memory-handler-wrongness-budget-control': 0,
  'constructor-capability-reinjection': 1,
  'constructor-capability-reinjection-type-control': 0,
  'constructor-capability-reinjection-budget-control': 0,
  'host-template-static-text-control': 0,
  'host-template-static-text-type-control': 0,
  'host-template-interpolation': 1,
  'host-template-interpolation-type-control': 0,
  'host-template-interpolation-budget-control': 0,
  'typescript-api-unavailable': 2,
  'typescript-api-unavailable-budget-control': 0,
  'classifier-success': 0,
  'classifier-recognized-missing': 2,
  'classifier-near-miss-fail': 1,
  'classifier-unmarked-exit-two-fail': 1,
  'classifier-marker-raw-three-fail': 1,
  'classifier-marker-signal-fail': 1,
  'classifier-spawn-unavailable-fail': 1,
  'change-budget-migration-red': 1,
  'change-budget-migration-runtime-control': 0,
  'change-budget-dependency-red': 1,
  'change-budget-dependency-runtime-control': 0,
  'change-budget-exports-red': 1,
  'change-budget-exports-runtime-control': 0,
  'change-budget-current-baseline-missing': 2,
  'change-budget-current-baseline-runtime-control': 0,
};
const arms = Object.fromEntries(evidence.arms.map((arm) => [arm.name, arm]));
const assertions = {
  schema: evidence.schema_version === 1,
  candidate: evidence.candidate === candidate,
  parent: evidence.parent === parent,
  exact_arm_set:
    JSON.stringify(Object.keys(arms).sort()) ===
    JSON.stringify(Object.keys(expectedExits).sort()),
  exact_arm_exits: Object.entries(expectedExits).every(
    ([name, exit]) => arms[name]?.raw_exit === exit && arms[name]?.ok === true,
  ),
  work_missing_non_target:
    arms['remove-work-registration']?.marker_assertions?.[
      'non_target_memory_ok=true'
    ] === true,
  memory_missing_non_target:
    arms['remove-memory-registration']?.marker_assertions?.[
      'non_target_work_ok=true'
    ] === true,
  handler_wrongness_fail: arms['memory-handler-wrongness']?.raw_exit === 1,
  constructor_reinjection_fail:
    arms['constructor-capability-reinjection']?.raw_exit === 1,
  template_static_green:
    arms['host-template-static-text-control']?.raw_exit === 0,
  template_interpolation_red:
    arms['host-template-interpolation']?.raw_exit === 1,
  api_unavailable_missing: arms['typescript-api-unavailable']?.raw_exit === 2,
  e7_bidirectional_nonempty: ['migrations', 'dependencies', 'exports'].every(
    (target) => arms['baseline-change-budget']?.stdout.includes(`"${target}"`),
  ),
  all_mutations_restored: evidence.mutations.every(
    (mutation) => mutation.restored === true,
  ),
  hashes_restored:
    JSON.stringify(evidence.input_hashes) ===
    JSON.stringify(evidence.restored_hashes),
  local_input_hashes: Object.entries(evidence.input_hashes).every(
    ([file, hash]) => sha(file) === hash,
  ),
  status_exact_clean:
    evidence.status_before.length === 0 && evidence.status_after.length === 0,
  dependency_real_directories: ['node_modules', 'apps/web/node_modules'].every(
    (target) =>
      evidence.dependency_paths[target]?.directory === true &&
      evidence.dependency_paths[target]?.symlink === false,
  ),
  query_helper_moves_zero: evidence.query_helper_moves === 0,
  no_follow_on: evidence.registry_follow_on_started === false,
  zero_rule_audit_bound:
    evidence.zero_rule_audit?.e6_expected_min_count === 1 &&
    evidence.zero_rule_audit?.e6_proposition_valid_under_corrected_rule ===
      true &&
    evidence.zero_rule_audit?.e6_business_collection_nonempty_rule === false &&
    evidence.zero_rule_audit?.fixture_added_for_audit === false &&
    evidence.zero_rule_audit?.runner_database_input?.includes(
      'refreshed before each canonical arm',
    ) === true &&
    evidence.zero_rule_audit?.runner_pnpm_dependency_check?.includes(
      'PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false',
    ) === true,
  recorder_ok: evidence.ok === true,
};
const ok = Object.values(assertions).every(Boolean);
console.log(
  JSON.stringify(
    {
      guard: 'runtime-registry-evidence',
      candidate,
      parent,
      input: fs.realpathSync(input),
      input_sha256: digest(fs.readFileSync(input)),
      expected_arm_exits: expectedExits,
      assertions,
      all_assertions: ok,
      ok,
    },
    null,
    2,
  ),
);
process.exit(ok ? 0 : 1);

function readable(target) {
  try {
    fs.accessSync(target, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}
function sha(file) {
  return digest(fs.readFileSync(file));
}
function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
function git(argv) {
  const result = spawnSync('git', argv, { encoding: 'utf8' });
  if (result.status !== 0) missing(`git_unavailable:${argv.join(':')}`);
  return result.stdout.trimEnd();
}
function option(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}
function missing(message) {
  console.error(`runtime_registry_evidence_missing:${message}`);
  process.exit(2);
}
function fail(message) {
  console.error(`runtime_registry_evidence_invalid:${message}`);
  process.exit(1);
}
