/**
 * Optimistic card moves on a Board.
 *
 * Cumora's `moveCardOptimistic` interpolates a fractional sort key between
 * the two neighbours the card lands between — `(before + after) / 2`, or
 * `before + 1000` / `after - 1000` at the ends — patches its snapshot, then
 * reconciles against the server. This API's placement position is a
 * non-negative integer bounded at 1_000_000 (`normalizePosition` in
 * `src/application/work-organization/work-organization-service.ts`), so the
 * same idea has to land on integers: interpolate when an integer gap exists,
 * and renumber the destination column on the 1000-step ladder when it does
 * not. Renumbering is bounded to one column and only emits the rows whose
 * position actually changes.
 */
export const POSITION_STEP = 1000;
export const MAX_POSITION = 1_000_000;

export interface CardPlacement {
  readonly workItemId: string;
  readonly position: number;
}

export interface MovePlan {
  /** Placements to persist, in order. The moved card is always included. */
  readonly placements: readonly CardPlacement[];
  /** True when the whole destination column had to be renumbered. */
  readonly renumbered: boolean;
}

export function planCardMove(input: {
  readonly workItemId: string;
  /** Destination column contents, moved card excluded, ordered by position. */
  readonly destination: readonly CardPlacement[];
  /** Where the card lands in that ordering. */
  readonly index: number;
}): MovePlan {
  const siblings = [...input.destination].sort(
    (left, right) => left.position - right.position,
  );
  const index = Math.max(0, Math.min(input.index, siblings.length));
  const before = index > 0 ? siblings[index - 1] : undefined;
  const after = index < siblings.length ? siblings[index] : undefined;

  const candidate = interpolate(before?.position, after?.position);
  if (
    candidate !== null &&
    (before === undefined || candidate > before.position) &&
    (after === undefined || candidate < after.position)
  ) {
    return {
      placements: [{ workItemId: input.workItemId, position: candidate }],
      renumbered: false,
    };
  }

  return renumber(
    [
      ...siblings.slice(0, index),
      { workItemId: input.workItemId, position: -1 },
      ...siblings.slice(index),
    ],
    input.workItemId,
  );
}

function interpolate(
  before: number | undefined,
  after: number | undefined,
): number | null {
  if (before !== undefined && after !== undefined)
    return Math.floor((before + after) / 2);
  if (before !== undefined)
    return before + POSITION_STEP <= MAX_POSITION
      ? before + POSITION_STEP
      : null;
  if (after !== undefined)
    return after - POSITION_STEP >= 0 ? after - POSITION_STEP : null;
  return POSITION_STEP;
}

function renumber(
  ordered: readonly CardPlacement[],
  movedWorkItemId: string,
): MovePlan {
  const step = Math.max(1, Math.floor(MAX_POSITION / (ordered.length + 1)));
  const spaced = Math.min(step, POSITION_STEP);
  const placements: CardPlacement[] = [];
  ordered.forEach((entry, slot) => {
    const position = (slot + 1) * spaced;
    if (entry.position === position && entry.workItemId !== movedWorkItemId)
      return;
    placements.push({ workItemId: entry.workItemId, position });
  });
  return { placements, renumbered: true };
}
