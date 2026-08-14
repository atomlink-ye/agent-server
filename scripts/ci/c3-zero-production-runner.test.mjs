import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runZeroProductionArm } from './c3-zero-production-runner.mjs';
import { zeroExecutionMarker } from './c3-c4-zero-execution.mjs';

const node = process.execPath;
const script = fileURLToPath(new URL('./c3-zero-production-runner.mjs', import.meta.url));

describe('C3 production zero arms', () => {
  it('derives target-unavailable from a real missing target path', () => {
    const run = spawnSync(node, [script, 'e8-browser', '--target', '/tmp/c3-target-does-not-exist'], { encoding: null });
    assert.equal(run.status, 2);
    assert.deepEqual(run.stdout, Buffer.from(`${zeroExecutionMarker('e8-browser', 'target-unavailable', 'target-missing')}\n`));
    assert.deepEqual(run.stderr, Buffer.alloc(0));
  });

  it('derives instrument from a started production command without a count', async () => {
    const outcome = await runZeroProductionArm([
      'e8-browser', '--command', node, '-e', 'process.stdout.write("no-count\\n")',
    ]);
    assert.deepEqual(outcome, {
      process: 2,
      marker: zeroExecutionMarker('e8-browser', 'instrument', 'count-unavailable'),
    });
  });

  it('derives target-unavailable from a real ENOENT child spawn', async () => {
    const outcome = await runZeroProductionArm([
      'e8-browser', '--command', '/tmp/c3-command-does-not-exist',
    ]);
    assert.deepEqual(outcome, {
      process: 2,
      marker: zeroExecutionMarker('e8-browser', 'target-unavailable', 'spawn-failure'),
    });
  });

  it('rejects caller-provided expected and subclass literals at the production CLI', () => {
    const run = spawnSync(node, [script, 'e8-browser', '--observed', '0', '--expected', '0', '--subclass', 'instrument'], { encoding: null });
    assert.equal(run.status, 2);
  });
});
