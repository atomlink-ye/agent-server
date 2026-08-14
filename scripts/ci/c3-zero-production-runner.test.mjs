import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { zeroExecutionMarker } from './c3-c4-zero-execution.mjs';

const node = process.execPath;
const script = fileURLToPath(new URL('./c3-zero-production-runner.mjs', import.meta.url));
const runCli = (...args) => spawnSync(node, [script, ...args], { encoding: null });
const command = (source) => [node, '-e', source];
const marker = (kind, subclass, reason) => Buffer.from(`${zeroExecutionMarker(kind, subclass, reason)}\n`);

describe('C3 production zero arms', () => {
  it('derives target-unavailable from a real missing target path', () => {
    const run = runCli('e8-browser', '--target', '/tmp/c3-target-does-not-exist');
    assert.equal(run.status, 2);
    assert.deepEqual(run.stdout, marker('e8-browser', 'target-unavailable', 'target-missing'));
    assert.deepEqual(run.stderr, Buffer.alloc(0));
  });

  it('derives instrument from a started production command without a count', () => {
    const raw = Buffer.from('no-count\n');
    const run = runCli('e8-browser', '--command', ...command('process.stdout.write("no-count\\n")'));
    assert.equal(run.status, 2);
    assert.deepEqual(run.stdout, Buffer.concat([raw, marker('e8-browser', 'instrument', 'count-unavailable')]));
    assert.deepEqual(run.stderr, Buffer.alloc(0));
  });

  it('derives target-unavailable from a real ENOENT child spawn', () => {
    const run = runCli('e8-browser', '--command', '/tmp/c3-command-does-not-exist');
    assert.equal(run.status, 2);
    assert.deepEqual(run.stdout, marker('e8-browser', 'target-unavailable', 'spawn-failure'));
    assert.deepEqual(run.stderr, Buffer.alloc(0));
  });

  it('treats a real observed zero as an instrumented under-count for e8-browser', () => {
    const raw = Buffer.from('observed-count:0\n');
    const run = runCli('e8-browser', '--command', ...command('process.stdout.write("observed-count:0\\n")'));
    assert.equal(run.status, 2);
    assert.deepEqual(run.stdout, Buffer.concat([
      raw,
      marker('e8-browser', 'instrument', 'observed-less-than-independent-rule'),
    ]));
    assert.deepEqual(run.stderr, Buffer.alloc(0));
  });

  it('rejects duplicate observed-count lines from a started command', () => {
    const raw = Buffer.from('observed-count:0\nobserved-count:0\n');
    const run = runCli('e8-browser', '--command', ...command('process.stdout.write("observed-count:0\\nobserved-count:0\\n")'));
    assert.equal(run.status, 2);
    assert.deepEqual(run.stdout, Buffer.concat([raw, marker('e8-browser', 'instrument', 'count-unavailable')]));
  });

  it('rejects contradictory observed-count lines from a started command', () => {
    const raw = Buffer.from('observed-count:0\nobserved-count:1\n');
    const run = runCli('e8-browser', '--command', ...command('process.stdout.write("observed-count:0\\nobserved-count:1\\n")'));
    assert.equal(run.status, 2);
    assert.deepEqual(run.stdout, Buffer.concat([raw, marker('e8-browser', 'instrument', 'count-unavailable')]));
  });

  it('forwards child stdout/stderr bytes and frames a marker after non-newline stdout', () => {
    const stdoutBytes = [0xe2, 0x82, 0xac, 0x00];
    const stderrBytes = [0xff, 0x80, 0x0a];
    const source = [
      `process.stdout.write(Buffer.from([${stdoutBytes.join(',')}]))`,
      `process.stderr.write(Buffer.from([${stderrBytes.join(',')}]))`,
    ].join(';');
    const run = runCli('e8-browser', '--command', ...command(source));
    assert.equal(run.status, 2);
    assert.deepEqual(run.stdout, Buffer.concat([
      Buffer.from(stdoutBytes),
      Buffer.from('\n'),
      marker('e8-browser', 'instrument', 'count-unavailable'),
    ]));
    assert.deepEqual(run.stderr, Buffer.from(stderrBytes));
  });

  it('accepts the independently expected e8-browser count', () => {
    const raw = Buffer.from('observed-count:2\n');
    const run = runCli('e8-browser', '--command', ...command('process.stdout.write("observed-count:2\\n")'));
    assert.equal(run.status, 0);
    assert.deepEqual(run.stdout, raw);
    assert.deepEqual(run.stderr, Buffer.alloc(0));
  });

  it('rejects caller-provided expected and subclass literals at the production CLI', () => {
    const run = spawnSync(node, [script, 'e8-browser', '--observed', '0', '--expected', '0', '--subclass', 'instrument'], { encoding: null });
    assert.equal(run.status, 2);
  });
});
