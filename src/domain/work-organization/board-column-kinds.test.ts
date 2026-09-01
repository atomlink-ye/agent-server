import { describe, expect, it } from 'vitest';

import {
  claimTargetColumn,
  isWorkBoardColumnKind,
  type ClaimAdvanceColumn,
} from './board-column-kinds.js';

const todo: ClaimAdvanceColumn = { id: 'col-todo', position: 0, kind: 'todo' };
const doing: ClaimAdvanceColumn = {
  id: 'col-doing',
  position: 1,
  kind: 'doing',
};
const done: ClaimAdvanceColumn = { id: 'col-done', position: 2, kind: 'done' };
const board: readonly ClaimAdvanceColumn[] = [todo, doing, done];

describe('isWorkBoardColumnKind', () => {
  it('accepts only the three declared kinds', () => {
    expect(isWorkBoardColumnKind('todo')).toBe(true);
    expect(isWorkBoardColumnKind('doing')).toBe(true);
    expect(isWorkBoardColumnKind('done')).toBe(true);
    expect(isWorkBoardColumnKind('backlog')).toBe(false);
    expect(isWorkBoardColumnKind(null)).toBe(false);
    expect(isWorkBoardColumnKind('Todo')).toBe(false);
  });
});

describe('claimTargetColumn', () => {
  it('advances a Todo card into the Doing column', () => {
    expect(
      claimTargetColumn({ columns: board, currentColumnId: todo.id }),
    ).toBe(doing.id);
  });

  it('leaves a card that is already Doing alone', () => {
    expect(
      claimTargetColumn({ columns: board, currentColumnId: doing.id }),
    ).toBeNull();
  });

  it('never drags a Done card backwards into Doing', () => {
    expect(
      claimTargetColumn({ columns: board, currentColumnId: done.id }),
    ).toBeNull();
  });

  it('leaves a card in an unclassified column where it is', () => {
    const custom: readonly ClaimAdvanceColumn[] = [
      { id: 'col-flight', position: 0, kind: null },
      doing,
    ];
    expect(
      claimTargetColumn({ columns: custom, currentColumnId: 'col-flight' }),
    ).toBeNull();
  });

  it('stays put when the board declares no Doing column', () => {
    expect(
      claimTargetColumn({ columns: [todo, done], currentColumnId: todo.id }),
    ).toBeNull();
  });

  it('picks the leftmost Doing column when several are declared', () => {
    const columns: readonly ClaimAdvanceColumn[] = [
      todo,
      { id: 'col-doing-late', position: 5, kind: 'doing' },
      { id: 'col-doing-early', position: 1, kind: 'doing' },
    ];
    expect(claimTargetColumn({ columns, currentColumnId: todo.id })).toBe(
      'col-doing-early',
    );
  });

  it('stays put when the card is not on the supplied board at all', () => {
    expect(
      claimTargetColumn({ columns: board, currentColumnId: 'col-elsewhere' }),
    ).toBeNull();
  });
});
