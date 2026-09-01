import type {
  WorkBoardColumnDto,
  WorkItemCommentDto,
  WorkItemDto,
} from '@atomlink-ye/agent-server/product-contract';

/**
 * Forward-compatible readers for WorkItem/Board fields the parallel backend
 * Worker is adding (`mentions` on a WorkItem and on a comment, `kind` on a
 * Board column, and the claim bookkeeping behind the claim endpoint).
 *
 * Every reader answers `null` — not an empty value — while the field is
 * absent, so the UI can tell "the backend has not shipped this yet" apart
 * from "the backend shipped it and this card genuinely has none". That is the
 * same honesty rule the surface already applies to `unavailable` vs `ready`
 * but empty (see docs/frontend.md "Surface availability").
 *
 * These read through `unknown` on purpose: `src/contracts/work-organization.ts`
 * is backend scope for this change, so the shared schema does not describe
 * the new fields yet. Once it does, the DTO types gain them and these
 * readers keep returning the same values without an edit.
 */
function fields(value: object): Record<string, unknown> {
  return value as unknown as Record<string, unknown>;
}

function readStringArray(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  const entries = value.filter(
    (entry): entry is string => typeof entry === 'string' && entry.length > 0,
  );
  return entries.length === value.length ? entries : null;
}

function readNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Mentions the backend parsed out of a WorkItem's title/description. */
export function readMentionIds(
  item: WorkItemDto | WorkItemCommentDto,
): readonly string[] | null {
  return readStringArray(fields(item).mentions);
}

/** How many comments a WorkItem carries, when the projection reports it. */
export function readCommentCount(item: WorkItemDto): number | null {
  const raw = fields(item).comment_count;
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0
    ? Math.trunc(raw)
    : null;
}

export type BoardColumnKind = 'todo' | 'doing' | 'review' | 'done';

const COLUMN_KINDS: readonly BoardColumnKind[] = [
  'todo',
  'doing',
  'review',
  'done',
];

/** The column's declared kind, when the backend declares one. */
export function readColumnKind(
  column: WorkBoardColumnDto,
): BoardColumnKind | null {
  const raw = fields(column).kind;
  return typeof raw === 'string' &&
    (COLUMN_KINDS as readonly string[]).includes(raw)
    ? (raw as BoardColumnKind)
    : null;
}

const TITLE_KINDS: readonly (readonly [BoardColumnKind, RegExp])[] = [
  ['doing', /\b(doing|in[\s_-]?progress|wip|active)\b/i],
  ['review', /\b(review|in[\s_-]?review|qa)\b/i],
  ['done', /\b(done|complete[d]?|shipped)\b/i],
  ['todo', /\b(todo|to[\s_-]?do|backlog|inbox|ready)\b/i],
];

/**
 * A column's kind, falling back to its title while the backend field is
 * absent. The fallback is a guess and is only used to pick a claim target,
 * never to relabel what the user typed.
 */
export function columnKind(column: WorkBoardColumnDto): BoardColumnKind | null {
  const declared = readColumnKind(column);
  if (declared) return declared;
  for (const [kind, pattern] of TITLE_KINDS)
    if (pattern.test(column.title)) return kind;
  return null;
}

/** The column a claimed card belongs in, or null when the Board has none. */
export function findDoingColumn(
  columns: readonly WorkBoardColumnDto[],
): WorkBoardColumnDto | null {
  return columns.find((column) => columnKind(column) === 'doing') ?? null;
}

export interface ClaimState {
  readonly claimedBy: string | null;
  readonly claimedAt: string | null;
  /** When the claim lapses and the card becomes claimable again. */
  readonly expiresAt: string | null;
}

/** Claim bookkeeping, when the backend reports it. */
export function readClaimState(item: WorkItemDto): ClaimState | null {
  const raw = fields(item);
  const claimedBy = readNullableString(raw.claimed_by);
  const claimedAt = readNullableString(raw.claimed_at);
  const expiresAt = readNullableString(raw.claim_expires_at);
  if (claimedBy === null && claimedAt === null && expiresAt === null)
    return null;
  return { claimedBy, claimedAt, expiresAt };
}

/**
 * A card can be claimed while nobody holds it, or while the held claim has
 * lapsed. Without the backend's claim fields the honest signal we do have is
 * assignment: an unassigned card is unclaimed.
 */
export function isClaimable(item: WorkItemDto, now: number): boolean {
  if (item.status === 'done') return false;
  const claim = readClaimState(item);
  if (!claim) return item.assignee_id === null;
  if (!claim.claimedBy) return true;
  if (!claim.expiresAt) return false;
  const expiry = Date.parse(claim.expiresAt);
  return Number.isFinite(expiry) && expiry <= now;
}

/** Why the Claim button is unavailable, for a title/description the user reads. */
export function claimBlockedReason(
  item: WorkItemDto,
  now: number,
): string | null {
  if (isClaimable(item, now)) return null;
  if (item.status === 'done') return '这个任务已经完成了。';
  const claim = readClaimState(item);
  const holder = claim?.claimedBy ?? item.assignee_id;
  return holder ? `这个任务已被 ${holder} 领取。` : '当前无法领取这个任务。';
}
