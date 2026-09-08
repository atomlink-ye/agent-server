/**
 * Pure presentation transform for a Work outcome, kept free of React and path
 * aliases so the browser journey can assert against the SAME function the pane
 * renders with. Re-deriving this transform in a test looked mode-independent and
 * was not: it diverged on Markdown headings, leading blanks, and first lines
 * over the length limit, so it agreed with production only for short plain text.
 */
/**
 * Compatibility label for the external golden-path canary. The Work page no
 * longer promotes this to a headline; it renders the full document below.
 */
export function outcomeHeadline(outcome: string): string {
  const firstLine = outcomeForDisplay(outcome)
    .split('\n')
    .find((line) => line.trim().length > 0);
  return (firstLine ?? outcome).replace(/^\s{0,3}#{1,6}\s+/u, '').trim();
}

/**
 * The captured result is shown as a document, not promoted into a truncated
 * card heading. Strip only a framing thematic break before rendering it.
 */
export function outcomeBody(outcome: string): string {
  return outcomeForDisplay(outcome).trim();
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
