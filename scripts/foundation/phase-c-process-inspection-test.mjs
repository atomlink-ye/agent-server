import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  classifyProcessIdentity,
  collectServiceProcesses,
  enumerateNumericProcessRecords,
  exactServiceContainerId,
  isPaseoExecutableProcess,
  isPaseoProcess,
  parseProcessRecords,
} from './lib/phase-c-process-inspection.mjs';

const daemonInvocation = [
  '/opt/bin/paseo',
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
const supervisorInvocation = [
  '/usr/local/bin/node',
  '/workspace/scripts/dev/paseo-runtime.mjs',
];
assert.equal(classifyProcessIdentity(daemonInvocation), 'paseo-daemon');
assert.equal(
  classifyProcessIdentity(supervisorInvocation),
  'paseo-runtime-launcher',
);
assert.equal(classifyProcessIdentity(['Paseo Supervisor']), 'paseo-supervisor');
assert.equal(classifyProcessIdentity(['Paseo Daemon']), 'paseo-daemon');
assert.equal(classifyProcessIdentity(['Paseo Daemon Spoof']), 'other');
assert.equal(
  classifyProcessIdentity(['/workspace/scripts/dev/with-paseo.mjs']),
  'other',
);
assert.equal(classifyProcessIdentity(['paseo', 'carrier']), 'other');
assert.equal(classifyProcessIdentity(['node', 'server.js']), 'other');

const containerId = 'a'.repeat(64);
const calls = [];
const run = (command, commandFields, options) => {
  calls.push({ command, commandFields, options });
  if (commandFields.includes('ps')) return { stdout: `${containerId}\n` };
  return {
    stdout: JSON.stringify([
      {
        pid: 1000,
        ppid: 999,
        uid: 1000,
        comm: 'paseo',
        identity: 'paseo-daemon',
      },
      {
        pid: 1001,
        ppid: 999,
        uid: 1000,
        comm: 'node',
        identity: 'paseo-supervisor',
      },
    ]),
  };
};
const observed = collectServiceProcesses({
  run,
  composeCommand: ['compose', '-p', 'phasec_fixture'],
  service: 'paseo-runtime',
  identity: 'runtime',
});
assert.deepEqual(observed, {
  containerId,
  processes: [
    {
      pid: 1000,
      ppid: 999,
      uid: 1000,
      comm: 'paseo',
      identity: 'paseo-daemon',
    },
    {
      pid: 1001,
      ppid: 999,
      uid: 1000,
      comm: 'node',
      identity: 'paseo-supervisor',
    },
  ],
});
assert.deepEqual(calls[0].commandFields, [
  'compose',
  '-p',
  'phasec_fixture',
  'ps',
  '-q',
  'paseo-runtime',
]);
assert.deepEqual(calls[1].commandFields.slice(0, 4), [
  'exec',
  containerId,
  'node',
  '-e',
]);
assert.match(calls[1].commandFields[4], /readdirSync\('\/proc'\)/u);
assert.match(calls[1].commandFields[4], /'\/comm'/u);
assert.match(calls[1].commandFields[4], /'\/cmdline'/u);
assert.doesNotMatch(calls[1].commandFields[4], /(?:top|environ|args=)/iu);

const serializedCalls = JSON.stringify(calls);
assert.equal(serializedCalls.includes('args='), false);
assert.equal(serializedCalls.includes('"-f"'), false);
assert.equal(serializedCalls.toLowerCase().includes('docker top'), false);

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

const status = (name, uid) =>
  `Name:\t${name}\nState:\tR (running)\nUid:\t${uid}\t${uid}\t${uid}\t${uid}\nPPid:\t999\n`;
const statusWithPpid = (name, uid, ppid) =>
  status(name, uid).replace('PPid:\t999', `PPid:\t${ppid}`);
const longComm = `${'Paseo Daemon'.padEnd(70, 'x')}\n`;
const raceError = Object.assign(new Error('process disappeared'), {
  code: 'ENOENT',
});
assert.deepEqual(
  enumerateNumericProcessRecords({
    procEntries: ['self', '1', '10', '12', '13', '14', '16'],
    readComm: (pid) => {
      if (pid === '13') return longComm;
      if (pid === '1') return 'docker-init\n';
      if (pid === '16') return 'Paseo Supervisor\n';
      return `${pid === '14' || pid === '15' ? 'paseo' : 'node'}\n`;
    },
    readStatus(pid) {
      if (pid === '12') throw raceError;
      if (pid === '1') return statusWithPpid('ignored', 1000, 0);
      if (pid === '10') return statusWithPpid('ignored', 1000, 1);
      if (pid === '13' || pid === '14')
        return statusWithPpid('ignored', 1000, 16);
      if (pid === '16') return statusWithPpid('ignored', 1000, 10);
      return status('ignored', 1000);
    },
    readCmdline(pid) {
      if (pid === '13') return 'Paseo Daemon\u0000';
      if (pid === '14') return daemonInvocation.join('\u0000') + '\u0000';
      if (pid === '16') return 'Paseo Supervisor\u0000';
      if (pid === '10') return supervisorInvocation.join('\u0000') + '\u0000';
      return 'docker-init\u0000';
    },
  }),
  [
    {
      pid: 1,
      ppid: 0,
      uid: 1000,
      comm: 'docker-init',
      identity: 'other',
    },
    {
      pid: 10,
      ppid: 1,
      uid: 1000,
      comm: 'node',
      identity: 'paseo-runtime-launcher',
    },
    {
      pid: 13,
      ppid: 16,
      uid: 1000,
      comm: 'Paseo Daemon'.padEnd(64, 'x'),
      identity: 'paseo-daemon',
    },
    { pid: 14, ppid: 16, uid: 1000, comm: 'paseo', identity: 'paseo-daemon' },
    {
      pid: 16,
      ppid: 10,
      uid: 1000,
      comm: 'Paseo Supervisor',
      identity: 'paseo-supervisor',
    },
  ],
);
const spoofTitle = enumerateNumericProcessRecords({
  procEntries: ['1', '17', '18'],
  readComm: (pid) => (pid === '1' ? 'carrier' : 'Paseo Daemon'),
  readStatus: (pid) =>
    pid === '1'
      ? statusWithPpid('carrier', 1000, 0)
      : statusWithPpid('ignored', 1000, pid === '17' ? 1 : 17),
  readCmdline: (pid) =>
    pid === '17' ? 'Paseo Supervisor\u0000' : 'Paseo Daemon\u0000',
});
assert.deepEqual(spoofTitle, [
  { pid: 1, ppid: 0, uid: 1000, comm: 'carrier', identity: 'other' },
  { pid: 17, ppid: 1, uid: 1000, comm: 'Paseo Daemon', identity: 'other' },
  { pid: 18, ppid: 17, uid: 1000, comm: 'Paseo Daemon', identity: 'other' },
]);
assert.equal(
  classifyProcessIdentity([
    ...daemonInvocation.slice(0, 6),
    '/runtime/SECRET_ARGV2_SHOULD_NEVER_BE_EMITTED',
    ...daemonInvocation.slice(7),
  ]),
  'paseo-daemon',
);
const secretRecord = enumerateNumericProcessRecords({
  procEntries: ['16'],
  readComm: () => 'paseo\n',
  readStatus: () => status('ignored', 1000),
  readCmdline: () => {
    const secretArgv = [...daemonInvocation];
    secretArgv[2] = 'SECRET_ARGV2_SHOULD_NEVER_BE_EMITTED';
    return secretArgv.join('\u0000');
  },
});
assert.equal(JSON.stringify(secretRecord).includes('SECRET_ARGV2'), false);
assert.equal(JSON.stringify(secretRecord).includes('cmdline'), false);
assert.throws(
  () =>
    enumerateNumericProcessRecords({
      procEntries: ['12'],
      readComm() {
        const error = new Error('permission denied');
        error.code = 'EACCES';
        throw error;
      },
      readStatus() {
        return status('ignored', 1000);
      },
      readCmdline: () => '',
    }),
  (error) => error.code === 'EACCES',
);
assert.throws(
  () =>
    enumerateNumericProcessRecords({
      procEntries: ['self'],
      readComm: () => 'node\n',
      readStatus: () => status('node', 1000),
      readCmdline: () => '',
    }),
  /process_records_empty/u,
);

assert.throws(() => parseProcessRecords(''), /process_json_empty/u);
assert.throws(() => parseProcessRecords('not-json'), /process_json_invalid/u);
assert.throws(() => parseProcessRecords('[]'), /process_records_empty/u);
assert.throws(() => parseProcessRecords('{"pid":1}'), /process_records_empty/u);
assert.throws(
  () =>
    parseProcessRecords(
      '[{"pid":1,"ppid":0,"uid":1000,"comm":"paseo","identity":"paseo-daemon","extra":true}]',
    ),
  /process_record_schema_invalid/u,
);
assert.throws(
  () =>
    parseProcessRecords(
      '[{"pid":1,"ppid":0,"uid":1000,"comm":"paseo","identity":"paseo-daemon"},{"pid":1,"ppid":0,"uid":1000,"comm":"node","identity":"other"}]',
    ),
  /process_pid_duplicate/u,
);
assert.throws(
  () =>
    parseProcessRecords(
      '[{"pid":1,"ppid":-1,"uid":1000,"comm":"node","identity":"other"}]',
    ),
  /process_record_value_invalid/u,
);
assert.deepEqual(
  parseProcessRecords(
    '[{"pid":2,"ppid":0,"uid":1000,"comm":"node","identity":"other"},{"pid":1,"ppid":0,"uid":1000,"comm":"paseo","identity":"paseo-daemon"}]',
  ),
  [
    { pid: 2, ppid: 0, uid: 1000, comm: 'node', identity: 'other' },
    { pid: 1, ppid: 0, uid: 1000, comm: 'paseo', identity: 'paseo-daemon' },
  ],
);
assert.equal(isPaseoExecutableProcess({ comm: 'paseo' }), false);
assert.equal(isPaseoProcess({ identity: 'paseo-runtime-launcher' }), true);
assert.equal(
  isPaseoExecutableProcess({ comm: 'launcher', identity: 'paseo-daemon' }),
  true,
);
assert.equal(isPaseoProcess({ identity: 'paseo-supervisor' }), true);
assert.equal(isPaseoProcess({ comm: 'paseo-runtime' }), false);
assert.equal(isPaseoProcess({ identity: 'other', comm: 'paseo' }), false);

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

const source = readFileSync(
  resolve(import.meta.dirname, 'lib/phase-c-process-inspection.mjs'),
  'utf8',
);
assert.doesNotMatch(source, /docker\s+top/iu);
assert.doesNotMatch(source, /(?:environ|args=)/iu);
assert.doesNotMatch(source, /procps/iu);
assert.match(source, /exec/iu);
assert.match(source, /Uid:/u);
assert.match(source, /\/comm/u);
assert.match(source, /\/cmdline/u);
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

process.stdout.write(
  `${JSON.stringify({ status: 'PASS', exact_container_id: true, fields: ['pid', 'ppid', 'uid', 'comm', 'identity'], identity_enum: ['paseo-runtime-launcher', 'paseo-supervisor', 'paseo-daemon', 'other'], enoent_skipped: true, raw_exit_preserved: 23, argv_secret_not_emitted: true })}\n`,
);
