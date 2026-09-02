import { describe, expect, it } from 'vitest';

import {
  MAX_POSITION,
  POSITION_STEP,
  planCardMove,
  type CardPlacement,
} from './board-move';

function card(workItemId: string, position: number): CardPlacement {
  return { workItemId, position };
}

describe('planCardMove', () => {
  it('drops the first card of an empty column on the step ladder', () => {
    expect(
      planCardMove({ workItemId: 'a', destination: [], index: 0 }),
    ).toEqual({
      placements: [card('a', POSITION_STEP)],
      renumbered: false,
    });
  });

  it('takes the integer midpoint between two neighbours', () => {
    const plan = planCardMove({
      workItemId: 'moved',
      destination: [card('x', 1000), card('y', 3000)],
      index: 1,
    });
    expect(plan).toEqual({
      placements: [card('moved', 2000)],
      renumbered: false,
    });
  });

  it('floors an odd midpoint so the position stays an integer', () => {
    const plan = planCardMove({
      workItemId: 'moved',
      destination: [card('x', 1000), card('y', 1003)],
      index: 1,
    });
    expect(plan.placements).toEqual([card('moved', 1001)]);
    expect(Number.isInteger(plan.placements[0]!.position)).toBe(true);
  });

  it('steps past the last card when appending', () => {
    const plan = planCardMove({
      workItemId: 'moved',
      destination: [card('x', 1000), card('y', 2000)],
      index: 2,
    });
    expect(plan.placements).toEqual([card('moved', 3000)]);
  });

  it('steps below the first card when prepending', () => {
    const plan = planCardMove({
      workItemId: 'moved',
      destination: [card('x', 5000)],
      index: 0,
    });
    expect(plan.placements).toEqual([card('moved', 4000)]);
  });

  it('sorts the destination before reading neighbours', () => {
    const plan = planCardMove({
      workItemId: 'moved',
      destination: [card('y', 4000), card('x', 2000)],
      index: 1,
    });
    expect(plan.placements).toEqual([card('moved', 3000)]);
  });

  it('clamps an index past the end of the column', () => {
    const plan = planCardMove({
      workItemId: 'moved',
      destination: [card('x', 1000)],
      index: 99,
    });
    expect(plan.placements).toEqual([card('moved', 2000)]);
  });

  it('renumbers the column when adjacent neighbours leave no integer gap', () => {
    const plan = planCardMove({
      workItemId: 'moved',
      destination: [card('x', 1000), card('y', 1001)],
      index: 1,
    });
    expect(plan.renumbered).toBe(true);
    // `x` already sits at its renumbered slot, so only the rows that actually
    // move are written back.
    expect(plan.placements).toEqual([card('moved', 2000), card('y', 3000)]);
  });

  it('renumbers rather than prepending below zero', () => {
    const plan = planCardMove({
      workItemId: 'moved',
      destination: [card('x', 0)],
      index: 0,
    });
    expect(plan.renumbered).toBe(true);
    expect(plan.placements).toEqual([card('moved', 1000), card('x', 2000)]);
  });

  it('renumbers rather than appending past the position ceiling', () => {
    const plan = planCardMove({
      workItemId: 'moved',
      destination: [card('x', MAX_POSITION)],
      index: 1,
    });
    expect(plan.renumbered).toBe(true);
    expect(plan.placements).toEqual([card('x', 1000), card('moved', 2000)]);
  });

  it('leaves already-correct siblings out of a renumber', () => {
    const plan = planCardMove({
      workItemId: 'moved',
      destination: [card('x', 1000), card('y', 1001), card('z', 4000)],
      index: 1,
    });
    expect(plan.renumbered).toBe(true);
    // `x` (1000) and `z` (4000) already sit at their renumbered slots.
    expect(plan.placements).toEqual([card('moved', 2000), card('y', 3000)]);
  });

  it('keeps every renumbered position a positive integer within bounds', () => {
    const destination = Array.from({ length: 40 }, (_, slot) =>
      card(`c${slot}`, 1000 + slot),
    );
    const plan = planCardMove({
      workItemId: 'moved',
      destination,
      index: 5,
    });
    expect(plan.renumbered).toBe(true);
    for (const placement of plan.placements) {
      expect(Number.isInteger(placement.position)).toBe(true);
      expect(placement.position).toBeGreaterThan(0);
      expect(placement.position).toBeLessThanOrEqual(MAX_POSITION);
    }
  });

  it('always reports a position for the moved card', () => {
    const plan = planCardMove({
      workItemId: 'moved',
      destination: [card('x', 1000), card('y', 1001)],
      index: 2,
    });
    expect(
      plan.placements.some((placement) => placement.workItemId === 'moved'),
    ).toBe(true);
  });
});
