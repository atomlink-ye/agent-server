import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  runtimeIsNonroot,
  runtimeStateIsReadOnly,
  runtimeStateIsWritable,
} from './lib/phase-c-runtime-boundary.mjs';
import { runtimeBoundaryCleanupProbes } from './lib/phase-c-runtime-cleanup.mjs';
import { projectStandaloneMutationFailure } from './lib/phase-c-mutation-failure.mjs';
import { executeStandaloneMutation } from './lib/phase-c-standalone-mutation.mjs';

const combinedFailure = new Error('raw primary should not be serialized');
combinedFailure.stack = 'SECRET_STACK /proc/1/cmdline';
combinedFailure.mutation_failures = [
  { phase: 'primary', message: 'compose failed token-secret' },
  { phase: 'diagnostics', message: 'diagnostics failed' },
  { phase: 'cleanup', message: 'cleanup failed; argv=SECRET_ARG' },
  { phase: 'ignored', message: 'must not appear' },
];
const projectedFailure = projectStandaloneMutationFailure(combinedFailure, {
  secretValues: ['token-secret', 'SECRET_ARG'],
});
assert.deepEqual(projectedFailure, {
  status: 'FAIL',
  mode: 'missing-paseo-process',
  reason: 'standalone_mutation_failed',
  mutation_failures: [
    { phase: 'primary', message: 'compose failed [REDACTED]' },
    { phase: 'diagnostics', message: 'diagnostics failed' },
    { phase: 'cleanup', message: 'cleanup failed; [REDACTED]' },
  ],
});
assert.equal(Object.hasOwn(projectedFailure, 'stack'), false);
assert.equal(JSON.stringify(projectedFailure).includes('/proc/'), false);
assert.equal(JSON.stringify(projectedFailure).includes('SECRET_'), false);

const standaloneOutput = [];
const standaloneExitRequests = [];
const standaloneExit = await executeStandaloneMutation({
  runMutation: async () => {
    throw combinedFailure;
  },
  output: (value) => standaloneOutput.push(value),
  exit: (code) => standaloneExitRequests.push(code),
  secretValues: ['token-secret', 'SECRET_ARG'],
});
assert.equal(standaloneExit, 1);
assert.deepEqual(standaloneExitRequests, [1]);
assert.equal(standaloneOutput.length, 1);
const standaloneResult = JSON.parse(standaloneOutput[0]);
assert.deepEqual(standaloneResult, projectedFailure);
assert.equal(standaloneResult.status, 'FAIL');
assert.equal(standaloneResult.mutation_failures.length, 3);
assert.equal(JSON.stringify(standaloneResult).includes('raw primary'), false);
assert.equal(JSON.stringify(standaloneResult).includes('SECRET_'), false);
assert.equal(JSON.stringify(standaloneResult).includes('stack'), false);
assert.equal(JSON.stringify(standaloneResult).includes('environment'), false);
assert.equal(JSON.stringify(standaloneResult).includes('argv='), false);

const nonroot = {
  process_uid: 1000,
  process_gid: 1000,
  pid1_uid: 1000,
  pid1_gid: 1000,
};
assert.equal(runtimeIsNonroot(nonroot), true);
assert.equal(runtimeIsNonroot({ ...nonroot, pid1_uid: 0 }), false);
assert.equal(
  runtimeStateIsWritable({
    write_exit: 0,
    error_code: null,
    file_present: false,
  }),
  true,
);
assert.equal(
  runtimeStateIsReadOnly({
    write_exit: 1,
    error_code: 'EROFS',
    file_present: false,
  }),
  true,
);
for (const error_code of ['EACCES', 'ENOENT']) {
  assert.equal(
    runtimeStateIsReadOnly({ write_exit: 1, error_code, file_present: false }),
    false,
  );
}

for (const [path, assertion] of [
  ['phase-c-e4-root-runtime-mutation.yaml', /^    user: '0:0'$/mu],
  [
    'phase-c-e4-runtime-state-ro-mutation.yaml',
    /^      - paseo-runtime-state:\/runtime-state:ro$/mu,
  ],
]) {
  const source = readFileSync(resolve(import.meta.dirname, path), 'utf8');
  assert.match(source, assertion);
  assert.doesNotMatch(source, /^  agent-server:/mu);
}
const noPaseoMutationSource = readFileSync(
  resolve(import.meta.dirname, 'phase-c-e4-no-paseo-process.yaml'),
  'utf8',
);
assert.match(noPaseoMutationSource, /phase-c-no-paseo-carrier/u);
assert.match(noPaseoMutationSource, /^  paseo-runtime:/mu);
const evaluatorSource = readFileSync(
  resolve(import.meta.dirname, 'phase-c.mjs'),
  'utf8',
);
const evaluatorForbiddenBlock = evaluatorSource.match(
  /const forbiddenAgentServerEnvironment = new Set\(\[([\s\S]*?)\]\);/u,
)[1];
const evaluatorForbiddenNames = [
  ...evaluatorForbiddenBlock.matchAll(/'([A-Z0-9_]+)'/gu),
]
  .map((match) => match[1])
  .sort();
const mutationResetNames = [
  ...noPaseoMutationSource.matchAll(/^      ([A-Z0-9_]+): !reset null$/gmu),
]
  .map((match) => match[1])
  .sort();
assert.deepEqual(mutationResetNames, evaluatorForbiddenNames);
const harnessSource = readFileSync(
  resolve(import.meta.dirname, 'phase-c-harness.mjs'),
  'utf8',
);
assert.match(
  harnessSource,
  /FOUNDATION_PHASE_C_MODE === 'missing-paseo-process'/u,
);
assert.match(harnessSource, /runStandaloneMissingPaseoMutation/u);
assert.match(
  harnessSource,
  /standalone_missing_paseo_non_target_boundary_not_green/u,
);
assert.match(harnessSource, /runtime_state_probe_file_present === false/u);
assert.match(harnessSource, /workspace_probe_file_present === false/u);
assert.match(harnessSource, /let diagnosticFailure/u);
assert.match(harnessSource, /mutation_failures/u);
assert.match(harnessSource, /cleanup_failure/u);

const init = readFileSync(
  resolve(import.meta.dirname, '../../compose.external-runtime.yaml'),
  'utf8',
).match(/^  paseo-runtime-state-init:\n([\s\S]*?)(?=^  paseo-runtime:)/mu)?.[0];
assert.ok(init);
assert.match(init, /^    cap_add:\n      - CHOWN$/mu);
assert.doesNotMatch(init, /FOWNER/u);
assert.match(
  init,
  /chown 0:0 \/runtime-state && chmod 0700 \/runtime-state && chown 1000:1000 \/runtime-state/u,
);
let ownership = { uid: 0, gid: 0, mode: 0o755 };
for (let run = 0; run < 2; run += 1) {
  ownership = { uid: 0, gid: 0, mode: ownership.mode };
  ownership.mode = 0o700;
  ownership = { uid: 1000, gid: 1000, mode: ownership.mode };
}
assert.deepEqual(ownership, { uid: 1000, gid: 1000, mode: 0o700 });

const runtimeEnvironment = [
  'OPENCODE_GO_API_KEY',
  'PASEO_PROVIDER',
  'PASEO_MODEL',
  'PASEO_CONNECT_TIMEOUT_MS',
  'PASEO_EXECUTION_TIMEOUT_MS',
  'PASEO_SESSION_RPC_TIMEOUT_MS',
  'PASEO_DAEMON_STARTUP_TIMEOUT_MS',
  'PASEO_OPENCODE_SERVER_STARTUP_TIMEOUT_MS',
  'PASEO_PROVIDER_REFRESH_TIMEOUT_MS',
  'PASEO_OPENCODE_APP_AGENTS_TIMEOUT_MS',
  'PASEO_OPENCODE_PROVIDER_LIST_TIMEOUT_MS',
  'PASEO_OPENCODE_SESSION_CREATE_TIMEOUT_MS',
  'HOME',
  'PASEO_HOME',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
];
const baseRecord = {
  candidate_sha: 'a'.repeat(40),
  effective_compose: {
    services: [
      {
        name: 'agent-server',
        command: ['node', 'server.ts'],
        depends_on: ['paseo-runtime'],
        environment: { PASEO_WS_URL: 'ws://paseo-runtime:16767/ws' },
        mounts: [{ target: '/workspace' }],
      },
      {
        name: 'paseo-runtime',
        command: ['node', 'scripts/dev/paseo-runtime.mjs'],
        depends_on: ['provider-toolchain-init', 'paseo-runtime-state-init'],
        environment: Object.fromEntries(
          runtimeEnvironment.map((name) => [name, true]),
        ),
        mounts: [{ target: '/opt/provider-toolchain-volume' }],
      },
    ],
  },
  runtime_inspection: {
    containers: ['agent-server', 'paseo-runtime'],
    agent_server: {
      container_id: 'agent',
      environment_names: ['NODE_ENV'],
      processes: [
        { pid: 1, ppid: 0, uid: 1000, comm: 'node', identity: 'other' },
      ],
      mounts: [{ destination: '/workspace', read_only: false }],
    },
    paseo_runtime: {
      container_id: 'runtime',
      environment_names: runtimeEnvironment,
      processes: [
        {
          pid: 1,
          ppid: 0,
          uid: 1000,
          comm: 'paseo',
          identity: 'paseo-daemon',
        },
      ],
      mounts: [
        {
          destination: '/opt/provider-toolchain-volume',
          read_only: true,
        },
        { destination: '/workspace', read_only: true },
        { destination: '/runtime-state', read_only: false },
      ],
      identity: nonroot,
      runtime_state_probe: {
        write_exit: 0,
        error_code: null,
        file_present: false,
      },
      workspace_write_probe: {
        write_exit: 1,
        error_code: 'EROFS',
        file_present: false,
      },
    },
  },
};
const fixtureRoot = mkdtempSync(join(tmpdir(), 'phase-c-runtime-boundary-'));
function evaluate(record) {
  const path = join(fixtureRoot, `${Math.random()}.json`);
  writeFileSync(path, JSON.stringify(record));
  const child = spawnSync(
    process.execPath,
    [
      resolve(import.meta.dirname, 'phase-c.mjs'),
      'E4',
      '--runtime-record',
      path,
    ],
    {
      env: { ...process.env, FOUNDATION_PHASE_C_POSITIVE_ONLY: '1' },
      encoding: 'utf8',
    },
  );
  return {
    exit: child.status,
    output: JSON.parse(child.stdout.trim().split('\n').at(-1)),
  };
}
const positive = evaluate(baseRecord);
assert.equal(positive.exit, 0);
const rootMutation = structuredClone(baseRecord);
rootMutation.runtime_inspection.paseo_runtime.identity = {
  process_uid: 0,
  process_gid: 0,
  pid1_uid: 0,
  pid1_gid: 0,
};
const rootEvaluation = evaluate(rootMutation);
assert.deepEqual(rootEvaluation, {
  exit: 1,
  output: {
    suite: 'E4',
    status: 'FAIL',
    code: 1,
    reason: 'runtime ownership proposition failed',
    failures: ['nonroot_runtime_boundary'],
  },
});
assert.equal(rootEvaluation.exit, 1);
assert.equal(rootEvaluation.output.status, 'FAIL');
const cleanupWithoutResultRecord = runtimeBoundaryCleanupProbes(
  undefined,
  rootMutation,
);
assert.deepEqual(cleanupWithoutResultRecord, {
  runtime_state_probe_file_present: false,
  workspace_probe_file_present: false,
});
assert.equal(
  typeof cleanupWithoutResultRecord.runtime_state_probe_file_present,
  'boolean',
);
assert.equal(
  typeof cleanupWithoutResultRecord.workspace_probe_file_present,
  'boolean',
);
assert.deepEqual(
  runtimeBoundaryCleanupProbes(
    {
      runtime_state_probe: { file_present: true },
      workspace_write_probe: { file_present: true },
    },
    rootMutation,
  ),
  {
    runtime_state_probe_file_present: true,
    workspace_probe_file_present: true,
  },
);
assert.throws(
  () =>
    runtimeBoundaryCleanupProbes(undefined, {
      runtime_inspection: { paseo_runtime: {} },
    }),
  /runtime_cleanup_probe_invalid:runtime_state_probe/u,
);
assert.throws(
  () =>
    runtimeBoundaryCleanupProbes(
      { runtime_state_probe: { file_present: 'false' } },
      {
        runtime_inspection: {
          paseo_runtime: {
            runtime_state_probe: { file_present: null },
            workspace_write_probe: { file_present: false },
          },
        },
      },
    ),
  /runtime_cleanup_probe_invalid:runtime_state_probe/u,
);
assert.throws(
  () =>
    runtimeBoundaryCleanupProbes(
      {
        runtime_state_probe: { file_present: false },
        workspace_write_probe: { file_present: 0 },
      },
      {
        runtime_inspection: {
          paseo_runtime: {
            workspace_write_probe: { file_present: undefined },
          },
        },
      },
    ),
  /runtime_cleanup_probe_invalid:workspace_write_probe/u,
);
const stateMutation = structuredClone(baseRecord);
stateMutation.mutation = {
  instrumentation: 'failed-runtime-child-carrier',
  real_runtime_child_exit: 1,
  real_runtime_child_survived: false,
};
stateMutation.runtime_inspection.paseo_runtime.processes = [
  { pid: 1, ppid: 0, uid: 1000, comm: 'sh', identity: 'other' },
];
stateMutation.runtime_inspection.paseo_runtime.mounts[2].read_only = true;
stateMutation.runtime_inspection.paseo_runtime.runtime_state_probe = {
  write_exit: 1,
  error_code: 'EROFS',
  file_present: false,
};
assert.deepEqual(evaluate(stateMutation), {
  exit: 1,
  output: {
    suite: 'E4',
    status: 'FAIL',
    code: 1,
    reason: 'runtime ownership proposition failed',
    failures: ['runtime_state_writable_boundary'],
  },
});
const noPaseoMutation = structuredClone(baseRecord);
noPaseoMutation.mutation = {
  name: 'remove-paseo-daemon-process',
  source: 'scripts/foundation/phase-c-e4-no-paseo-process.yaml',
  operational_overlays: ['scripts/foundation/phase-c-e4-no-ports.yaml'],
};
noPaseoMutation.runtime_inspection.paseo_runtime.processes = [
  {
    pid: 1,
    ppid: 0,
    uid: 1000,
    comm: 'phase-c-no-paseo-carrier',
    identity: 'other',
  },
];
const noPaseoEvaluation = evaluate(noPaseoMutation);
assert.deepEqual(noPaseoEvaluation, {
  exit: 1,
  output: {
    suite: 'E4',
    status: 'FAIL',
    code: 1,
    reason: 'runtime ownership proposition failed',
    failures: ['runtime_paseo_process_missing'],
  },
});
assert.equal(
  runtimeIsNonroot(noPaseoMutation.runtime_inspection.paseo_runtime.identity),
  true,
);
assert.equal(
  runtimeStateIsWritable(
    noPaseoMutation.runtime_inspection.paseo_runtime.runtime_state_probe,
  ),
  true,
);
assert.equal(
  noPaseoMutation.runtime_inspection.paseo_runtime.mounts.some(
    (mount) => mount.destination === '/workspace' && mount.read_only === true,
  ),
  true,
);
for (const [path, expectedProvider] of [
  ['phase-c-e4-declarative-env-mutation.yaml', 'declarative-mutation-provider'],
  ['phase-c-e4-actual-env-mutation.yaml', 'actual-mutation-provider'],
]) {
  const source = readFileSync(resolve(import.meta.dirname, path), 'utf8');
  assert.match(source, /^services:\n  agent-server:\n    environment:\n/mu);
  assert.match(source, new RegExp(`PASEO_PROVIDER: ${expectedProvider}`, 'u'));
  assert.equal((source.match(/^[ ]{4}\S+/gmu) ?? []).length, 1);
}
const declarativeEnvironmentMutation = structuredClone(baseRecord);
declarativeEnvironmentMutation.mutation = {
  name: 'restore-agent-provider-declarative-projection',
  source: 'scripts/foundation/phase-c-e4-declarative-env-mutation.yaml',
  projection_overlay:
    'scripts/foundation/phase-c-e4-declarative-env-mutation.yaml',
  launch_overlay: null,
  operational_overlays: ['scripts/foundation/phase-c-e4-no-ports.yaml'],
};
declarativeEnvironmentMutation.effective_compose.services[0].environment.PASEO_PROVIDER = true;
const declarativeEnvironmentEvaluation = evaluate(
  declarativeEnvironmentMutation,
);
assert.deepEqual(declarativeEnvironmentEvaluation.output.failures, [
  {
    proposition: 'agent_server_runtime_provider_environment',
    present: ['PASEO_PROVIDER'],
  },
]);
assert.equal(declarativeEnvironmentEvaluation.exit, 1);
const actualEnvironmentMutation = structuredClone(baseRecord);
actualEnvironmentMutation.mutation = {
  name: 'restore-agent-provider-actual-container',
  source: 'scripts/foundation/phase-c-e4-actual-env-mutation.yaml',
  projection_overlay: null,
  launch_overlay: 'scripts/foundation/phase-c-e4-actual-env-mutation.yaml',
  operational_overlays: ['scripts/foundation/phase-c-e4-no-ports.yaml'],
};
actualEnvironmentMutation.runtime_inspection.agent_server.environment_names.push(
  'PASEO_PROVIDER',
);
const actualEnvironmentEvaluation = evaluate(actualEnvironmentMutation);
assert.deepEqual(actualEnvironmentEvaluation.output.failures, [
  {
    proposition: 'actual_agent_server_runtime_provider_environment',
    present: ['PASEO_PROVIDER'],
  },
]);
assert.equal(actualEnvironmentEvaluation.exit, 1);
assert.equal(
  declarativeEnvironmentMutation.effective_compose.services[0].environment
    .PASEO_PROVIDER,
  true,
);
assert.equal(
  declarativeEnvironmentMutation.runtime_inspection.agent_server.environment_names.includes(
    'PASEO_PROVIDER',
  ),
  false,
);
assert.equal(
  actualEnvironmentMutation.effective_compose.services[0].environment
    .PASEO_PROVIDER,
  undefined,
);
assert.equal(
  actualEnvironmentMutation.runtime_inspection.agent_server.environment_names.includes(
    'PASEO_PROVIDER',
  ),
  true,
);
rmSync(fixtureRoot, { recursive: true, force: true });

process.stdout.write(
  `${JSON.stringify({ status: 'PASS', nonroot_uid_gid: '1000:1000', runtime_state_writable: true, runtime_state_erofs_red: true, init_repeat_runs: 2, evaluator_root_red: 1, evaluator_state_red: 1 })}\n`,
);
