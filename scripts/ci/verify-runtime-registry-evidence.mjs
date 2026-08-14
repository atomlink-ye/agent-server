#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

if (process.argv.includes('--self-test-window-equality')) {
  const arm = {
    mutation_window_id: 'self-test',
    active_mutations: ['self-test'],
    mutation_applied_at: 1,
    control_started_at: 1,
    control_completed_at: 2,
    restore_started_at: 3,
    restore_completed_at: 4,
  };
  const rejected = !mutationWindow(arm, 'self-test');
  console.log(`mutation_window_equality_rejected=${rejected}`);
  process.exit(rejected ? 0 : 1);
}

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
  'verifier-window-equality-self-red': 1,
  'verifier-window-equality-runtime-control': 0,
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
const focusedIdentity =
  'calls Work and Memory through the composed runtime tool registry';
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
  verifier_equality_mutation_red_control_green:
    arms['verifier-window-equality-self-red']?.raw_exit === 1 &&
    mutationWindow(
      arms['verifier-window-equality-self-red'],
      'verifier-window-nonstrict-equality',
    ) &&
    arms['verifier-window-equality-self-red']?.marker_assertions?.[
      'mutation_window_equality_rejected=false'
    ] === true &&
    mutationWindow(
      arms['verifier-window-equality-runtime-control'],
      'verifier-window-nonstrict-equality',
    ) &&
    executionGreen(arms['verifier-window-equality-runtime-control']) &&
    workCallGreen(arms['verifier-window-equality-runtime-control']) &&
    memoryCallGreen(arms['verifier-window-equality-runtime-control']),
  work_missing_target_red_memory_green:
    arms['remove-work-registration']?.raw_exit === 2 &&
    mutationWindow(
      arms['remove-work-registration'],
      'remove-work-registration',
    ) &&
    targetExecutionRan(arms['remove-work-registration']) &&
    arms['remove-work-registration']?.marker_assertions?.[
      'RUNTIME_TOOLS_MISSING[runtime_work_registration_missing]'
    ] === true &&
    memoryCallGreen(arms['remove-work-registration']),
  memory_missing_target_red_work_green:
    arms['remove-memory-registration']?.raw_exit === 2 &&
    mutationWindow(
      arms['remove-memory-registration'],
      'remove-memory-registration',
    ) &&
    targetExecutionRan(arms['remove-memory-registration']) &&
    arms['remove-memory-registration']?.marker_assertions?.[
      'RUNTIME_TOOLS_MISSING[runtime_memory_registration_missing]'
    ] === true &&
    workCallGreen(arms['remove-memory-registration']),
  handler_wrongness_target_red_work_green:
    arms['memory-handler-wrongness']?.raw_exit === 1 &&
    mutationWindow(
      arms['memory-handler-wrongness'],
      'memory-handler-wrongness',
    ) &&
    workCallGreen(arms['memory-handler-wrongness']) &&
    arms['memory-handler-wrongness']?.marker_assertions?.[
      'runtime-registry-e6-wrong'
    ] === true &&
    arms['memory-handler-wrongness']?.marker_assertions?.[
      '"guard":"runtime-tools-non-target-control","control_identity":"product_work_create","work_present":true,"product_work_create_ok":true'
    ] === true,
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
  e7_target_red_runtime_green: [
    ['migration', 'migrations'],
    ['dependency', 'dependencies'],
    ['exports', 'exports'],
  ].every(
    ([arm, target]) =>
      arms[`change-budget-${arm}-red`]?.raw_exit === 1 &&
      mutationWindow(arms[`change-budget-${arm}-red`], `${arm}-change`) &&
      arms[`change-budget-${arm}-red`]?.marker_assertions?.[
        `registry_change_budget_violation:target=${target}`
      ] === true &&
      arms[`change-budget-${arm}-runtime-control`]?.raw_exit === 0 &&
      mutationWindow(
        arms[`change-budget-${arm}-runtime-control`],
        `${arm}-change`,
      ) &&
      executionGreen(arms[`change-budget-${arm}-runtime-control`]) &&
      workCallGreen(arms[`change-budget-${arm}-runtime-control`]) &&
      arms[`change-budget-${arm}-runtime-control`]?.marker_assertions?.[
        '"guard":"runtime-tools-non-target-control","control_identity":"product_work_create","work_present":true,"product_work_create_ok":true'
      ] === true,
  ),
  e7_current_baseline_missing_runtime_green:
    arms['change-budget-current-baseline-missing']?.raw_exit === 2 &&
    mutationWindow(
      arms['change-budget-current-baseline-missing'],
      'baseline-current-tree',
    ) &&
    arms['change-budget-current-baseline-missing']?.marker_assertions?.[
      'registry_change_budget_missing:baseline_equals_candidate'
    ] === true &&
    arms['change-budget-current-baseline-runtime-control']?.raw_exit === 0 &&
    mutationWindow(
      arms['change-budget-current-baseline-runtime-control'],
      'baseline-current-tree',
    ) &&
    executionGreen(arms['change-budget-current-baseline-runtime-control']) &&
    workCallGreen(arms['change-budget-current-baseline-runtime-control']) &&
    arms['change-budget-current-baseline-runtime-control']?.marker_assertions?.[
      '"guard":"runtime-tools-non-target-control","control_identity":"product_work_create","work_present":true,"product_work_create_ok":true'
    ] === true,
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

function mutationWindow(arm, mutationName) {
  return (
    arm?.mutation_window_id === mutationName &&
    JSON.stringify(arm.active_mutations) === JSON.stringify([mutationName]) &&
    Number.isInteger(arm.mutation_applied_at) &&
    Number.isInteger(arm.control_started_at) &&
    Number.isInteger(arm.control_completed_at) &&
    Number.isInteger(arm.restore_started_at) &&
    Number.isInteger(arm.restore_completed_at) &&
    arm.mutation_applied_at < arm.control_started_at &&
    arm.control_started_at <= arm.control_completed_at &&
    arm.control_completed_at < arm.restore_started_at &&
    arm.restore_started_at <= arm.restore_completed_at
  );
}

function executionGreen(arm) {
  return (
    arm?.raw_exit === 0 &&
    arm.execution_result?.control_identity === focusedIdentity &&
    arm.execution_result?.child_raw_exit === 0 &&
    arm.execution_result?.observed_count > 0 &&
    arm.execution_result?.passed > 0 &&
    arm.execution_result?.failed === 0 &&
    arm.execution_result?.skip_count === 0 &&
    arm.execution_result?.todo_count === 0
  );
}

function workCallGreen(arm) {
  return (
    arm?.work_call_result?.guard === 'runtime-tools-non-target-control' &&
    arm.work_call_result?.control_identity === 'product_work_create' &&
    arm.work_call_result?.work_present === true &&
    arm.work_call_result?.product_work_create_ok === true &&
    arm.work_call_result?.work_call_raw_exit === 0 &&
    arm.work_call_result?.work_call_observed_count > 0 &&
    arm.work_call_result?.work_call_skip_count === 0 &&
    arm.work_call_result?.work_call_todo_count === 0
  );
}

function memoryCallGreen(arm) {
  return (
    arm?.memory_call_result?.guard === 'runtime-tools-non-target-control' &&
    arm.memory_call_result?.control_identity === 'agent_server_memory_read' &&
    arm.memory_call_result?.memory_read_ok === true &&
    arm.memory_call_result?.memory_call_raw_exit === 0 &&
    arm.memory_call_result?.memory_call_observed_count > 0 &&
    arm.memory_call_result?.memory_call_skip_count === 0 &&
    arm.memory_call_result?.memory_call_todo_count === 0
  );
}

function targetExecutionRan(arm) {
  return (
    arm?.execution_result?.control_identity === focusedIdentity &&
    arm.execution_result?.child_raw_exit === 1 &&
    arm.execution_result?.observed_count > 0 &&
    arm.execution_result?.skip_count === 0 &&
    arm.execution_result?.todo_count === 0
  );
}

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
