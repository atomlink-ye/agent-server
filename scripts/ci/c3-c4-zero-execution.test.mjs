import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  INDEPENDENT_EXPECTED_RULES,
  ZERO_EXECUTION_KINDS,
  zeroExecutionMarker,
  zeroExecutionOutcome,
} from './c3-c4-zero-execution.mjs';

const node = process.execPath;
const script = fileURLToPath(new URL('./c3-c4-zero-execution.mjs', import.meta.url));

function direct(kind, observedCount, expectedCount, observedSource = 'actual-ledger', expectedProvenance = 'fixture-manifest', unavailableClass = 'instrument') {
  return zeroExecutionOutcome({
    kind,
    observedCount,
    independentExpectedCount: expectedCount,
    expectedRule: INDEPENDENT_EXPECTED_RULES[kind],
    observedCountSource: observedSource,
    expectedProvenance,
    unavailableClass,
  });
}

describe('C3 neutral zero-execution comparison', () => {
  it('allows an independently declared empty rule to observe zero', () => {
    assert.deepEqual(direct('e8-browser', 0, 0), { process: 0, marker: null });
  });

  it('maps expected zero with an unexpected observation to process 1', () => {
    assert.deepEqual(direct('e8-browser', 1, 0), { process: 1, marker: null });
  });

  it('maps missing instrument and target evidence to distinct process-2 markers', () => {
    assert.deepEqual(direct('e8-browser', 0, 1, 'actual-summary', 'fixed-rule', 'instrument'), {
      process: 2,
      marker: zeroExecutionMarker('e8-browser', 'instrument'),
    });
    assert.deepEqual(direct('e8-browser', 0, 1, 'actual-summary', 'fixed-rule', 'target-unavailable'), {
      process: 2,
      marker: zeroExecutionMarker('e8-browser', 'target-unavailable'),
    });
  });

  it('rejects unknown, missing, or non-independent count provenance', () => {
    assert.equal(direct('not-c3', 0, 0).process, 2);
    assert.equal(direct('e8-browser', 0, 0, 'same', 'same').process, 2);
    assert.equal(direct('e8-browser', 0, 0, '', 'fixture-manifest').process, 2);
  });

  it('runs the production CLI duals for every closed kind with an independent rule', () => {
    for (const kind of Object.values(ZERO_EXECUTION_KINDS)) {
      const run = spawnSync(node, [
        script, kind, '--observed', '0', '--expected', '0', '--subclass', 'instrument',
      ], { encoding: null });
      assert.equal(run.status, 0);
      assert.deepEqual(run.stdout, Buffer.alloc(0));
      assert.deepEqual(run.stderr, Buffer.alloc(0));
    }
  });

  it('emits the neutral exact subclass marker for missing declared evidence', () => {
    const run = spawnSync(node, [
      script, 'c3-classifier', '--observed', '0', '--expected', '12', '--subclass', 'instrument',
    ], { encoding: null });
    assert.equal(run.status, 2);
    assert.deepEqual(run.stdout, Buffer.from(`${zeroExecutionMarker('c3-classifier', 'instrument')}\n`));
    assert.deepEqual(run.stderr, Buffer.alloc(0));
  });
});
