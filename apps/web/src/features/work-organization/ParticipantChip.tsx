import {
  findParticipant,
  participantInitials,
  type Participant,
} from './participants';

/**
 * An assignee/author chip: initials avatar plus name.
 *
 * Cumora shows a generated avatar image here. This product has no avatar
 * pipeline, so the avatar is the participant's initials — same shape and
 * information density, nothing invented. An agent reads differently from a
 * human so a Coworker card is legible at a glance.
 */
export function ParticipantChip({
  participants,
  id,
  fallback = '未分配',
  compact = false,
}: {
  readonly participants: readonly Participant[];
  readonly id: string | null;
  /** Shown when there is nobody to name. */
  readonly fallback?: string;
  /** Avatar only, with the name in the tooltip. */
  readonly compact?: boolean;
}) {
  if (!id)
    return (
      <span className="work-org-assignee work-org-assignee--empty">
        {fallback}
      </span>
    );

  const participant = findParticipant(participants, id);
  const name = participant?.name ?? id;
  return (
    <span
      className="work-org-assignee"
      data-testid="work-org-assignee"
      title={participant ? `${name} · ${id}` : id}
    >
      <span
        aria-hidden="true"
        className={`work-org-avatar${
          participant?.kind === 'agent' ? ' work-org-avatar--agent' : ''
        }`}
      >
        {participantInitials(name)}
      </span>
      {compact ? (
        <span className="work-org-visually-hidden">{name}</span>
      ) : (
        name
      )}
    </span>
  );
}

export default ParticipantChip;
