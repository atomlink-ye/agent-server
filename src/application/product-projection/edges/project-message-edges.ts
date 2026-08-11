import type { WorkProjectionMessageFact } from '../../work/work-projection-facts.js';
import type { ProductObservedMessageEdge } from '../../../contracts/product-projection/edges.js';
import { EdgeProjection, messageRefs } from './shared.js';

export function projectMessageEdges(
  messages: readonly WorkProjectionMessageFact[],
): EdgeProjection<ProductObservedMessageEdge> {
  const edges = messages.map((raw) => {
    const teamRunId = raw.sourceRefs.teamRunId;
    const teamMessageId = raw.sourceRefs.teamMessageId;
    if (!teamRunId || !teamMessageId)
      throw new Error(
        'Message source refs must include team run and message IDs.',
      );
    return {
      kind: 'observed_message' as const,
      guarantee: 'ordered_observation' as const,
      message_id: raw.id,
      sender_actor_id: raw.senderId,
      recipient_actor_id: raw.recipientId,
      work_item_id: raw.workItemId,
      attempt_id: raw.attemptId,
      sequence: raw.sequence,
      source_created_at: raw.createdAt,
      source_refs: messageRefs(teamRunId, teamMessageId),
    } satisfies ProductObservedMessageEdge;
  });
  return {
    edges,
    sourceRowKeys: edges.map(
      (edge) =>
        `${edge.source_refs.team_run_id}:${edge.source_refs.team_message_id}`,
    ),
  };
}

export const mapObservedMessageEdges = projectMessageEdges;
export const mapObservedMessage = projectMessageEdges;
