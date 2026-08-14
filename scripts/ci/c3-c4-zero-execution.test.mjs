import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  SOURCE_OWNED_OPTIONAL_RULE,
  SOURCE_OWNED_RULES,
  ZERO_EXECUTION_KINDS,
  compareSourceOwnedRule,
  zeroExecutionMarker,
  zeroExecutionOutcome,
} from './c3-c4-zero-execution.mjs';

const node = process.execPath;
const script = fileURLToPath(new URL('./c3-c4-zero-execution.mjs', import.meta.url));

describe('C3 source-owned zero comparison', () => {
  it('derives expected counts from the source registry, never caller input', () => {
    const run = spawnSync(node, [script, 'e8-browser', '--observed', '2'], { encoding: null });
    assert.equal(run.status, 0);
    assert.deepEqual(run.stdout, Buffer.alloc(0));
    const rejected = spawnSync(node, [script, 'e8-browser', '--observed', '2', '--expected', '2'], { encoding: null });
    assert.equal(rejected.status, 2);
  });

  it('maps observed greater than expected to process 1', () => {
    assert.deepEqual(zeroExecutionOutcome({
      kind: 'e8-browser', observedCount: SOURCE_OWNED_RULES['e8-browser'].expectedCount + 1,
      observedCountSource: 'actual-ledger',
    }), { process: 1, marker: null });
  });

  it('maps observed less than expected to instrument process 2', () => {
    assert.deepEqual(zeroExecutionOutcome({
      kind: 'e8-browser', observedCount: 0, observedCountSource: 'actual-summary',
    }), { process: 2, marker: zeroExecutionMarker('e8-browser', 'instrument', 'observed-less-than-independent-rule') });
  });

  it('supports an explicitly source-owned optional rule with expected zero', () => {
    assert.deepEqual(compareSourceOwnedRule({
      kind: SOURCE_OWNED_OPTIONAL_RULE.id,
      rule: SOURCE_OWNED_OPTIONAL_RULE,
      observedCount: 0,
      observedCountSource: 'optional-business-observation',
      expectedProvenance: SOURCE_OWNED_OPTIONAL_RULE.provenance,
    }), { process: 0, marker: null });
    assert.deepEqual(compareSourceOwnedRule({
      kind: SOURCE_OWNED_OPTIONAL_RULE.id,
      rule: SOURCE_OWNED_OPTIONAL_RULE,
      observedCount: 1,
      observedCountSource: 'optional-business-observation',
      expectedProvenance: SOURCE_OWNED_OPTIONAL_RULE.provenance,
    }), { process: 1, marker: null });
  });

  it('fails closed when expected provenance and observed source are not independent', () => {
    assert.equal(zeroExecutionOutcome({
      kind: 'e8-browser', observedCount: 2, observedCountSource: SOURCE_OWNED_RULES['e8-browser'].provenance,
    }).process, 2);
    assert.equal(zeroExecutionOutcome({
      kind: 'c4-e10', observedCount: 0, observedCountSource: 'actual',
    }).process, 2);
  });

  it('keeps the production kind registry closed', () => {
    assert.equal(new Set(Object.values(ZERO_EXECUTION_KINDS)).size, 10);
  });
});
