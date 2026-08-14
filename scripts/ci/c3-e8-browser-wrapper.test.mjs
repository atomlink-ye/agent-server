import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  OBSERVATION_MISSING_MARKER,
  browserSummaryOutcome,
  parseVitestSummary,
} from './c3-e8-browser-wrapper.mjs';

const positive = 'Test Files 1 passed (1)\nTests 2 passed (2)';

describe('C3/E8 browser summary wrapper', () => {
  it('parses the real fixed-summary shape and requires two tests', () => {
    const summary = parseVitestSummary(positive);
    assert.deepEqual(summary, { files: 1, fileTotal: 1, tests: 2, skipped: 0, todo: 0, testTotal: 2 });
    assert.deepEqual(browserSummaryOutcome(summary), { process: 0, marker: null });
  });

  it('parses failed summaries so assertion failures remain process-1', () => {
    assert.deepEqual(
      parseVitestSummary('Test Files 1 failed (1)\nTests 1 failed | 1 passed (2)'),
      { files: 0, fileTotal: 1, tests: 1, skipped: 0, todo: 0, testTotal: 2 },
    );
  });

  it('maps zero, all-skip, and truncated summaries to exact process-2 markers', () => {
    for (const summary of [
      'Test Files 0 passed (0)\nTests 0 passed (0)',
      'Test Files 1 passed (1)\nTests 2 passed 2 skipped (2)',
      'Test Files 1 passed (1)\nTests 2 passed',
    ]) {
      const outcome = browserSummaryOutcome(parseVitestSummary(summary));
      assert.equal(outcome.process, 2);
      assert.match(outcome.marker, /^c3_e8_browser_zero_execution:/u);
    }
  });

  it('reserves complete-summary observation missing for process 2', () => {
    assert.equal(OBSERVATION_MISSING_MARKER,
      'c3_e8_observation_missing:reason=request-ledger-incomplete');
  });
});
