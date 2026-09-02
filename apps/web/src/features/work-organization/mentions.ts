/**
 * Mention tokens for Task/Board prose.
 *
 * A mention is written as `@<participant-id>` — the canonical Coworker or
 * principal id, not a display name. Display names are not stable, may
 * contain spaces, and are not addressable by the backend; the id is all
 * three. The UI resolves the id back to a display name when it renders the
 * chip, so a writer still reads `@Ari Analyst` while the stored prose keeps
 * the token a mention parser can extract.
 *
 * The token charset starts and ends on an alphanumeric so a mention at the
 * end of a sentence (`ask @ari-analyst.`) does not swallow the period, and
 * so a UUID participant id round-trips unchanged.
 */
const MENTION_TOKEN_SOURCE = '@([A-Za-z0-9](?:[A-Za-z0-9_:.-]*[A-Za-z0-9])?)';

/** A single mention anywhere in a string, anchored on a word boundary. */
export const MENTION_TOKEN_PATTERN = new RegExp(MENTION_TOKEN_SOURCE);

/** The characters that may still be typed into an unfinished `@` token. */
export const MENTION_QUERY_PATTERN = /^[A-Za-z0-9_:.-]*$/;

export function mentionToken(participantId: string): string {
  return `@${participantId}`;
}

/**
 * `@` only opens a mention at the start of a word. Without this an email
 * address or a `you@example.com` would read as a mention of `example.com`.
 */
export function opensMention(text: string, index: number): boolean {
  if (index <= 0) return true;
  return !/[\w@]/.test(text.charAt(index - 1));
}

export interface MentionSpan {
  readonly id: string;
  readonly start: number;
  readonly end: number;
}

/** Every mention token in `text`, in reading order. */
export function findMentionSpans(text: string): readonly MentionSpan[] {
  const spans: MentionSpan[] = [];
  const scanner = new RegExp(MENTION_TOKEN_SOURCE, 'g');
  let match = scanner.exec(text);
  while (match) {
    const start = match.index;
    if (opensMention(text, start)) {
      spans.push({ id: match[1]!, start, end: start + match[0].length });
    }
    scanner.lastIndex = start + match[0].length;
    match = scanner.exec(text);
  }
  return spans;
}

/** The distinct participant ids mentioned in `text`, in reading order. */
export function extractMentionIds(text: string): readonly string[] {
  const seen = new Set<string>();
  for (const span of findMentionSpans(text)) seen.add(span.id);
  return [...seen];
}

export interface MentionDraft {
  /** Index of the `@` that opened the still-unfinished token. */
  readonly anchor: number;
  /** What has been typed after the `@`, used to filter candidates. */
  readonly query: string;
}

/**
 * Look back from the caret for a mention the writer is still typing. Returns
 * null when the caret is not inside an open `@` token, which is what closes
 * the suggestion list.
 */
export function readMentionDraft(
  text: string,
  caret: number,
): MentionDraft | null {
  for (let index = caret - 1; index >= 0; index -= 1) {
    const character = text.charAt(index);
    if (character === '@') {
      if (!opensMention(text, index)) return null;
      const query = text.slice(index + 1, caret);
      return MENTION_QUERY_PATTERN.test(query)
        ? { anchor: index, query }
        : null;
    }
    if (!/[A-Za-z0-9_:.-]/.test(character)) return null;
  }
  return null;
}

/**
 * Replace the open `@` token at `anchor` with a completed mention token.
 *
 * A completed mention is followed by a space so the writer can keep typing
 * prose, and so the next `@` opens a fresh mention — but not a second space
 * when the text already continues with one.
 */
export function completeMention(
  text: string,
  draft: MentionDraft,
  caret: number,
  participantId: string,
): { readonly text: string; readonly caret: number } {
  const before = text.slice(0, draft.anchor);
  const after = text.slice(Math.max(caret, draft.anchor));
  const token = mentionToken(participantId);
  const spaced = /^\s/.test(after);
  return {
    text: `${before}${token}${spaced ? '' : ' '}${after}`,
    caret: before.length + token.length + 1,
  };
}
