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
  const displayOutcome = outcomeForDisplay(outcome);
  const flat = (titleLine(displayOutcome)?.text ?? displayOutcome)
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
  const displayOutcome = outcomeForDisplay(outcome);
  const title = titleLine(displayOutcome);
  if (!title) return '';
  const lines = displayOutcome.split('\n');
  lines.splice(0, title.index + 1);
  return lines.join('\n').trimStart();
}

/**
 * A final result can be framed by a Markdown rule even though the Overview
 * supplies its own heading boundary. Strip only rules before any report
 * content: internal rules, setext headings, and fenced code remain untouched.
 */
function outcomeForDisplay(outcome: string): string {
  const lines = outcome.split('\n');
  let index = 0;
  while (index < lines.length) {
    while (lines[index]?.trim() === '') index += 1;
    if (!isThematicBreak(lines[index])) break;
    index += 1;
  }
  return lines.slice(index).join('\n');
}

function isThematicBreak(line: string | undefined): boolean {
  return line !== undefined && /^\s{0,3}(?:-\s*){3,}$/u.test(line);
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
