import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  collectServiceProcesses,
  enumerateNumericProcessRecords,
  exactServiceContainerId,
  isPaseoExecutableProcess,
  parseProcessRecords,
} from './lib/phase-c-process-inspection.mjs';

const containerId = 'a'.repeat(64);
const calls = [];
const run = (command, commandFields, options) => {
  calls.push({ command, commandFields, options });
  if (commandFields.includes('ps')) return { stdout: `${containerId}\n` };
  return {
    stdout: JSON.stringify([
      { pid: 1000, uid: 1000, comm: 'paseo' },
      { pid: 1001, uid: 1000, comm: 'node' },
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
    { pid: 1000, uid: 1000, comm: 'paseo' },
    { pid: 1001, uid: 1000, comm: 'node' },
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
assert.doesNotMatch(
  calls[1].commandFields[4],
  /(?:top|cmdline|environ|args=)/iu,
);

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
  `Name:\t${name}\nState:\tR (running)\nUid:\t${uid}\t${uid}\t${uid}\t${uid}\n`;
assert.deepEqual(
  enumerateNumericProcessRecords({
    procEntries: ['self', '12', '13', 'thread-self'],
    readComm: (pid) => `${pid === '13' ? 'paseo' : 'node'}\n`,
    readStatus(pid) {
      if (pid === '12') {
        const error = new Error('process disappeared');
        error.code = 'ENOENT';
        throw error;
      }
      return status('ignored', 1000);
    },
  }),
  [{ pid: 13, uid: 1000, comm: 'paseo' }],
);
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
    }),
  (error) => error.code === 'EACCES',
);
assert.throws(
  () =>
    enumerateNumericProcessRecords({
      procEntries: ['self'],
      readComm: () => 'node\n',
      readStatus: () => status('node', 1000),
    }),
  /process_records_empty/u,
);

assert.throws(() => parseProcessRecords(''), /process_json_empty/u);
assert.throws(() => parseProcessRecords('not-json'), /process_json_invalid/u);
assert.throws(() => parseProcessRecords('[]'), /process_records_empty/u);
assert.throws(() => parseProcessRecords('{"pid":1}'), /process_records_empty/u);
assert.throws(
  () =>
    parseProcessRecords('[{"pid":1,"uid":1000,"comm":"paseo","extra":true}]'),
  /process_record_schema_invalid/u,
);
assert.throws(
  () =>
    parseProcessRecords(
      '[{"pid":1,"uid":1000,"comm":"paseo"},{"pid":1,"uid":1000,"comm":"node"}]',
    ),
  /process_pid_duplicate/u,
);
assert.deepEqual(
  parseProcessRecords(
    '[{"pid":2,"uid":1000,"comm":"node"},{"pid":1,"uid":1000,"comm":"paseo"}]',
  ),
  [
    { pid: 2, uid: 1000, comm: 'node' },
    { pid: 1, uid: 1000, comm: 'paseo' },
  ],
);
assert.equal(isPaseoExecutableProcess({ comm: 'paseo' }), true);
assert.equal(isPaseoExecutableProcess({ comm: '/usr/local/bin/paseo' }), true);
assert.equal(isPaseoExecutableProcess({ comm: 'paseo-runtime' }), false);
assert.equal(isPaseoExecutableProcess({ comm: 'node' }), false);

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
assert.doesNotMatch(source, /(?:cmdline|environ|args=)/iu);
assert.doesNotMatch(source, /procps/iu);
assert.match(source, /exec/iu);
assert.match(source, /Uid:/u);
assert.match(source, /\/comm/u);
const harnessSource = readFileSync(
  resolve(import.meta.dirname, 'phase-c-harness.mjs'),
  'utf8',
);
for (const guardedSource of [source, harnessSource]) {
  assert.doesNotMatch(guardedSource, /docker[\s\S]{0,80}\btop\b/iu);
  assert.doesNotMatch(
    guardedSource,
    /\/proc\/[^'"`\s]+\/(?:cmdline|environ|cgroup|fd)(?:['"`\/]|$)/iu,
  );
  assert.doesNotMatch(guardedSource, /args=/iu);
  assert.doesNotMatch(guardedSource, /<\(/u);
}

process.stdout.write(
  `${JSON.stringify({ status: 'PASS', exact_container_id: true, fields: ['pid', 'uid', 'comm'], enoent_skipped: true, raw_exit_preserved: 23 })}\n`,
);
