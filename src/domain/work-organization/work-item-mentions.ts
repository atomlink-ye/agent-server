/**
 * What an @-token in WorkItem prose MEANS.
 *
 * A mention is the only way a human hands a WorkItem to a Coworker without
 * filling in the assignee field, so parsing has to be a pure, stable function
 * of the text: the same title/description always produces the same stored
 * array, and re-saving unchanged prose must never look like a new mention.
 *
 * A token that matches a known identity resolves to that identity's id, so the
 * durable payload stays stable while the author sees a friendly display name.
 * A token that matches nothing is kept verbatim (lowercased) rather than
 * dropped: the roster is read at write time, and silently discarding
 * `@someone-who-joins-tomorrow` would lose the author's intent.
 */

/** One identity an @-token can resolve to. */
export interface MentionTarget {
  readonly id: string;
  /** A human-facing token for the same identity (display or normalized name). */
  readonly name: string;
}

/**
 * A bound on the stored array. Prose is already length-capped, but a pasted
 * wall of @-tokens must not become an unbounded fan-out of wake deliveries.
 */
export const MAX_WORK_ITEM_MENTIONS = 64;

/** Reserved broadcast token; it names no single identity, so it never wakes. */
const BROADCAST_TOKEN = 'all';

/** Kept beside the parser so every call site composes the source text alike. */
export function mentionSourceText(
  title: string,
  description: string | null,
): string {
  return `${title}\n${description ?? ''}`;
}

/**
 * Extract mention ids from prose, deduplicated in first-appearance order.
 *
 * Pure: no I/O, no clock, no randomness. The roster is supplied by the caller.
 */
export function parseMentions(
  text: string,
  targets: readonly MentionTarget[],
): readonly string[] {
  if (!text) return [];
  const candidates = mentionCandidates(targets);
  const lowered = text.toLowerCase();
  const mentions: string[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '@' || !startsToken(text, index)) continue;
    const rest = lowered.slice(index + 1);
    const matched = candidates.find(
      (candidate) =>
        rest.startsWith(candidate.token) &&
        endsToken(text, index + 1 + candidate.token.length),
    );
    const fallback = matched
      ? null
      : /^@([a-z0-9][a-z0-9_-]{0,63})/iu.exec(text.slice(index));
    const mention = matched?.id ?? fallback?.[1]?.toLowerCase();
    if (!mention) continue;
    // Advance past whatever was consumed so a matched token cannot also be
    // re-read as a shorter overlapping mention.
    index += matched ? matched.token.length : (fallback?.[0].length ?? 1) - 1;
    if (mention === BROADCAST_TOKEN || seen.has(mention)) continue;
    seen.add(mention);
    mentions.push(mention);
    if (mentions.length >= MAX_WORK_ITEM_MENTIONS) break;
  }
  return Object.freeze(mentions);
}

/** Mentions present in `next` that `previous` did not already carry. */
export function newMentions(
  previous: readonly string[],
  next: readonly string[],
): readonly string[] {
  const known = new Set(previous);
  return Object.freeze(next.filter((mention) => !known.has(mention)));
}

/**
 * Longest token first, so `@reviewer` cannot be claimed by an identity merely
 * named `rev`. Ordering is by token length only, which keeps the result
 * independent of roster row order.
 */
function mentionCandidates(
  targets: readonly MentionTarget[],
): readonly { readonly id: string; readonly token: string }[] {
  return targets
    .flatMap((target) => [
      { id: target.id, token: target.id.trim().toLowerCase() },
      { id: target.id, token: target.name.trim().toLowerCase() },
    ])
    .filter((candidate) => candidate.token.length > 0)
    .sort((left, right) => right.token.length - left.token.length);
}

function startsToken(text: string, index: number): boolean {
  if (index <= 0) return true;
  return !/[\w@]/u.test(text[index - 1] ?? '');
}

function endsToken(text: string, index: number): boolean {
  const next = text[index];
  return !next || !/[a-z0-9_-]/iu.test(next);
}
