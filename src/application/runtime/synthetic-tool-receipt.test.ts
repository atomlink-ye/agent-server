import { describe, expect, it } from 'vitest';

import { createSyntheticToolReceipt } from './synthetic-tool-receipt.js';

function grant(runId: string, turnId = `turn-${runId}`) {
  return {
    turn: { id: turnId },
    activeTurn: { taskId: `task-${runId}`, runId, contextEpoch: 'epoch' },
  } as any;
}

describe('synthetic tool receipt', () => {
  it('fails closed until exactly one completion exists for the same active run', () => {
    const receipt = createSyntheticToolReceipt();
    const first = grant('run-1');
    const stock = { toolRef: 'synthetic_stock_snapshot', grant: first };

    expect(receipt.hasExactlyOne(stock)).toBe(false);
    receipt.recordSuccessfulInvocation(stock);
    expect(receipt.hasExactlyOne(stock)).toBe(true);
    receipt.recordSuccessfulInvocation(stock);
    expect(receipt.hasExactlyOne(stock)).toBe(false);
    expect(receipt.hasExactlyOne({ ...stock, grant: grant('run-2') })).toBe(
      false,
    );
  });

  it('does not create a receipt for a turn without active provenance', () => {
    const receipt = createSyntheticToolReceipt();
    const noActiveTurn = { turn: { id: 'turn-1' } } as any;

    receipt.recordSuccessfulInvocation({
      grant: noActiveTurn,
      toolRef: 'synthetic_stock_snapshot',
    });
    expect(
      receipt.hasExactlyOne({
        grant: noActiveTurn,
        toolRef: 'synthetic_stock_snapshot',
      }),
    ).toBe(false);
  });
});
