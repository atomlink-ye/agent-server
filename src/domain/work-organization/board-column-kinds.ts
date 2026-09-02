/**
 * What a Board column MEANS, as opposed to what it is called.
 *
 * `product_work_board_columns.kind` is 'todo' | 'doing' | 'done', or null when
 * the column's meaning is unknown. A board titled "Backlog / In flight /
 * Shipped" stays unclassified on purpose rather than being guessed at: a wrong
 * guess silently moves someone's WorkItems.
 *
 * This exists because an agent can take ownership of a WorkItem and never
 * advance it, leaving a board that reads Todo while the work is finished and
 * reported in chat. The decision is a pure function so the one rule that
 * matters — never move a WorkItem backwards — is testable without a database.
 */

export const WORK_BOARD_COLUMN_KINDS = ['todo', 'doing', 'done'] as const;

export type WorkBoardColumnKind = (typeof WORK_BOARD_COLUMN_KINDS)[number];

export function isWorkBoardColumnKind(
  value: unknown,
): value is WorkBoardColumnKind {
  return (
    typeof value === 'string' &&
    (WORK_BOARD_COLUMN_KINDS as readonly string[]).includes(value)
  );
}

/** The column shape the claim decision needs; deliberately not the full row. */
export interface ClaimAdvanceColumn {
  readonly id: string;
  readonly position: number;
  readonly kind: WorkBoardColumnKind | null;
}

/**
 * The column a claim should advance the WorkItem into, or null to leave it put.
 *
 * Claiming is the moment work starts, so the board should read Doing. The move
 * only ever goes FORWARD:
 *
 * - no 'doing' column on this board → stay. Guessing which column meant Doing
 *   is exactly what the nullable kind exists to prevent.
 * - already in the doing column → stay (no churn).
 * - in a 'done' column → stay. Re-claiming finished work must never drag it
 *   back into progress; that rewrites history the humans on the board can see.
 * - current column is UNCLASSIFIED → stay. The board is using its own
 *   workflow, and moving out of a column we do not understand is the silent
 *   damage the null kind is there to avoid.
 *
 * With several 'doing' columns the leftmost (lowest position) wins, so the
 * choice is deterministic rather than dependent on row order.
 */
export function claimTargetColumn(input: {
  readonly columns: readonly ClaimAdvanceColumn[];
  readonly currentColumnId: string;
}): string | null {
  const current = input.columns.find(
    (column) => column.id === input.currentColumnId,
  );
  if (!current || current.kind !== 'todo') return null;
  const doing = input.columns
    .filter((column) => column.kind === 'doing')
    .sort((left, right) => left.position - right.position)[0];
  if (!doing || doing.id === input.currentColumnId) return null;
  return doing.id;
}

/**
 * Is this a column where a WorkItem counts as finished? Used when describing a
 * board to an agent, so "move it to a done column" stops being a guess at
 * column titles.
 */
export function isDoneColumn(
  column: Pick<ClaimAdvanceColumn, 'kind'>,
): boolean {
  return column.kind === 'done';
}
