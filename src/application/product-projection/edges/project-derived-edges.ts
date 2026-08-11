import type { WorkProjectionAttemptFact } from '../../work/work-projection-facts.js';
import type {
  ProductAssignmentEdge,
  ProductFeedbackEdge,
} from '../../../contracts/product-projection/edges.js';
import { EdgeProjection, attemptRefs } from './shared.js';

function refs(attempt: WorkProjectionAttemptFact) {
  const teamRunId = attempt.sourceRefs.teamRunId;
  if (!teamRunId)
    throw new Error('Attempt source refs must include teamRunId.');
  return attemptRefs(teamRunId, attempt.requestedByLeadTaskId);
}

export function projectAssignmentEdges(
  attempts: readonly WorkProjectionAttemptFact[],
): EdgeProjection<ProductAssignmentEdge> {
  const edges = attempts.map((raw) => {
    const attempt = raw;
    return {
      kind: 'assignment' as const,
      guarantee: 'derived_relation' as const,
      work_item_id: attempt.workItemId,
      attempt_id: attempt.id,
      assignee_actor_id: attempt.assigneeActorId,
      source_created_at: attempt.createdAt,
      source_refs: refs(attempt),
    } satisfies ProductAssignmentEdge;
  });
  return {
    edges,
    sourceRowKeys: edges.map(
      (edge) =>
        `${edge.source_refs.team_run_id}:${edge.source_refs.task_id}:${edge.attempt_id}`,
    ),
  };
}

export function projectFeedbackEdges(
  attempts: readonly WorkProjectionAttemptFact[],
): EdgeProjection<ProductFeedbackEdge> {
  const edges = attempts.flatMap((raw) => {
    const attempt = raw;
    if (attempt.feedbackCapture !== 'present') return [];
    return [
      {
        kind: 'feedback' as const,
        guarantee: 'derived_relation' as const,
        work_item_id: attempt.workItemId,
        attempt_id: attempt.id,
        reviewer_actor_id: attempt.reviewerActorId,
        source_created_at: attempt.createdAt,
        source_refs: refs(attempt),
      } satisfies ProductFeedbackEdge,
    ];
  });
  return {
    edges,
    sourceRowKeys: edges.map(
      (edge) =>
        `${edge.source_refs.team_run_id}:${edge.source_refs.task_id}:${edge.attempt_id}`,
    ),
  };
}

export const mapAssignmentEdges = projectAssignmentEdges;
export const mapAssignment = projectAssignmentEdges;
export const mapFeedbackEdges = projectFeedbackEdges;
export const mapFeedback = projectFeedbackEdges;
