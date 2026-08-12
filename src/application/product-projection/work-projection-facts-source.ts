import type {
  WorkProjectionFacts,
  WorkProjectionFactsQuery,
  WorkProjectionWorkspaceScope,
} from '../work/work-projection-facts.js';
import type { ProductSourceRefs } from '../../contracts/product-source-refs.js';
import {
  ProductProjectionIdentitySchema,
  type ProductProjectionIdentity,
} from '../../contracts/product-projection/identity.js';
import type { ProductTraceEdge } from '../../contracts/product-projection/edges.js';
import {
  projectAssignmentEdges,
  projectDependencyEdges,
  projectFeedbackEdges,
  projectMessageEdges,
} from './edges/index.js';
import { safeText } from '../teams/safe-team-text.js';

export class WorkProjectionFactsSource {
  public constructor(private readonly query: WorkProjectionFactsQuery) {}

  public async getByRootTask(
    owner: WorkProjectionWorkspaceScope,
    rootTaskId: string,
  ): Promise<ProductProjectionFactsSlice | null> {
    const facts = await this.query.getByRootTask({ ...owner, rootTaskId });
    if (!facts) return null;
    const identity = mapWorkProjectionFacts(facts);
    const messages = projectMessageEdges(facts.messages);
    const dependencies = projectDependencyEdges(facts.dependencies);
    const assignments = projectAssignmentEdges(
      facts.workItems.flatMap((item) => item.attempts),
    );
    const feedback = projectFeedbackEdges(
      facts.workItems.flatMap((item) => item.attempts),
    );
    return {
      identity,
      rootTaskId: facts.rootTaskId,
      teamRunId: facts.teamRunId,
      edges: [
        ...messages.edges,
        ...dependencies.edges,
        ...assignments.edges,
        ...feedback.edges,
      ] as ProductTraceEdge[],
    };
  }
}

export interface ProductProjectionFactsSlice {
  readonly identity: ProductProjectionIdentity;
  readonly rootTaskId: string;
  readonly teamRunId: string;
  readonly edges: readonly ProductTraceEdge[];
}

export function mapWorkProjectionFacts(
  facts: WorkProjectionFacts,
): ProductProjectionIdentity {
  const dependencyIds = new Map<string, string[]>();
  for (const dependency of facts.dependencies) {
    const ids = dependencyIds.get(dependency.sourceWorkItemId) ?? [];
    ids.push(dependency.dependencyWorkItemId);
    dependencyIds.set(dependency.sourceWorkItemId, ids);
  }
  const refs = (
    source: WorkProjectionFacts['workItems'][number]['sourceRefs'],
  ): ProductSourceRefs => ({
    ...(source.rootTaskId ? { root_task_id: source.rootTaskId } : {}),
    ...(source.teamRunId ? { team_run_id: source.teamRunId } : {}),
    ...(source.teamMemberRunId
      ? { team_member_run_id: source.teamMemberRunId }
      : {}),
    ...(source.taskId ? { task_id: source.taskId } : {}),
    ...(source.runId ? { run_id: source.runId } : {}),
    ...(source.teamMessageId ? { team_message_id: source.teamMessageId } : {}),
  });
  return ProductProjectionIdentitySchema.parse({
    work_items: facts.workItems.map((item) => ({
      id: item.id,
      subject: safeText(item.subject) ?? '',
      description: safeText(item.description),
      status: item.status,
      actor_id: item.actorId,
      dependency_ids: dependencyIds.get(item.id) ?? [],
      attempts: item.attempts.map((attempt) => ({
        id: attempt.id,
        attempt_no: attempt.attemptNo,
        status: attempt.status,
        feedback_summary: null,
        result_summary: null,
        feedback_capture_status:
          attempt.feedbackCapture === 'present' ? 'redacted' : 'not_present',
        result_capture_status:
          attempt.resultCapture === 'present' ? 'redacted' : 'not_present',
        source_refs: refs(attempt.sourceRefs),
      })),
      source_refs: refs(item.sourceRefs),
    })),
    actors: facts.actors.map((actor) => ({
      id: actor.id,
      name: safeText(actor.name),
      source_refs: refs(actor.sourceRefs),
    })),
    messages: facts.messages.map((message) => ({
      id: message.id,
      sender_id: requireSenderId(message.id, message.senderId),
      recipient_id: message.recipientId,
      sender_name: safeText(message.senderName),
      recipient_name: safeText(message.recipientName),
      summary: null,
      summary_capture_status:
        message.bodyCapture === 'present' ? 'redacted' : 'not_present',
      source_refs: refs(message.sourceRefs),
    })),
  });
}

function requireSenderId(messageId: string, senderId: string | null): string {
  if (senderId === null)
    throw new Error(`product_message_sender_id_missing:${messageId}`);
  return senderId;
}
