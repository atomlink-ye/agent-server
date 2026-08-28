/**
 * Pure presentation transform for a Work outcome, kept free of React and path
 * aliases so the browser journey can assert against the SAME function the pane
 * renders with. Re-deriving this transform in a test looked mode-independent and
 * was not: it diverged on Markdown headings, leading blanks, and first lines
 * over the length limit, so it agreed with production only for short plain text.
 */
const outcomeHeadlineLimit = 120;

/** The report's own title/first meaningful line, flattened for the heading. */
export function outcomeHeadline(outcome: string): string {
  const flat = (titleLine(outcome)?.text ?? outcome)
    .replace(/[*_`]/g, '')
    .trim();
  return flat.length > outcomeHeadlineLimit
    ? `${flat.slice(0, outcomeHeadlineLimit).trimEnd()}…`
    : flat;
}

/**
 * The report body after the line already promoted to the heading. This applies
 * to both explicit Markdown headings and plain/unheaded outcomes, so a result
 * like `Done` is rendered exactly once.
 */
export function outcomeBody(outcome: string): string {
  const title = titleLine(outcome);
  if (!title) return '';
  const lines = outcome.split('\n');
  lines.splice(0, title.index + 1);
  return lines.join('\n').trimStart();
}

function titleLine(outcome: string): {
  readonly text: string;
  readonly index: number;
  readonly isHeading: boolean;
} | null {
  const lines = outcome.split('\n');
  for (const [index, line] of lines.entries()) {
    const heading = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(line);
    if (heading) return { text: heading[2]!.trim(), index, isHeading: true };
    if (line.trim().length > 0)
      return { text: line.trim(), index, isHeading: false };
  }
  return null;
}
