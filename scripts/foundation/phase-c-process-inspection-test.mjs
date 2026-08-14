import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  classifyProcessIdentity,
  collectServiceProcesses,
  collectProcessSnapshots,
  hashProcessRecords,
  enumerateNumericProcessRecords,
  exactServiceContainerId,
  isPaseoExecutableProcess,
  isPaseoProcess,
  parseProcessRecords,
  parseProcessCollection,
  validateProcessEvidence,
} from './lib/phase-c-process-inspection.mjs';

const directInvocation = [
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
const shebangInvocation = [
  '/usr/bin/node',
  '--disable-warning=DEP0040',
  '/opt/provider-toolchain-volume/current/paseo-toolchain/node_modules/.bin/paseo',
  ...directInvocation.slice(1),
];
const resolvedShebangInvocation = [
  '/usr/bin/node',
  '--disable-warning=DEP0040',
  '/opt/provider-toolchain-volume/current/paseo-toolchain/node_modules/@getpaseo/cli/bin/paseo',
  ...directInvocation.slice(1),
];
const wrapperInvocation = [
  '/usr/local/bin/node',
  '/workspace/scripts/dev/paseo-runtime.mjs',
];

assert.equal(classifyProcessIdentity(directInvocation), 'paseo-daemon');
assert.equal(classifyProcessIdentity(shebangInvocation), 'paseo-daemon');
assert.equal(
  classifyProcessIdentity(resolvedShebangInvocation),
  'paseo-daemon',
);
assert.equal(
  classifyProcessIdentity([
    '/usr/bin/node',
    '/opt/provider-toolchain-volume/current/paseo-toolchain/node_modules/.bin/paseo',
    ...directInvocation.slice(1),
  ]),
  'other',
);
assert.equal(
  classifyProcessIdentity([
    '/usr/bin/node',
    '--experimental-default-type=module',
    ...shebangInvocation.slice(2),
  ]),
  'other',
);
assert.equal(
  classifyProcessIdentity([
    '/usr/bin/node',
    '--disable-warning=DEP0040',
    '--extra-flag',
    ...shebangInvocation.slice(2),
  ]),
  'other',
);
assert.equal(
  classifyProcessIdentity([
    '/usr/bin/node',
    ...shebangInvocation.slice(2, 3),
    '--disable-warning=DEP0040',
    ...shebangInvocation.slice(3),
  ]),
  'other',
);
assert.equal(
  classifyProcessIdentity(wrapperInvocation),
  'paseo-runtime-launcher',
);
assert.equal(
  classifyProcessIdentity([
    '/opt/provider-toolchain-volume/current/paseo-toolchain/node_modules/.bin/paseo-evil',
    ...directInvocation.slice(1),
  ]),
  'other',
);
assert.equal(
  classifyProcessIdentity([
    '/opt/provider-toolchain-volume/current/paseo-toolchain/node_modules/.bin/paseo',
    ...directInvocation.slice(1, 4),
    '127.0.0.1:0',
    ...directInvocation.slice(5),
  ]),
  'other',
);
assert.equal(classifyProcessIdentity(['Paseo Supervisor']), 'paseo-supervisor');
assert.equal(classifyProcessIdentity(['Paseo Daemon']), 'paseo-daemon');
assert.equal(classifyProcessIdentity(['Paseo Daemon Spoof']), 'other');
assert.equal(classifyProcessIdentity(['paseo', 'start']), 'other');

const status = (uid, ppid) =>
  `Name:\tfixture\nUid:\t${uid}\t${uid}\t${uid}\t${uid}\nPPid:\t${ppid}\n`;
const fixtureRecords = ({ pids, parents, cmdlines, comms, uids } = {}) =>
  enumerateNumericProcessRecords({
    procEntries: pids,
    readComm: (pid) => `${comms?.[pid] ?? 'node'}\n`,
    readStatus: (pid) => status(uids?.[pid] ?? 1000, parents[pid] ?? 0),
    readCmdline: (pid) => cmdlines[pid] ?? 'carrier\u0000',
  });

// Strong CLI qualifies directly; title roles are promoted through any finite
// ancestry, with no Docker-init, direct-parent, or UID requirement.
assert.equal(
  fixtureRecords({
    pids: ['9'],
    parents: { 9: 0 },
    cmdlines: { 9: `${directInvocation.join('\u0000')}\u0000` },
  })[0].identity,
  'paseo-daemon',
);
assert.equal(
  fixtureRecords({
    pids: ['8', '9'],
    parents: { 8: 9, 9: 0 },
    cmdlines: {
      8: 'Paseo Supervisor\u0000',
      9: `${directInvocation.join('\u0000')}\u0000`,
    },
  })[0].identity,
  'paseo-supervisor',
);
assert.equal(
  fixtureRecords({
    pids: ['10', '11', '12'],
    parents: { 10: 0, 11: 10, 12: 11 },
    cmdlines: {
      10: `${directInvocation.join('\u0000')}\u0000`,
      11: 'carrier\u0000',
      12: 'Paseo Daemon\u0000',
    },
  }).at(-1).identity,
  'paseo-daemon',
);
assert.deepEqual(
  fixtureRecords({
    pids: ['10', '11', '12', '13'],
    parents: { 10: 0, 11: 10, 12: 11, 13: 12 },
    cmdlines: {
      10: `${directInvocation.join('\u0000')}\u0000`,
      11: 'Paseo Supervisor\u0000',
      12: 'carrier\u0000',
      13: 'Paseo Daemon\u0000',
    },
    uids: { 10: 2000, 11: 1000, 12: 3000, 13: 4000 },
  }),
  [
    { pid: 10, identity: 'paseo-daemon' },
    { pid: 11, identity: 'paseo-supervisor' },
    { pid: 12, identity: 'other' },
    { pid: 13, identity: 'paseo-daemon' },
  ],
);

// Wrapper-only runtime is not a real Paseo process and cannot satisfy runtime
// positive, while agent-negative still treats the exact wrapper separately.
const wrapperOnly = fixtureRecords({
  pids: ['1'],
  parents: { 1: 0 },
  cmdlines: { 1: `${wrapperInvocation.join('\u0000')}\u0000` },
});
assert.equal(wrapperOnly[0].identity, 'paseo-runtime-launcher');
assert.equal(isPaseoExecutableProcess(wrapperOnly[0]), false);
assert.equal(isPaseoProcess(wrapperOnly[0]), true);

// Titles without an anchored strong CLI, lookalike paths, and all ancestry
// failure modes reject boundedly rather than hanging.
assert.equal(
  fixtureRecords({
    pids: ['20'],
    parents: { 20: 0 },
    cmdlines: { 20: 'Paseo Daemon\u0000' },
  })[0].identity,
  'other',
);
assert.throws(
  () =>
    fixtureRecords({
      pids: ['21'],
      parents: { 21: 999 },
      cmdlines: { 21: 'Paseo Daemon\u0000' },
    }),
  /process_ancestry_missing/u,
);
assert.throws(
  () =>
    fixtureRecords({
      pids: ['22'],
      parents: { 22: 22 },
      cmdlines: { 22: 'Paseo Supervisor\u0000' },
    }),
  /process_ancestry_cycle/u,
);
assert.throws(
  () =>
    fixtureRecords({
      pids: ['23', '24'],
      parents: { 23: 24, 24: 23 },
      cmdlines: { 23: 'Paseo Supervisor\u0000', 24: 'Paseo Daemon\u0000' },
    }),
  /process_ancestry_cycle/u,
);
assert.ok(
  fixtureRecords({
    pids: ['25'],
    parents: { 25: 0 },
    cmdlines: {
      25: `/opt/provider-toolchain-volume/current/paseo-toolchain/node_modules/.bin/paseo-evil\u0000`,
    },
  }).every((record) => record.identity === 'other'),
);

const enoent = Object.assign(new Error('process disappeared'), {
  code: 'ENOENT',
});
assert.deepEqual(
  enumerateNumericProcessRecords({
    procEntries: ['30', '31'],
    readComm: (pid) => {
      if (pid === '30') throw enoent;
      return 'node\n';
    },
    readStatus: () => status(1000, 0),
    readCmdline: () => 'carrier\u0000',
  }),
  [{ pid: 31, identity: 'other' }],
);
assert.throws(
  () =>
    enumerateNumericProcessRecords({
      procEntries: ['32'],
      readComm: () => {
        const error = new Error('permission denied');
        error.code = 'EACCES';
        throw error;
      },
      readStatus: () => status(1000, 0),
      readCmdline: () => '',
    }),
  (error) => error.code === 'EACCES',
);

function deterministicCollection({
  lists,
  errorSnapshot = null,
  errorCode = null,
}) {
  let snapshotIndex = -1;
  const observed = collectProcessSnapshots({
    listProcEntries: () => {
      snapshotIndex += 1;
      return lists[snapshotIndex];
    },
    readComm: () => {
      if (snapshotIndex === errorSnapshot) {
        const error = new Error('bounded fixture read failure');
        error.code = errorCode;
        throw error;
      }
      return 'node\n';
    },
    readStatus: () => status(1000, 0),
    readCmdline: () => 'carrier\u0000',
  });
  assert.equal(snapshotIndex, 1);
  return observed;
}
function ancestryCollection({ pids, parents, cmdlines }) {
  let snapshot = -1;
  return collectProcessSnapshots({
    listProcEntries: () => {
      snapshot += 1;
      return pids;
    },
    readComm: () => 'node\n',
    readStatus: (pid) => status(1000, parents[pid] ?? 0),
    readCmdline: (pid) => `${cmdlines[pid]}\u0000`,
  });
}
function changingCollection({ lists, cmdlines }) {
  let snapshot = -1;
  const observed = collectProcessSnapshots({
    listProcEntries: () => {
      snapshot += 1;
      return lists[snapshot];
    },
    readComm: () => 'node\n',
    readStatus: () => status(1000, 0),
    readCmdline: (pid) => `${cmdlines[snapshot][pid]}\u0000`,
  });
  assert.equal(snapshot, 1);
  return observed;
}
const strongWithCorruptTitle = ancestryCollection({
  pids: ['60', '61'],
  parents: { 60: 0, 61: 999 },
  cmdlines: {
    60: directInvocation.join('\u0000'),
    61: 'Paseo Daemon',
  },
});
assert.equal(
  strongWithCorruptTitle.processes.some(
    (process) => process.identity === 'paseo-daemon' && process.pid === 60,
  ),
  true,
);
assert.equal(strongWithCorruptTitle.process_collection.complete, false);
assert.equal(
  strongWithCorruptTitle.process_collection.snapshots[0].integrity_error_count,
  1,
);
const cycleWithStrong = ancestryCollection({
  pids: ['62', '63', '64'],
  parents: { 62: 0, 63: 64, 64: 63 },
  cmdlines: {
    62: directInvocation.join('\u0000'),
    63: 'Paseo Supervisor',
    64: 'Paseo Daemon',
  },
});
assert.equal(
  cycleWithStrong.processes.some(
    (process) => process.identity === 'paseo-daemon',
  ),
  true,
);
assert.equal(cycleWithStrong.process_collection.complete, false);
const cycleWithoutStrong = ancestryCollection({
  pids: ['65', '66'],
  parents: { 65: 66, 66: 65 },
  cmdlines: { 65: 'Paseo Supervisor', 66: 'Paseo Daemon' },
});
assert.equal(
  cycleWithoutStrong.processes.every((process) => process.identity === 'other'),
  true,
);
assert.equal(cycleWithoutStrong.process_collection.complete, false);
const completeCollection = deterministicCollection({
  lists: [['50'], ['50']],
});
assert.equal(completeCollection.process_collection.stable, true);
assert.equal(completeCollection.process_collection.complete, true);
assert.equal(
  completeCollection.processes.every(
    (process) => !isPaseoExecutableProcess(process),
  ),
  true,
);
assert.deepEqual(
  completeCollection.process_collection.snapshots.map((snapshot) => [
    snapshot.numeric_count,
    snapshot.emitted_count,
    snapshot.enoent_count,
    snapshot.read_error_count,
  ]),
  [
    [1, 1, 0, 0],
    [1, 1, 0, 0],
  ],
);
const firstStrongCollection = changingCollection({
  lists: [['70'], ['70']],
  cmdlines: [{ 70: directInvocation.join('\u0000') }, { 70: 'carrier' }],
});
assert.deepEqual(firstStrongCollection.processes, [
  { pid: 70, identity: 'paseo-daemon' },
]);
assert.equal(firstStrongCollection.process_collection.complete, false);
assert.equal(
  firstStrongCollection.process_collection.emitted_count,
  firstStrongCollection.processes.length,
);
assert.equal(
  firstStrongCollection.process_collection.record_hash,
  hashProcessRecords(firstStrongCollection.processes),
);
const secondStrongCollection = changingCollection({
  lists: [['71'], ['71']],
  cmdlines: [{ 71: 'carrier' }, { 71: directInvocation.join('\u0000') }],
});
assert.deepEqual(secondStrongCollection.processes, [
  { pid: 71, identity: 'paseo-daemon' },
]);
assert.equal(secondStrongCollection.process_collection.complete, false);

// Direct witnesses survive unreadable comm/Uid/PPid adapters. The collection
// is incomplete for absence, but the independent strong witness is retained.
const unreadableDirectCollection = collectProcessSnapshots({
  listProcEntries: () => ['73'],
  readCmdline: () => `${directInvocation.join('\u0000')}\u0000`,
  readComm: () => {
    const error = new Error('comm unreadable');
    error.code = 'EACCES';
    throw error;
  },
  readStatus: () => {
    const error = new Error('Uid/PPid unreadable');
    error.code = 'EACCES';
    throw error;
  },
});
assert.deepEqual(unreadableDirectCollection.processes, [
  { pid: 73, identity: 'paseo-daemon' },
]);
assert.equal(unreadableDirectCollection.process_collection.complete, false);
assert.equal(
  unreadableDirectCollection.process_collection.snapshots[0].read_error_count,
  2,
);
const unreadableLauncherCollection = collectProcessSnapshots({
  listProcEntries: () => ['74'],
  readCmdline: () => `${wrapperInvocation.join('\u0000')}\u0000`,
  readComm: () => {
    const error = new Error('comm unreadable');
    error.code = 'EACCES';
    throw error;
  },
  readStatus: () => {
    const error = new Error('status unreadable');
    error.code = 'EACCES';
    throw error;
  },
});
assert.deepEqual(unreadableLauncherCollection.processes, [
  { pid: 74, identity: 'paseo-runtime-launcher' },
]);
assert.equal(unreadableLauncherCollection.process_collection.complete, false);

assert.equal(validateProcessEvidence(unreadableDirectCollection), true);
const selfConsistentTamper = structuredClone(unreadableDirectCollection);
selfConsistentTamper.processes = [{ pid: 73, identity: 'other' }];
selfConsistentTamper.process_collection.emitted_count = 1;
selfConsistentTamper.process_collection.record_hash = hashProcessRecords(
  selfConsistentTamper.processes,
);
assert.equal(validateProcessEvidence(selfConsistentTamper), true);
const counterfeitCompleteEmpty = {
  processes: [],
  process_collection: {
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
  },
};
assert.equal(validateProcessEvidence(counterfeitCompleteEmpty), false);
const counterfeitSnapshotCount = structuredClone(unreadableDirectCollection);
counterfeitSnapshotCount.process_collection.complete = true;
counterfeitSnapshotCount.process_collection.stable = true;
counterfeitSnapshotCount.process_collection.snapshots.forEach((snapshot) => {
  snapshot.enoent_count = 0;
  snapshot.read_error_count = 0;
  snapshot.error_class = 'none';
  snapshot.numeric_count = 2;
  snapshot.emitted_count = 2;
});
assert.equal(validateProcessEvidence(counterfeitSnapshotCount), false);
assert.equal(
  validateProcessEvidence({
    processes: [{ pid: 73, identity: 'other', duplicate: true }],
    process_collection: selfConsistentTamper.process_collection,
  }),
  false,
);

const changedNoWitnessCollection = changingCollection({
  lists: [['72'], ['73']],
  cmdlines: [{ 72: 'carrier' }, { 73: 'carrier' }],
});
assert.deepEqual(
  changedNoWitnessCollection.processes.map((process) => process.pid),
  [72, 73],
);
assert.equal(changedNoWitnessCollection.process_collection.complete, false);
for (const errorSnapshot of [0, 1]) {
  const enoentCollection = deterministicCollection({
    lists: [['51'], ['51']],
    errorSnapshot,
    errorCode: 'ENOENT',
  });
  assert.equal(enoentCollection.process_collection.complete, false);
}
const changedPidCollection = deterministicCollection({
  lists: [['52'], ['53']],
});
assert.equal(changedPidCollection.process_collection.stable, false);
assert.equal(changedPidCollection.process_collection.complete, false);
const readErrorCollection = deterministicCollection({
  lists: [['54'], ['54']],
  errorSnapshot: 1,
  errorCode: 'EACCES',
});
assert.equal(readErrorCollection.process_collection.complete, false);
assert.equal(
  readErrorCollection.process_collection.snapshots[1].error_class,
  'read_error',
);
assert.throws(
  () =>
    parseProcessCollection({
      snapshots: [
        {
          numeric_count: 2,
          emitted_count: 1,
          enoent_count: 0,
          read_error_count: 0,
          integrity_error_count: 0,
          error_class: 'none',
        },
        {
          numeric_count: 2,
          emitted_count: 1,
          enoent_count: 0,
          read_error_count: 0,
          integrity_error_count: 0,
          error_class: 'none',
        },
      ],
      emitted_count: 1,
      record_hash: '0'.repeat(64),
      stable: true,
      complete: true,
    }),
  /process_collection_complete_invalid/u,
);

// Raw argv, including secrets beyond argv[2], never enter the persisted record.
const secret = 'SECRET_ARGV2_SHOULD_NEVER_BE_EMITTED';
const secretInvocation = [...directInvocation];
secretInvocation[2] = secret;
assert.equal(
  JSON.stringify(
    fixtureRecords({
      pids: ['40'],
      parents: { 40: 0 },
      cmdlines: { 40: `${secretInvocation.join('\u0000')}\u0000` },
    }),
  ).includes(secret),
  false,
);

assert.throws(() => parseProcessRecords(''), /process_json_empty/u);
assert.throws(() => parseProcessRecords('not-json'), /process_json_invalid/u);
assert.deepEqual(parseProcessRecords('[]'), []);
assert.throws(
  () => parseProcessRecords('[{"pid":1,"identity":"other","extra":true}]'),
  /process_record_schema_invalid/u,
);
assert.throws(
  () =>
    parseProcessRecords(
      '[{"pid":1,"identity":"other"},{"pid":1,"identity":"other"}]',
    ),
  /process_pid_duplicate/u,
);
assert.throws(
  () => parseProcessRecords('[{"pid":0,"identity":"other"}]'),
  /process_record_value_invalid/u,
);
assert.deepEqual(
  parseProcessRecords(
    '[{"pid":2,"identity":"other"},{"pid":1,"identity":"other"}]',
  ),
  [
    { pid: 2, identity: 'other' },
    { pid: 1, identity: 'other' },
  ],
);

const containerId = 'a'.repeat(64);
const calls = [];
const run = (command, commandFields) => {
  calls.push({ command, commandFields });
  if (commandFields.includes('ps')) return { stdout: `${containerId}\n` };
  return {
    stdout: JSON.stringify({
      processes: [{ pid: 1000, identity: 'paseo-daemon' }],
      process_collection: {
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
        emitted_count: 1,
        record_hash: hashProcessRecords([
          { pid: 1000, identity: 'paseo-daemon' },
        ]),
        stable: true,
        complete: true,
      },
    }),
  };
};
const collectedServiceProcesses = collectServiceProcesses({
  run,
  composeCommand: ['compose', '-p', 'phasec_fixture'],
  service: 'paseo-runtime',
  identity: 'runtime',
});
assert.deepEqual(collectedServiceProcesses.processes, [
  {
    pid: 1000,
    identity: 'paseo-daemon',
  },
]);
assert.equal(collectedServiceProcesses.process_collection.emitted_count, 1);
assert.equal(
  collectedServiceProcesses.process_collection.record_hash,
  hashProcessRecords(collectedServiceProcesses.processes),
);
assert.match(calls[1].commandFields[4], /readdirSync\('\/proc'\)/u);
assert.doesNotMatch(calls[1].commandFields[4], /(?:top|environ|args=)/iu);
assert.equal(JSON.stringify(calls).includes(secret), false);

const childFailure = Object.assign(new Error('child failed'), { raw_exit: 23 });
const failureCalls = [];
assert.throws(
  () =>
    collectServiceProcesses({
      run(command, commandFields) {
        failureCalls.push({ command, commandFields });
        if (commandFields.includes('ps')) return { stdout: `${containerId}\n` };
        throw childFailure;
      },
      composeCommand: ['compose', '-p', 'phasec_failure'],
      service: 'paseo-runtime',
      identity: 'failure',
    }),
  (error) => error === childFailure && error.raw_exit === 23,
);
assert.equal(failureCalls.length, 2);

assert.throws(() => exactServiceContainerId('', 'runtime'), /container_count/u);
assert.throws(
  () =>
    exactServiceContainerId(`${containerId}\n${'b'.repeat(64)}\n`, 'runtime'),
  /container_count/u,
);
assert.throws(
  () => exactServiceContainerId('not-an-id\n', 'runtime'),
  /container_id_invalid/u,
);

const source = readFileSync(
  resolve(import.meta.dirname, 'lib/phase-c-process-inspection.mjs'),
  'utf8',
);
const harnessSource = readFileSync(
  resolve(import.meta.dirname, 'phase-c-harness.mjs'),
  'utf8',
);
for (const guardedSource of [source, harnessSource]) {
  assert.doesNotMatch(guardedSource, /docker[\s\S]{0,80}\btop\b/iu);
  assert.doesNotMatch(
    guardedSource,
    /\/proc\/[^'"`\s]+\/(?:environ|cgroup|fd)(?:['"`\/]|$)/iu,
  );
  assert.doesNotMatch(guardedSource, /args=/iu);
  assert.doesNotMatch(guardedSource, /<\(/u);
}
assert.doesNotMatch(source, /docker\s+top/iu);
assert.doesNotMatch(source, /(?:environ|args=)/iu);
assert.doesNotMatch(source, /procps/iu);
assert.match(source, /\/comm/u);
assert.match(source, /\/cmdline/u);
assert.match(source, /PPid:/u);

process.stdout.write(
  `${JSON.stringify({ status: 'PASS', exact_toolchain_paths: true, ancestry_cycle_safe: true, wrapper_excluded_from_runtime_positive: true, two_snapshot_completeness: true, enoent_incomplete: true, non_enoent_incomplete: true, direct_witness_survives_metadata_errors: true, raw_argv_not_emitted: true, fields: ['pid', 'identity'] })}\n`,
);
