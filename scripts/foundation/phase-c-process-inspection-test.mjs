import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  collectServiceProcesses,
  exactServiceContainerId,
  isPaseoExecutableProcess,
  parseProcessUserComm,
} from './lib/phase-c-process-inspection.mjs';

const containerId = 'a'.repeat(64);
const calls = [];
const run = (command, commandFields, options) => {
  calls.push({ command, commandFields, options });
  if (commandFields.includes('ps')) return { stdout: `${containerId}\n` };
  return { stdout: '1000 paseo\nnode node\n' };
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
    { user: '1000', comm: 'paseo' },
    { user: 'node', comm: 'node' },
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
assert.deepEqual(calls[1].commandFields, [
  'top',
  containerId,
  '-eo',
  'user=,comm=',
]);
const serializedCalls = JSON.stringify(calls);
assert.equal(serializedCalls.includes('args='), false);
assert.equal(serializedCalls.includes('"-f"'), false);
assert.equal(serializedCalls.toLowerCase().includes('env'), false);

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
assert.deepEqual(parseProcessUserComm('1000 /usr/local/bin/paseo\n'), [
  { user: '1000', comm: '/usr/local/bin/paseo' },
]);
assert.throws(() => parseProcessUserComm('1000 paseo extra\n'), /process_row/u);
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
assert.equal(source.includes("'args='"), false);
assert.equal(source.includes("'-f'"), false);
assert.equal(/Config\.Env|inspect.*env/iu.test(source), false);

process.stdout.write(
  `${JSON.stringify({ status: 'PASS', exact_container_id: true, fields: ['user', 'comm'], raw_exit_preserved: 23 })}\n`,
);
