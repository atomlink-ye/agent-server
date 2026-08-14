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
import {
  assertMutationEvaluatorOutcome,
  executeStandaloneMutation,
} from './lib/phase-c-standalone-mutation.mjs';
import {
  collectProcessSnapshots,
  enumerateNumericProcessRecords,
  hashProcessRecords,
} from './lib/phase-c-process-inspection.mjs';

const processStatus = `Name:\tfixture\nUid:\t1000\t1000\t1000\t1000\nPPid:\t0\n`;
const strongPaseoArgv = [
  '/opt/provider-toolchain-volume/current/paseo-toolchain/node_modules/.bin/paseo',
  'start',
  '--foreground',
  '--listen',
  '127.0.0.1:16767',
  '--home',
  '/runtime/paseo-home',
  '--no-relay',
  '--no-mcp',
  '--no-inject-mcp',
  '--no-web-ui',
];

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
const standaloneMissingOutput = [];
const standaloneMissingExitRequests = [];
const standaloneMissingExit = await executeStandaloneMutation({
  runMutation: async () => ({
    status: 'MISSING',
    mode: 'missing-paseo-process',
    reason: 'paseo_runtime process collection is missing or incomplete',
  }),
  output: (value) => standaloneMissingOutput.push(value),
  exit: (code) => standaloneMissingExitRequests.push(code),
});
assert.equal(standaloneMissingExit, 2);
assert.deepEqual(standaloneMissingExitRequests, [2]);
assert.deepEqual(JSON.parse(standaloneMissingOutput[0]), {
  status: 'MISSING',
  mode: 'missing-paseo-process',
  reason: 'paseo_runtime process collection is missing or incomplete',
});

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
const completeProcessCollection = (processes) => ({
  snapshots: [
    {
      numeric_count: processes.length,
      emitted_count: processes.length,
      enoent_count: 0,
      read_error_count: 0,
      integrity_error_count: 0,
      error_class: 'none',
    },
    {
      numeric_count: processes.length,
      emitted_count: processes.length,
      enoent_count: 0,
      read_error_count: 0,
      integrity_error_count: 0,
      error_class: 'none',
    },
  ],
  emitted_count: processes.length,
  record_hash: hashProcessRecords(processes),
  stable: true,
  complete: true,
});
const counterfeitCompleteEmptyCollection = () => ({
  snapshots: [
    {
      numeric_count: 1,
      emitted_count: 1,
      enoent_count: 0,
      read_error_count: 0,
      integrity_error_count: 0,
      error_class: 'none',
    },
    {
      numeric_count: 1,
      emitted_count: 1,
      enoent_count: 0,
      read_error_count: 0,
      integrity_error_count: 0,
      error_class: 'none',
    },
  ],
  emitted_count: 0,
  record_hash: hashProcessRecords([]),
  stable: true,
  complete: true,
});
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
      processes: [{ pid: 1, identity: 'other' }],
      process_collection: completeProcessCollection([
        { pid: 1, identity: 'other' },
      ]),
      mounts: [{ destination: '/workspace', read_only: false }],
    },
    paseo_runtime: {
      container_id: 'runtime',
      environment_names: runtimeEnvironment,
      processes: [
        {
          pid: 1,
          identity: 'paseo-daemon',
        },
      ],
      process_collection: completeProcessCollection([
        { pid: 1, identity: 'paseo-daemon' },
      ]),
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
function rebindProcessCollection(container) {
  container.process_collection.emitted_count = container.processes.length;
  container.process_collection.record_hash = hashProcessRecords(
    container.processes,
  );
}
function evaluateE6Proof(proof) {
  const path = resolve(import.meta.dirname, '.phase-c-e6-fixture.json');
  writeFileSync(path, JSON.stringify(proof));
  const child = spawnSync(
    process.execPath,
    [resolve(import.meta.dirname, 'phase-c.mjs'), 'E6', '--proof-record', path],
    { env: { ...process.env }, encoding: 'utf8' },
  );
  rmSync(path, { force: true });
  return {
    exit: child.status,
    output: JSON.parse(child.stdout.trim().split('\n').at(-1)),
  };
}
function incompleteProcessCollection(processes) {
  const value = completeProcessCollection(processes);
  value.complete = false;
  value.stable = false;
  value.snapshots[0].enoent_count = 1;
  value.snapshots[0].error_class = 'enoent';
  return value;
}
function collectorEvidence(cmdline, pid) {
  let snapshot = -1;
  return collectProcessSnapshots({
    listProcEntries: () => {
      snapshot += 1;
      return [String(pid)];
    },
    readComm: () => 'node\n',
    readStatus: () => processStatus,
    readCmdline: () => `${cmdline}\u0000`,
  });
}
function fullE6ProcessProof() {
  const absentInspection = collectorEvidence('carrier', 1);
  const presentInspection = collectorEvidence(
    strongPaseoArgv.join('\u0000'),
    2,
  );
  const absent = absentInspection.processes;
  const present = presentInspection.processes;
  return {
    ...minimalProof,
    agent_server_process_collection: absentInspection.process_collection,
    agent_server_processes: absent,
    paseo_runtime_process_collection: presentInspection.process_collection,
    paseo_runtime_processes: present,
    e4_mutation: {
      agent_process_collection: absentInspection.process_collection,
      agent_processes: absent,
      runtime_process_collection: presentInspection.process_collection,
      runtime_processes: present,
    },
    e4_workspace_mutation: {
      agent_process_collection: absentInspection.process_collection,
      agent_processes: absent,
      runtime_process_collection: presentInspection.process_collection,
      runtime_processes: present,
    },
    e4_root_runtime_mutation: {
      agent_process_collection: absentInspection.process_collection,
      agent_processes: absent,
      runtime_process_collection: presentInspection.process_collection,
      runtime_processes: present,
    },
    e4_runtime_state_mutation: {
      agent_process_collection: absentInspection.process_collection,
      agent_processes: absent,
      runtime_process_collection: absentInspection.process_collection,
      runtime_processes: absent,
      child_process_collection: absentInspection.process_collection,
      child_processes: absent,
    },
    e4_no_paseo_process_mutation: {
      agent_process_collection: absentInspection.process_collection,
      agent_processes: absent,
      runtime_process_collection: absentInspection.process_collection,
      runtime_processes: absent,
    },
    e4_declarative_environment_mutation: {
      agent_process_collection: absentInspection.process_collection,
      agent_processes: absent,
      runtime_process_collection: presentInspection.process_collection,
      runtime_processes: present,
    },
    e4_actual_environment_mutation: {
      agent_process_collection: absentInspection.process_collection,
      agent_processes: absent,
      runtime_process_collection: presentInspection.process_collection,
      runtime_processes: present,
    },
  };
}
const minimalProof = {
  work_id: 'work',
  work_run_id: 'run',
  agent_server_container_id: 'agent',
  paseo_runtime_container_id: 'runtime',
};
const missingE6ProcessEvidence = evaluateE6Proof(minimalProof);
assert.equal(missingE6ProcessEvidence.exit, 2);
assert.equal(missingE6ProcessEvidence.output.status, 'MISSING');
assert.equal(
  missingE6ProcessEvidence.output.reason,
  'required process collection evidence is missing or invalid',
);
const baselineOnlyE6Proof = {
  ...minimalProof,
  agent_server_process_collection: completeProcessCollection([
    { pid: 1, identity: 'other' },
  ]),
  agent_server_processes: [{ pid: 1, identity: 'other' }],
  paseo_runtime_process_collection: completeProcessCollection([
    { pid: 1, identity: 'paseo-daemon' },
  ]),
  paseo_runtime_processes: [{ pid: 1, identity: 'paseo-daemon' }],
};
const missingE6MutationEvidence = evaluateE6Proof(baselineOnlyE6Proof);
assert.equal(missingE6MutationEvidence.exit, 2);
assert.deepEqual(missingE6MutationEvidence.output.process_collection, [
  'e4_mutation_agent_process_collection',
  'e4_mutation_runtime_process_collection',
  'e4_workspace_mutation_agent_process_collection',
  'e4_workspace_mutation_runtime_process_collection',
  'e4_root_runtime_mutation_agent_process_collection',
  'e4_root_runtime_mutation_runtime_process_collection',
  'e4_runtime_state_mutation_agent_process_collection',
  'e4_runtime_state_mutation_runtime_process_collection',
  'e4_runtime_state_mutation_child_process_collection',
  'e4_no_paseo_process_mutation_agent_process_collection',
  'e4_no_paseo_process_mutation_runtime_process_collection',
  'e4_declarative_environment_mutation_agent_process_collection',
  'e4_declarative_environment_mutation_runtime_process_collection',
  'e4_actual_environment_mutation_agent_process_collection',
  'e4_actual_environment_mutation_runtime_process_collection',
]);
const e6ContradictionPlusInvalid = fullE6ProcessProof();
e6ContradictionPlusInvalid.paseo_runtime_processes = [
  { pid: 2, identity: 'other' },
];
e6ContradictionPlusInvalid.paseo_runtime_process_collection =
  completeProcessCollection(e6ContradictionPlusInvalid.paseo_runtime_processes);
e6ContradictionPlusInvalid.e4_mutation.agent_processes = [
  { pid: 3, identity: 'paseo-daemon', unknown_field: true },
];
e6ContradictionPlusInvalid.e4_mutation.agent_process_collection =
  completeProcessCollection(
    e6ContradictionPlusInvalid.e4_mutation.agent_processes,
  );
const e6InvalidBinding = evaluateE6Proof(e6ContradictionPlusInvalid);
assert.equal(e6InvalidBinding.exit, 2);
assert.equal(e6InvalidBinding.output.status, 'MISSING');
assert.equal(
  e6InvalidBinding.output.process_collection.includes(
    'e4_mutation_agent_process_collection',
  ),
  true,
);
const e6ForbiddenIncomplete = fullE6ProcessProof();
e6ForbiddenIncomplete.agent_server_processes = [
  { pid: 3, identity: 'paseo-daemon' },
];
e6ForbiddenIncomplete.agent_server_process_collection =
  incompleteProcessCollection(e6ForbiddenIncomplete.agent_server_processes);
e6ForbiddenIncomplete.e4_mutation.agent_process_collection =
  incompleteProcessCollection(
    e6ForbiddenIncomplete.e4_mutation.agent_processes,
  );
const e6Forbidden = evaluateE6Proof(e6ForbiddenIncomplete);
assert.equal(e6Forbidden.exit, 1);
assert.equal(e6Forbidden.output.status, 'FAIL');
const e6PresentCompleteNoWitness = fullE6ProcessProof();
e6PresentCompleteNoWitness.paseo_runtime_processes = [
  { pid: 4, identity: 'other' },
];
e6PresentCompleteNoWitness.paseo_runtime_process_collection =
  completeProcessCollection(e6PresentCompleteNoWitness.paseo_runtime_processes);
const e6PresentComplete = evaluateE6Proof(e6PresentCompleteNoWitness);
assert.equal(e6PresentComplete.exit, 1);
assert.equal(e6PresentComplete.output.status, 'FAIL');
const e6PresentIncompleteNoWitness = fullE6ProcessProof();
e6PresentIncompleteNoWitness.paseo_runtime_processes = [
  { pid: 5, identity: 'other' },
];
e6PresentIncompleteNoWitness.paseo_runtime_process_collection =
  incompleteProcessCollection(
    e6PresentIncompleteNoWitness.paseo_runtime_processes,
  );
const e6PresentIncomplete = evaluateE6Proof(e6PresentIncompleteNoWitness);
assert.equal(e6PresentIncomplete.exit, 2);
assert.equal(e6PresentIncomplete.output.status, 'MISSING');
const e6CounterfeitEmpty = fullE6ProcessProof();
e6CounterfeitEmpty.agent_server_processes = [];
e6CounterfeitEmpty.agent_server_process_collection =
  counterfeitCompleteEmptyCollection();
const e6Counterfeit = evaluateE6Proof(e6CounterfeitEmpty);
assert.equal(e6Counterfeit.exit, 2);
assert.equal(e6Counterfeit.output.status, 'MISSING');
const e4CounterfeitEmpty = structuredClone(baseRecord);
e4CounterfeitEmpty.runtime_inspection.agent_server.processes = [];
e4CounterfeitEmpty.runtime_inspection.agent_server.process_collection =
  counterfeitCompleteEmptyCollection();
const e4Counterfeit = evaluate(e4CounterfeitEmpty);
assert.equal(e4Counterfeit.exit, 2);
assert.equal(e4Counterfeit.output.status, 'MISSING');
const positive = evaluate(baseRecord);
assert.equal(positive.exit, 0);
const incompleteAgentCollection = structuredClone(baseRecord);
incompleteAgentCollection.runtime_inspection.agent_server.process_collection.complete = false;
assert.deepEqual(evaluate(incompleteAgentCollection), {
  exit: 2,
  output: {
    suite: 'E4',
    status: 'MISSING',
    code: 2,
    reason: 'agent_server process collection is missing or incomplete',
  },
});
const unknownAgentRuntimeAbsent = structuredClone(baseRecord);
unknownAgentRuntimeAbsent.runtime_inspection.agent_server.process_collection.complete = false;
unknownAgentRuntimeAbsent.runtime_inspection.agent_server.process_collection.stable = false;
unknownAgentRuntimeAbsent.runtime_inspection.agent_server.process_collection.snapshots[0].enoent_count = 1;
unknownAgentRuntimeAbsent.runtime_inspection.agent_server.process_collection.snapshots[0].error_class =
  'enoent';
unknownAgentRuntimeAbsent.runtime_inspection.paseo_runtime.processes = [
  { pid: 7, identity: 'other' },
];
unknownAgentRuntimeAbsent.runtime_inspection.paseo_runtime.process_collection =
  completeProcessCollection(
    unknownAgentRuntimeAbsent.runtime_inspection.paseo_runtime.processes,
  );
assert.deepEqual(evaluate(unknownAgentRuntimeAbsent), {
  exit: 1,
  output: {
    suite: 'E4',
    status: 'FAIL',
    code: 1,
    reason: 'runtime ownership proposition failed',
    failures: ['runtime_paseo_process_missing'],
  },
});
const invalidAgentRuntimeAbsent = structuredClone(unknownAgentRuntimeAbsent);
invalidAgentRuntimeAbsent.runtime_inspection.agent_server.process_collection =
  completeProcessCollection([
    { pid: 9, identity: 'other', unknown_field: true },
  ]);
invalidAgentRuntimeAbsent.runtime_inspection.agent_server.processes = [
  { pid: 9, identity: 'other', unknown_field: true },
];
const invalidAgentEvaluation = evaluate(invalidAgentRuntimeAbsent);
assert.equal(invalidAgentEvaluation.exit, 2);
assert.equal(invalidAgentEvaluation.output.status, 'MISSING');
const tamperedAgentProcess = structuredClone(baseRecord);
tamperedAgentProcess.runtime_inspection.agent_server.processes[0].unknown_field = true;
assert.deepEqual(evaluate(tamperedAgentProcess), {
  exit: 2,
  output: {
    suite: 'E4',
    status: 'MISSING',
    code: 2,
    reason: 'agent_server process collection is missing or incomplete',
  },
});
const incompleteRuntimeCollection = structuredClone(baseRecord);
incompleteRuntimeCollection.runtime_inspection.paseo_runtime.process_collection.snapshots[0].enoent_count = 1;
incompleteRuntimeCollection.runtime_inspection.paseo_runtime.process_collection.complete = false;
assert.deepEqual(evaluate(incompleteRuntimeCollection), {
  exit: 0,
  output: {
    suite: 'E4',
    status: 'PASS',
    code: 0,
    reason:
      'effective and running topology establish external runtime ownership',
  },
});
const agentPaseo = structuredClone(baseRecord);
const strongAgentProcess = enumerateNumericProcessRecords({
  procEntries: ['1'],
  readComm: () => 'node\n',
  readStatus: () => processStatus,
  readCmdline: () => `${strongPaseoArgv.join('\u0000')}\u0000`,
});
agentPaseo.runtime_inspection.agent_server.processes = strongAgentProcess;
rebindProcessCollection(agentPaseo.runtime_inspection.agent_server);
assert.equal(
  JSON.stringify(strongAgentProcess).includes(strongPaseoArgv[0]),
  false,
);
let activeAgentSnapshot = -1;
const activeAgentInspection = collectProcessSnapshots({
  listProcEntries: () => {
    activeAgentSnapshot += 1;
    return activeAgentSnapshot === 0 ? ['1', '2'] : ['1'];
  },
  readComm: () => 'node\n',
  readStatus: (pid) =>
    `Name:\tfixture\nUid:\t1000\t1000\t1000\t1000\nPPid:\t${pid === '1' ? 0 : 999}\n`,
  readCmdline: (pid) =>
    `${
      activeAgentSnapshot === 0 && pid === '1'
        ? strongPaseoArgv.join('\u0000')
        : activeAgentSnapshot === 0
          ? 'Paseo Daemon'
          : 'carrier'
    }\u0000`,
});
assert.equal(activeAgentSnapshot, 1);
assert.equal(activeAgentInspection.process_collection.complete, false);
assert.equal(
  JSON.stringify(activeAgentInspection.processes).includes(strongPaseoArgv[0]),
  false,
);
const activeAgentPaseo = structuredClone(baseRecord);
activeAgentPaseo.runtime_inspection.agent_server.processes =
  activeAgentInspection.processes;
activeAgentPaseo.runtime_inspection.agent_server.process_collection =
  activeAgentInspection.process_collection;
assert.deepEqual(evaluate(activeAgentPaseo), {
  exit: 1,
  output: {
    suite: 'E4',
    status: 'FAIL',
    code: 1,
    reason: 'runtime ownership proposition failed',
    failures: ['agent_server_paseo_process'],
  },
});
let titleOnlySnapshot = -1;
const titleOnlyInspection = collectProcessSnapshots({
  listProcEntries: () => {
    titleOnlySnapshot += 1;
    return ['3'];
  },
  readComm: () => 'node\n',
  readStatus: () =>
    'Name:\tfixture\nUid:\t1000\t1000\t1000\t1000\nPPid:\t999\n',
  readCmdline: () => 'Paseo Daemon\u0000',
});
assert.equal(titleOnlySnapshot, 1);
const titleOnlyRecord = structuredClone(baseRecord);
titleOnlyRecord.runtime_inspection.agent_server.processes =
  titleOnlyInspection.processes;
titleOnlyRecord.runtime_inspection.agent_server.process_collection =
  titleOnlyInspection.process_collection;
assert.deepEqual(evaluate(titleOnlyRecord), {
  exit: 2,
  output: {
    suite: 'E4',
    status: 'MISSING',
    code: 2,
    reason: 'agent_server process collection is missing or incomplete',
  },
});
let cycleSnapshot = -1;
const cycleWithoutStrongInspection = collectProcessSnapshots({
  listProcEntries: () => {
    cycleSnapshot += 1;
    return ['4', '5'];
  },
  readComm: () => 'node\n',
  readStatus: (pid) =>
    `Name:\tfixture\nUid:\t1000\t1000\t1000\t1000\nPPid:\t${pid === '4' ? 5 : 4}\n`,
  readCmdline: (pid) =>
    `${pid === '4' ? 'Paseo Supervisor' : 'Paseo Daemon'}\u0000`,
});
const cycleWithoutStrongRecord = structuredClone(baseRecord);
cycleWithoutStrongRecord.runtime_inspection.agent_server.processes =
  cycleWithoutStrongInspection.processes;
cycleWithoutStrongRecord.runtime_inspection.agent_server.process_collection =
  cycleWithoutStrongInspection.process_collection;
assert.deepEqual(evaluate(cycleWithoutStrongRecord), {
  exit: 2,
  output: {
    suite: 'E4',
    status: 'MISSING',
    code: 2,
    reason: 'agent_server process collection is missing or incomplete',
  },
});
let runtimeCorruptSnapshot = -1;
const runtimeStrongCorruptInspection = collectProcessSnapshots({
  listProcEntries: () => {
    runtimeCorruptSnapshot += 1;
    return ['6', '7'];
  },
  readComm: () => 'node\n',
  readStatus: (pid) =>
    `Name:\tfixture\nUid:\t1000\t1000\t1000\t1000\nPPid:\t${pid === '6' ? 0 : 999}\n`,
  readCmdline: (pid) =>
    `${pid === '6' ? strongPaseoArgv.join('\u0000') : 'Paseo Daemon'}\u0000`,
});
const runtimeStrongCorruptRecord = structuredClone(baseRecord);
runtimeStrongCorruptRecord.runtime_inspection.paseo_runtime.processes =
  runtimeStrongCorruptInspection.processes;
runtimeStrongCorruptRecord.runtime_inspection.paseo_runtime.process_collection =
  runtimeStrongCorruptInspection.process_collection;
assert.equal(runtimeStrongCorruptInspection.process_collection.complete, false);
assert.deepEqual(evaluate(runtimeStrongCorruptRecord), {
  exit: 0,
  output: {
    suite: 'E4',
    status: 'PASS',
    code: 0,
    reason:
      'effective and running topology establish external runtime ownership',
  },
});
let runtimeFirstStrongSnapshot = -1;
const runtimeFirstStrongInspection = collectProcessSnapshots({
  listProcEntries: () => {
    runtimeFirstStrongSnapshot += 1;
    return ['11'];
  },
  readComm: () => 'node\n',
  readStatus: () => 'Name:\tfixture\nUid:\t1000\t1000\t1000\t1000\nPPid:\t0\n',
  readCmdline: () =>
    `${
      runtimeFirstStrongSnapshot === 0
        ? strongPaseoArgv.join('\u0000')
        : 'carrier'
    }\u0000`,
});
const runtimeFirstStrongRecord = structuredClone(baseRecord);
runtimeFirstStrongRecord.runtime_inspection.paseo_runtime.processes =
  runtimeFirstStrongInspection.processes;
runtimeFirstStrongRecord.runtime_inspection.paseo_runtime.process_collection =
  runtimeFirstStrongInspection.process_collection;
assert.deepEqual(evaluate(runtimeFirstStrongRecord), {
  exit: 0,
  output: {
    suite: 'E4',
    status: 'PASS',
    code: 0,
    reason:
      'effective and running topology establish external runtime ownership',
  },
});
let runtimeSecondStrongSnapshot = -1;
const runtimeSecondStrongInspection = collectProcessSnapshots({
  listProcEntries: () => {
    runtimeSecondStrongSnapshot += 1;
    return ['8'];
  },
  readComm: () => 'node\n',
  readStatus: () => 'Name:\tfixture\nUid:\t1000\t1000\t1000\t1000\nPPid:\t0\n',
  readCmdline: () =>
    `${
      runtimeSecondStrongSnapshot === 1
        ? strongPaseoArgv.join('\u0000')
        : 'carrier'
    }\u0000`,
});
assert.equal(runtimeSecondStrongSnapshot, 1);
assert.deepEqual(runtimeSecondStrongInspection.processes, [
  { pid: 8, identity: 'paseo-daemon' },
]);
const runtimeSecondStrongRecord = structuredClone(baseRecord);
runtimeSecondStrongRecord.runtime_inspection.paseo_runtime.processes =
  runtimeSecondStrongInspection.processes;
runtimeSecondStrongRecord.runtime_inspection.paseo_runtime.process_collection =
  runtimeSecondStrongInspection.process_collection;
assert.deepEqual(evaluate(runtimeSecondStrongRecord), {
  exit: 0,
  output: {
    suite: 'E4',
    status: 'PASS',
    code: 0,
    reason:
      'effective and running topology establish external runtime ownership',
  },
});
let changedNoWitnessSnapshot = -1;
const changedNoWitnessInspection = collectProcessSnapshots({
  listProcEntries: () => {
    changedNoWitnessSnapshot += 1;
    return changedNoWitnessSnapshot === 0 ? ['9'] : ['10'];
  },
  readComm: () => 'node\n',
  readStatus: () => 'Name:\tfixture\nUid:\t1000\t1000\t1000\t1000\nPPid:\t0\n',
  readCmdline: () => 'carrier\u0000',
});
const changedNoWitnessRecord = structuredClone(baseRecord);
changedNoWitnessRecord.runtime_inspection.paseo_runtime.processes =
  changedNoWitnessInspection.processes;
changedNoWitnessRecord.runtime_inspection.paseo_runtime.process_collection =
  changedNoWitnessInspection.process_collection;
assert.deepEqual(evaluate(changedNoWitnessRecord), {
  exit: 2,
  output: {
    suite: 'E4',
    status: 'MISSING',
    code: 2,
    reason: 'paseo_runtime process collection is missing or incomplete',
  },
});
assert.deepEqual(evaluate(agentPaseo), {
  exit: 1,
  output: {
    suite: 'E4',
    status: 'FAIL',
    code: 1,
    reason: 'runtime ownership proposition failed',
    failures: ['agent_server_paseo_process'],
  },
});
const incompleteAgentPaseo = structuredClone(agentPaseo);
incompleteAgentPaseo.runtime_inspection.agent_server.process_collection.complete = false;
assert.deepEqual(evaluate(incompleteAgentPaseo), {
  exit: 1,
  output: {
    suite: 'E4',
    status: 'FAIL',
    code: 1,
    reason: 'runtime ownership proposition failed',
    failures: ['agent_server_paseo_process'],
  },
});
const agentPaseoWithIncompleteRuntime = structuredClone(agentPaseo);
agentPaseoWithIncompleteRuntime.runtime_inspection.paseo_runtime.processes = [
  { pid: 1, identity: 'other' },
];
rebindProcessCollection(
  agentPaseoWithIncompleteRuntime.runtime_inspection.paseo_runtime,
);
agentPaseoWithIncompleteRuntime.runtime_inspection.paseo_runtime.process_collection.complete = false;
assert.deepEqual(evaluate(agentPaseoWithIncompleteRuntime), {
  exit: 1,
  output: {
    suite: 'E4',
    status: 'FAIL',
    code: 1,
    reason: 'runtime ownership proposition failed',
    failures: ['agent_server_paseo_process'],
  },
});
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
  { pid: 1, identity: 'other' },
];
rebindProcessCollection(stateMutation.runtime_inspection.paseo_runtime);
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
const incompleteStateMutation = structuredClone(stateMutation);
incompleteStateMutation.runtime_inspection.paseo_runtime.process_collection.complete = false;
assert.deepEqual(evaluate(incompleteStateMutation), {
  exit: 2,
  output: {
    suite: 'E4',
    status: 'MISSING',
    code: 2,
    reason: 'paseo_runtime process collection is missing or incomplete',
  },
});
const noPaseoMutation = structuredClone(baseRecord);
noPaseoMutation.mutation = {
  name: 'remove-paseo-daemon-process',
  source: 'scripts/foundation/phase-c-e4-no-paseo-process.yaml',
  operational_overlays: ['scripts/foundation/phase-c-e4-no-ports.yaml'],
};
noPaseoMutation.runtime_inspection.paseo_runtime.processes = [
  { pid: 1, identity: 'other' },
];
rebindProcessCollection(noPaseoMutation.runtime_inspection.paseo_runtime);
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
const incompleteNoPaseoMutation = structuredClone(noPaseoMutation);
incompleteNoPaseoMutation.runtime_inspection.paseo_runtime.process_collection.complete = false;
assert.deepEqual(evaluate(incompleteNoPaseoMutation), {
  exit: 2,
  output: {
    suite: 'E4',
    status: 'MISSING',
    code: 2,
    reason: 'paseo_runtime process collection is missing or incomplete',
  },
});
const incompleteNoPaseoEvaluation = evaluate(incompleteNoPaseoMutation);
const incompleteNoPaseoStandaloneOutput = [];
const incompleteNoPaseoStandaloneExit = [];
const incompleteNoPaseoStandaloneCode = await executeStandaloneMutation({
  runMutation: async () =>
    assertMutationEvaluatorOutcome({
      evaluationExit: incompleteNoPaseoEvaluation.exit,
      evaluated: incompleteNoPaseoEvaluation.output,
      expectedExit: 1,
      expectedStatus: 'FAIL',
      expectedFailure: 'runtime_paseo_process_missing',
      mode: 'missing-paseo-process',
    }),
  output: (value) => incompleteNoPaseoStandaloneOutput.push(value),
  exit: (code) => incompleteNoPaseoStandaloneExit.push(code),
});
assert.equal(incompleteNoPaseoStandaloneCode, 2);
assert.deepEqual(incompleteNoPaseoStandaloneExit, [2]);
assert.equal(
  JSON.parse(incompleteNoPaseoStandaloneOutput[0]).status,
  'MISSING',
);
const wrapperOnlyMutation = structuredClone(baseRecord);
wrapperOnlyMutation.runtime_inspection.paseo_runtime.processes = [
  { pid: 1, identity: 'paseo-runtime-launcher' },
];
rebindProcessCollection(wrapperOnlyMutation.runtime_inspection.paseo_runtime);
const wrapperOnlyEvaluation = evaluate(wrapperOnlyMutation);
assert.deepEqual(wrapperOnlyEvaluation, noPaseoEvaluation);
assert.deepEqual(wrapperOnlyEvaluation.output.failures, [
  'runtime_paseo_process_missing',
]);
assert.equal(
  wrapperOnlyMutation.runtime_inspection.paseo_runtime.processes.some(
    (process) => process.identity === 'paseo-runtime-launcher',
  ),
  true,
);
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
