import { findMentionSpans } from './mentions';
import { findParticipant, type Participant } from './participants';

/**
 * Prose with its `@<participant-id>` tokens rendered as chips.
 *
 * Cumora renders a mention as an inline pill carrying the participant's
 * display name. The stored token is an id, so the chip resolves it through the
 * directory and falls back to the raw id — marked as unresolved — when the
 * workspace has not shown us that participant. Showing the id rather than
 * hiding the mention keeps the text faithful to what was written.
 */
export function MentionedText({
  text,
  participants,
  className,
}: {
  readonly text: string;
  readonly participants: readonly Participant[];
  readonly className?: string;
}) {
  const spans = findMentionSpans(text);
  if (spans.length === 0) return <span className={className}>{text}</span>;

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  spans.forEach((span, index) => {
    if (span.start > cursor) parts.push(text.slice(cursor, span.start));
    const participant = findParticipant(participants, span.id);
    parts.push(
      <span
        key={`${span.id}-${span.start}`}
        className={`work-org-mention${
          participant ? '' : ' work-org-mention--unknown'
        }`}
        data-testid="work-org-mention"
        data-participant-id={span.id}
        title={
          participant
            ? `${participant.name} · ${span.id}`
            : `${span.id} 不在当前工作区的成员目录中`
        }
      >
        @{participant?.name ?? span.id}
      </span>,
    );
    cursor = span.end;
    if (index === spans.length - 1 && cursor < text.length)
      parts.push(text.slice(cursor));
  });

  return <span className={className}>{parts}</span>;
}

export default MentionedText;
