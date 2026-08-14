import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  EXPECTED_MIN_COUNTS,
  ZERO_EXECUTION_KINDS,
  zeroExecutionOutcome,
  zeroExecutionMarker,
} from './c3-c4-zero-execution.mjs';

const node = process.execPath;
const script = fileURLToPath(new URL('./c3-c4-zero-execution.mjs', import.meta.url));

describe('C3/C4 zero-execution guard', () => {
  it('declares a closed nonempty execution universe', () => {
    const kinds = Object.values(ZERO_EXECUTION_KINDS);
    assert.equal(new Set(kinds).size, kinds.length);
    assert.equal(kinds.length, 10);
    for (const kind of kinds) assert.ok(EXPECTED_MIN_COUNTS[kind] >= 1);
  });

  it('maps every canonical zero arm through the production guard to process 2', () => {
    for (const kind of Object.values(ZERO_EXECUTION_KINDS)) {
      const expected = EXPECTED_MIN_COUNTS[kind];
      const run = spawnSync(node, [script, kind, '--count', '0', '--expected', String(expected)], { encoding: null });
      assert.equal(run.status, 2);
      assert.deepEqual(run.stdout, Buffer.from(`${zeroExecutionMarker(kind, expected)}\n`));
      assert.deepEqual(run.stderr, Buffer.alloc(0));
      assert.deepEqual(zeroExecutionOutcome({ kind, observedCount: 0, expectedMinCount: expected }), {
        process: 2,
        marker: zeroExecutionMarker(kind, expected),
      });
    }
  });

  it('passes only when observed execution reaches the declared minimum', () => {
    for (const [kind, expected] of Object.entries(EXPECTED_MIN_COUNTS)) {
      const run = spawnSync(node, [script, kind, '--count', String(expected), '--expected', String(expected)], { encoding: null });
      assert.equal(run.status, 0);
      assert.deepEqual(run.stdout, Buffer.alloc(0));
      assert.deepEqual(run.stderr, Buffer.alloc(0));
    }
  });

  it('rejects unknown kinds and invalid counts as distinct process-2 evidence', () => {
    const unknown = zeroExecutionOutcome({ kind: 'not-c3-c4', observedCount: 0, expectedMinCount: 1 });
    assert.equal(unknown.process, 2);
    assert.match(unknown.marker, /^c3_c4_zero_execution_invalid:kind=/u);
    const malformed = zeroExecutionOutcome({ kind: ZERO_EXECUTION_KINDS.C4_DOM, observedCount: -1, expectedMinCount: 1 });
    assert.equal(malformed.process, 2);
    assert.match(malformed.marker, /^c3_c4_zero_execution_invalid:count=/u);
  });
});
