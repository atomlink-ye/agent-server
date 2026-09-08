// `result_summary` is arbitrary agent-authored text that may contain literal
// markdown syntax (headings, bold/italic markers, list bullets, inline
// code). The trace list row is a single-line preview, not a rendered
// document, so this strips the common markers down to plain text rather
// than rendering markdown. Scoped to this feature: the shared
// `work-presentation.ts` helpers used elsewhere are left untouched.
export function stripMarkdownPreview(text: string): string {
  const withoutBlockMarkers = text
    .split('\n')
    .map((line) =>
      line
        // Headings: "## Heading" -> "Heading"
        .replace(/^\s{0,3}#{1,6}\s+/, '')
        // List markers: "- item", "* item", "-- item" -> "item"
        .replace(/^\s*(?:-{1,2}|\*)\s+/, ''),
    )
    .join(' ');

  return (
    withoutBlockMarkers
      // Bold/italic emphasis markers.
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/\*/g, '')
      // Inline code.
      .replace(/`+/g, '')
      // Any remaining run of dashes used as a separator/marker.
      .replace(/-{2,}/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}
