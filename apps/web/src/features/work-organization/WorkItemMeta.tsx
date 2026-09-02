import type { WorkItemStatus } from '@atomlink-ye/agent-server/product-contract';

import { STATUS_LABELS } from './format';
import {
  participantInitials,
  participantLabel,
  type Participant,
} from './participants';

/** The status pill shared by the Task list, the Board card, and the detail view. */
export function StatusBadge({ status }: { readonly status: WorkItemStatus }) {
  return (
    <span className={`work-org-status work-org-status--${status}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

/**
 * The mention chip row on a card.
 *
 * `ids` is null while the backend has not shipped `mentions` — that is a
 * different fact from "this card mentions nobody", and neither one gets a row.
 */
export function MentionRow({
  ids,
  participants,
  limit = 3,
}: {
  readonly ids: readonly string[] | null;
  readonly participants: readonly Participant[];
  readonly limit?: number;
}) {
  if (!ids || ids.length === 0) return null;
  const shown = ids.slice(0, limit);
  return (
    <span className="work-org-mention-row" data-testid="work-org-mention-row">
      {shown.map((id) => (
        <span className="work-org-mention" key={id} data-participant-id={id}>
          @{participantLabel(participants, id)}
        </span>
      ))}
      {ids.length > shown.length ? (
        <span className="work-org-mention work-org-mention--more">
          +{ids.length - shown.length}
        </span>
      ) : null}
    </span>
  );
}

/** Comment count, rendered only once the projection reports one. */
export function CommentCount({ count }: { readonly count: number | null }) {
  if (count === null || count === 0) return null;
  return (
    <span
      className="work-org-comment-count"
      data-testid="work-org-comment-count"
    >
      <span aria-hidden="true">💬</span>
      {count}
      <span className="work-org-visually-hidden">条评论</span>
    </span>
  );
}

/** A bare initials avatar, for rows too tight to carry a full chip. */
export function ParticipantAvatar({
  participants,
  id,
}: {
  readonly participants: readonly Participant[];
  readonly id: string;
}) {
  const participant = participants.find((entry) => entry.id === id) ?? null;
  const name = participant?.name ?? id;
  return (
    <span
      className={`work-org-avatar${
        participant?.kind === 'agent' ? ' work-org-avatar--agent' : ''
      }`}
      title={name}
    >
      {participantInitials(name)}
    </span>
  );
}
