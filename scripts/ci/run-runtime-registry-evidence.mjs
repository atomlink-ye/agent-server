#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const repo = process.cwd();
const output = path.resolve(option('--output'));
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) fail('runtime_registry_evidence_missing_database_url', 2);
const candidate = command('git', ['rev-parse', 'HEAD']);
const parent = command('git', ['rev-parse', 'HEAD^']);
const statusBefore = status();
if (statusBefore.length) fail('runtime_registry_evidence_dirty_start', 2);
const inputs = [
  'package.json',
  'pnpm-lock.yaml',
  'src/bootstrap.ts',
  'src/platform/runtime-tool-registry.ts',
  'src/entrypoints/mcp/runtime-tool-composition.ts',
  'src/entrypoints/mcp/runtime-tool-contributors.ts',
  'src/entrypoints/mcp/direct-memory-mcp.ts',
  'src/infrastructure/extensions/runtime-mcp-server.ts',
  'src/modules/work/work-module.ts',
  'tests/integration/product-api-v1-oi38.integration.test.ts',
  'scripts/ci/classify-runtime-tools-acceptance.mjs',
  'scripts/ci/run-runtime-tools-acceptance-raw.mjs',
  'scripts/ci/runtime-tools-acceptance-inputs.mjs',
  'scripts/ci/check-runtime-tool-host-boundary.mjs',
  'scripts/ci/verify-registry-change-budget.mjs',
  'scripts/ci/work-acceptance-outcome.mjs',
  'scripts/ci/check-work-acceptance-outcome-matrix.mjs',
  'scripts/ci/work-acceptance-raw-support.mjs',
  'scripts/ci/run-runtime-registry-evidence.mjs',
  'scripts/ci/verify-runtime-registry-evidence.mjs',
];
const inputHashes = Object.fromEntries(inputs.map((file) => [file, sha(file)]));
const arms = [];
const mutations = [];

arms.push(
  runArm(
    'classifier-outcome-matrix',
    'node',
    ['scripts/ci/check-work-acceptance-outcome-matrix.mjs'],
    0,
    [
      '"theoretical_points":64',
      '"mutually_exclusive_and_exhaustive":true',
      '"signal":"SIGTERM","error":"ENOBUFS"',
      '"ok":true',
    ],
  ),
);
arms.push(canonical('baseline-runtime-tools', 0, ['"observed_count":1']));
arms.push(
  runWithoutDatabase('canonical-database-missing', 2, [
    'RUNTIME_TOOLS_MISSING[runtime_tools_database_unavailable]',
    'runtime_tools_missing:marker=runtime_tools_database_unavailable',
  ]),
);
arms.push(
  execute(
    'canonical-database-unreachable',
    'pnpm',
    ['modularization:acceptance:runtime-tools'],
    2,
    [
      '"database_reachable":false',
      'RUNTIME_TOOLS_MISSING[runtime_tools_environment_unavailable]',
      'runtime_tools_missing:marker=runtime_tools_environment_unavailable',
    ],
    {
      ...process.env,
      DATABASE_URL: 'postgresql://agent:agent@127.0.0.1:1/agent_server',
      npm_config_verify_deps_before_run: 'false',
    },
  ),
);
arms.push(
  runArm(
    'baseline-change-budget',
    'pnpm',
    ['modularization:verify:change-budget'],
    0,
    [
      '"migrations":{"before_count":30,"after_count":30',
      '"dependencies":{"before_count":9,"after_count":9',
      '"exports":{"before_count":1,"after_count":1',
      '"failures":[]',
    ],
  ),
);
arms.push(
  runArm(
    'verifier-input-missing',
    'node',
    [
      'scripts/ci/verify-runtime-registry-evidence.mjs',
      '--input',
      '/tmp/mgr-b-registry-c-deliberately-absent.json',
    ],
    2,
    ['runtime_registry_evidence_missing:input_unreadable:'],
  ),
);

mutate(
  'zero-execution',
  'scripts/ci/run-runtime-tools-acceptance-raw.mjs',
  `pattern: 'calls Work and Memory through the composed runtime tool registry'`,
  `pattern: 'mgr-b-deliberately-no-runtime-tools-test'`,
  () => {
    arms.push(
      canonical('canonical-zero-execution', 2, [
        '"expected_min_count":1',
        '"observed_count":0',
        'RUNTIME_TOOLS_MISSING[runtime_tools_zero_execution]',
      ]),
    );
    arms.push(changeBudget('zero-execution-change-budget-control'));
  },
);

mutate(
  'remove-work-registration',
  'src/entrypoints/mcp/runtime-tool-composition.ts',
  'return new RuntimeToolRegistry([input.work, input.memory, input.legacy]);',
  'return new RuntimeToolRegistry([input.memory, input.legacy]);',
  () => {
    arms.push(
      canonical('remove-work-registration', 2, [
        'RUNTIME_TOOLS_MISSING[runtime_work_registration_missing]',
        'non_target_memory_ok=true',
      ]),
    );
    arms.push(typecheck('remove-work-registration-type-control'));
    arms.push(changeBudget('remove-work-registration-budget-control'));
  },
);

mutate(
  'remove-memory-registration',
  'src/entrypoints/mcp/runtime-tool-composition.ts',
  'return new RuntimeToolRegistry([input.work, input.memory, input.legacy]);',
  'return new RuntimeToolRegistry([input.work, input.legacy]);',
  () => {
    arms.push(
      canonical('remove-memory-registration', 2, [
        'RUNTIME_TOOLS_MISSING[runtime_memory_registration_missing]',
        'non_target_work_ok=true',
      ]),
    );
    arms.push(typecheck('remove-memory-registration-type-control'));
    arms.push(changeBudget('remove-memory-registration-budget-control'));
  },
);

mutate(
  'memory-handler-wrongness',
  'src/entrypoints/mcp/runtime-tool-contributors.ts',
  'content: memory.current.content,',
  'content: `${memory.current.content}-wrong`,',
  () => {
    arms.push(
      canonical('memory-handler-wrongness', 1, [
        'runtime-registry-e6-wrong',
        'runtime_tools_child_result:status=1:signal=none:error=none',
      ]),
    );
    arms.push(typecheck('memory-handler-wrongness-type-control'));
    arms.push(changeBudget('memory-handler-wrongness-budget-control'));
  },
);

mutate(
  'constructor-capability-reinjection',
  'src/infrastructure/extensions/runtime-mcp-server.ts',
  "import type { RuntimeToolRegistry } from '../../platform/runtime-tool-registry.js';",
  "import type { RuntimeToolRegistry } from '../../platform/runtime-tool-registry.js';\nimport type { MemoryApiRepository } from '../../application/ports/memory-api-repository.js';",
  () =>
    mutate(
      'constructor-capability-reinjection-parameter',
      'src/infrastructure/extensions/runtime-mcp-server.ts',
      'private readonly registry: RuntimeToolRegistry,\n    grants = new RuntimeToolGrantService(),',
      'private readonly registry: RuntimeToolRegistry,\n    private readonly repository?: MemoryApiRepository,\n    grants = new RuntimeToolGrantService(),',
      () => {
        arms.push(
          canonical('constructor-capability-reinjection', 1, [
            'runtime_tool_host_boundary_violation:file=src/infrastructure/extensions/runtime-mcp-server.ts:identifier=MemoryApiRepository',
            '"observed_count":1',
          ]),
        );
        arms.push(typecheck('constructor-capability-reinjection-type-control'));
        arms.push(
          changeBudget('constructor-capability-reinjection-budget-control'),
        );
      },
    ),
);

mutate(
  'host-template-static-text',
  'src/infrastructure/extensions/runtime-mcp-server.ts',
  'public async start(): Promise<string> {',
  'public async start(): Promise<string> {\n    const staticText = `MemoryApiRepository`;\n    void staticText;',
  () => {
    arms.push(
      canonical('host-template-static-text-control', 0, [
        '"observed_count":1',
        '"violations":0',
      ]),
    );
    arms.push(typecheck('host-template-static-text-type-control'));
  },
);

mutate(
  'host-template-interpolation',
  'src/infrastructure/extensions/runtime-mcp-server.ts',
  'public async start(): Promise<string> {',
  'public async start(): Promise<string> {\n    const interpolation = `outer-${`inner-${({ MemoryApiRepository: this.registry }).MemoryApiRepository}`}`;\n    void interpolation;',
  () => {
    arms.push(
      canonical('host-template-interpolation', 1, [
        'runtime_tool_host_boundary_violation:file=src/infrastructure/extensions/runtime-mcp-server.ts:identifier=MemoryApiRepository',
        '"observed_count":1',
      ]),
    );
    arms.push(typecheck('host-template-interpolation-type-control'));
    arms.push(changeBudget('host-template-interpolation-budget-control'));
  },
);

mutate(
  'typescript-api-unavailable',
  'scripts/ci/check-runtime-tool-host-boundary.mjs',
  "await import('typescript/unstable/sync')",
  "await import('typescript/unstable/deliberately-absent')",
  () => {
    arms.push(
      canonical('typescript-api-unavailable', 2, [
        'runtime_tool_host_boundary_missing:',
        'RUNTIME_TOOLS_MISSING[runtime_tools_host_boundary_checker_missing]',
        '"observed_count":1',
      ]),
    );
    arms.push(changeBudget('typescript-api-unavailable-budget-control'));
  },
);

arms.push(classifierArm('classifier-success', 'process.exit(0)', 0, []));
arms.push(
  classifierArm(
    'classifier-recognized-missing',
    "console.error('RUNTIME_TOOLS_MISSING[runtime_work_registration_missing]');process.exit(1)",
    2,
    ['runtime_tools_missing:marker=runtime_work_registration_missing'],
  ),
);
arms.push(
  classifierArm(
    'classifier-near-miss-fail',
    "console.error('not_RUNTIME_TOOLS_MISSING[runtime_work_registration_missing]_suffix');process.exit(1)",
    1,
    ['not_RUNTIME_TOOLS_MISSING'],
  ),
);
arms.push(
  classifierArm(
    'classifier-unmarked-exit-two-fail',
    "console.error('unmarked');process.exit(2)",
    1,
    ['runtime_tools_child_result:status=2:signal=none:error=none'],
  ),
);
arms.push(
  classifierArm(
    'classifier-marker-raw-three-fail',
    "console.error('RUNTIME_TOOLS_MISSING[runtime_work_registration_missing]');process.exit(3)",
    1,
    ['runtime_tools_child_result:status=3:signal=none:error=none'],
  ),
);
arms.push(
  classifierArm(
    'classifier-marker-signal-fail',
    "console.error('RUNTIME_TOOLS_MISSING[runtime_work_registration_missing]');process.kill(process.pid,'SIGTERM')",
    1,
    ['runtime_tools_child_result:status=null:signal=SIGTERM:error=none'],
  ),
);
arms.push(
  runArm(
    'classifier-spawn-unavailable-fail',
    'node',
    [
      'scripts/ci/classify-runtime-tools-acceptance.mjs',
      '--',
      '/tmp/mgr-b-runtime-tools-deliberately-absent-command',
    ],
    1,
    ['runtime_tools_child_result:status=null:signal=none:error=ENOENT'],
  ),
);

mutate(
  'migration-change',
  'src/infrastructure/postgres/migrations/0029_product_work_identity.sql',
  'COMMIT;',
  '-- registry change budget mutation\nCOMMIT;',
  () =>
    arms.push(
      runArm(
        'change-budget-migration-red',
        'pnpm',
        ['modularization:verify:change-budget'],
        1,
        ['registry_change_budget_violation:target=migrations'],
      ),
    ),
);
arms.push(canonical('change-budget-migration-runtime-control', 0, []));

mutate(
  'dependency-change',
  'package.json',
  '"zod": "4.4.3"',
  '"zod": "4.4.4"',
  () =>
    arms.push(
      runArm(
        'change-budget-dependency-red',
        'pnpm',
        ['modularization:verify:change-budget'],
        1,
        ['registry_change_budget_violation:target=dependencies'],
      ),
    ),
);
arms.push(canonical('change-budget-dependency-runtime-control', 0, []));

mutate(
  'exports-change',
  'package.json',
  '"./product-contract": "./src/contracts/product-accepted-subset/index.ts"',
  '"./product-contract": "./src/contracts/product-accepted-subset/changed.ts"',
  () =>
    arms.push(
      runArm(
        'change-budget-exports-red',
        'pnpm',
        ['modularization:verify:change-budget'],
        1,
        ['registry_change_budget_violation:target=exports'],
      ),
    ),
);
arms.push(canonical('change-budget-exports-runtime-control', 0, []));

mutate(
  'baseline-current-tree',
  'scripts/ci/verify-registry-change-budget.mjs',
  "const BASELINE = '888630a8a730ce6bcdfe2e5fb679a3620ac171aa';",
  `const BASELINE = '${candidate}';`,
  () =>
    arms.push(
      runArm(
        'change-budget-current-baseline-missing',
        'pnpm',
        ['modularization:verify:change-budget'],
        2,
        ['registry_change_budget_missing:baseline_equals_candidate'],
      ),
    ),
);
arms.push(canonical('change-budget-current-baseline-runtime-control', 0, []));

const statusAfter = status();
const restoredHashes = Object.fromEntries(
  inputs.map((file) => [file, sha(file)]),
);
const ok =
  arms.every((arm) => arm.ok) &&
  JSON.stringify(statusBefore) === JSON.stringify(statusAfter) &&
  JSON.stringify(inputHashes) === JSON.stringify(restoredHashes) &&
  mutations.every((mutation) => mutation.restored);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(
  output,
  `${JSON.stringify(
    {
      schema_version: 1,
      candidate,
      parent,
      argv: process.argv,
      cwd: repo,
      input_hashes: inputHashes,
      restored_hashes: restoredHashes,
      status_before: statusBefore,
      status_after: statusAfter,
      dependency_paths: dependencyState(),
      mutations,
      arms,
      query_helper_moves: 0,
      registry_follow_on_started: false,
      zero_rule_audit: {
        e6_expected_min_count: 1,
        e6_expected_source:
          'one named focused Work+Memory acceptance test selected by the canonical raw wrapper',
        e6_observed_source: 'Vitest JSON passed+failed target assertions',
        e6_kind: 'acceptance_instrument',
        e6_business_collection_nonempty_rule: false,
        e6_proposition_valid_under_corrected_rule: true,
        shared_expected_zero_repair_owner:
          'paseo worker cb3dd151; not imported or cherry-picked into Phase C',
        e7_nonempty_expected_source:
          'PLAN-B E7 fixed baseline 888630a8 requires nonempty migrations/dependencies/exports compare sets',
        fixture_added_for_audit: false,
      },
      ok,
    },
    null,
    2,
  )}\n`,
);
process.exit(ok ? 0 : 1);

function canonical(name, expectedExit, markers) {
  return runArm(
    name,
    'pnpm',
    ['modularization:acceptance:runtime-tools'],
    expectedExit,
    markers,
  );
}
function changeBudget(name) {
  return runArm(name, 'pnpm', ['modularization:verify:change-budget'], 0, [
    '"failures":[]',
  ]);
}
function typecheck(name) {
  return runArm(name, 'pnpm', ['check:types'], 0, []);
}
function classifierArm(name, child, expectedExit, markers) {
  return runArm(
    name,
    'node',
    [
      'scripts/ci/classify-runtime-tools-acceptance.mjs',
      '--',
      'node',
      '-e',
      child,
    ],
    expectedExit,
    markers,
  );
}
function runWithoutDatabase(name, expectedExit, markers) {
  const env = { ...process.env };
  delete env.DATABASE_URL;
  delete env.POSTGRES_URL;
  env.npm_config_verify_deps_before_run = 'false';
  return execute(
    name,
    'pnpm',
    ['modularization:acceptance:runtime-tools'],
    expectedExit,
    markers,
    env,
  );
}
function runArm(name, executable, argv, expectedExit, markers) {
  return execute(name, executable, argv, expectedExit, markers, {
    ...process.env,
    DATABASE_URL: databaseUrl,
    npm_config_verify_deps_before_run: 'false',
  });
}
function execute(name, executable, argv, expectedExit, markers, env) {
  const result = spawnSync(executable, argv, {
    cwd: repo,
    env,
    encoding: 'utf8',
  });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const combined = `${stdout}\n${stderr}`;
  const markerAssertions = Object.fromEntries(
    markers.map((marker) => [marker, combined.includes(marker)]),
  );
  return {
    name,
    argv: [executable, ...argv],
    cwd: repo,
    expected_exit: expectedExit,
    raw_exit: result.status,
    signal: result.signal,
    error: result.error?.code ?? null,
    stdout,
    stderr,
    marker_assertions: markerAssertions,
    ok:
      result.status === expectedExit &&
      result.signal === null &&
      !result.error &&
      Object.values(markerAssertions).every(Boolean),
  };
}
function mutate(name, file, before, after, action) {
  const target = path.join(repo, file);
  const original = fs.readFileSync(target, 'utf8');
  const changed = original.replace(before, after);
  if (changed === original) fail(`${name}:mutation_anchor_missing`, 2);
  const record = {
    name,
    file,
    original_sha256: digest(original),
    mutated_sha256: digest(changed),
    exact_before: before,
    exact_after: after,
    restored: false,
  };
  mutations.push(record);
  fs.writeFileSync(target, changed);
  try {
    action();
  } finally {
    fs.writeFileSync(target, original);
    record.restored = sha(file) === record.original_sha256;
  }
}
function sha(file) {
  return digest(fs.readFileSync(path.join(repo, file)));
}
function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
function command(executable, argv) {
  const result = spawnSync(executable, argv, { cwd: repo, encoding: 'utf8' });
  if (result.status !== 0) fail(`${executable}:${argv.join(':')}`, 2);
  return result.stdout.trimEnd();
}
function status() {
  const value = command('git', ['status', '--short']);
  return value ? value.split('\n') : [];
}
function dependencyState() {
  return Object.fromEntries(
    ['node_modules', 'apps/web/node_modules'].map((target) => {
      const stat = fs.lstatSync(path.join(repo, target));
      return [
        target,
        { directory: stat.isDirectory(), symlink: stat.isSymbolicLink() },
      ];
    }),
  );
}
function option(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) fail(`missing_option:${name}`, 2);
  return process.argv[index + 1];
}
function fail(message, code) {
  console.error(message);
  process.exit(code);
}
