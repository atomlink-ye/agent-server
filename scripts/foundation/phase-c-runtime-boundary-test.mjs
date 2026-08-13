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
      processes: [{ pid: 1, uid: 1000, comm: 'node' }],
      mounts: [{ destination: '/workspace', read_only: false }],
    },
    paseo_runtime: {
      container_id: 'runtime',
      environment_names: runtimeEnvironment,
      processes: [{ pid: 1, uid: 1000, comm: 'paseo' }],
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
assert.deepEqual(evaluate(rootMutation), {
  exit: 1,
  output: {
    suite: 'E4',
    status: 'FAIL',
    code: 1,
    reason: 'runtime ownership proposition failed',
    failures: ['nonroot_runtime_boundary'],
  },
});
const stateMutation = structuredClone(baseRecord);
stateMutation.mutation = {
  instrumentation: 'failed-runtime-child-carrier',
  real_runtime_child_exit: 1,
  real_runtime_child_survived: false,
};
stateMutation.runtime_inspection.paseo_runtime.processes = [
  { pid: 1, uid: 1000, comm: 'sh' },
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
rmSync(fixtureRoot, { recursive: true, force: true });

process.stdout.write(
  `${JSON.stringify({ status: 'PASS', nonroot_uid_gid: '1000:1000', runtime_state_writable: true, runtime_state_erofs_red: true, init_repeat_runs: 2, evaluator_root_red: 1, evaluator_state_red: 1 })}\n`,
);
