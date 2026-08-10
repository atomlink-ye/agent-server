import type {
  WorkProjectionFacts,
  WorkProjectionFactsQuery,
  WorkProjectionWorkspaceScope,
} from '../work/work-projection-facts.js';
import type { ProductSourceRefs } from '../../contracts/product-source-refs.js';

export interface ProductWorkProjectionAttempt {
  readonly id: string;
  readonly attempt_no: number;
  readonly status: 'queued' | 'running' | 'completed' | 'failed';
  readonly feedback_summary: null;
  readonly result_summary: null;
  readonly feedback_capture_status: 'redacted' | 'not_present';
  readonly result_capture_status: 'redacted' | 'not_present';
  readonly source_refs: ProductSourceRefs;
}

export interface ProductWorkProjectionWorkItem {
  readonly id: string;
  readonly subject: string;
  readonly description: string | null;
  readonly status: string;
  readonly actor_id: string | null;
  readonly dependency_ids: readonly string[];
  readonly attempts: readonly ProductWorkProjectionAttempt[];
  readonly source_refs: ProductSourceRefs;
}

export interface ProductWorkProjectionActor {
  readonly id: string;
  readonly name: string | null;
  readonly source_refs: ProductSourceRefs;
}

export interface ProductWorkProjectionMessage {
  readonly id: string;
  readonly sender_id: string;
  readonly recipient_id: string;
  readonly sender_name: string | null;
  readonly recipient_name: string | null;
  readonly summary: null;
  readonly summary_capture_status: 'redacted' | 'not_present';
  readonly source_refs: ProductSourceRefs;
}

export interface ProductWorkProjectionFacts {
  readonly work_items: readonly ProductWorkProjectionWorkItem[];
  readonly actors: readonly ProductWorkProjectionActor[];
  readonly messages: readonly ProductWorkProjectionMessage[];
}

/** Product-facing source; it owns mapping, not persistence. */
export class WorkProjectionFactsSource {
  public constructor(private readonly query: WorkProjectionFactsQuery) {}

  public async getByRootTask(
    owner: WorkProjectionWorkspaceScope,
    rootTaskId: string,
  ): Promise<ProductWorkProjectionFacts | null> {
    const facts = await this.query.getByRootTask({
      ...owner,
      rootTaskId,
    });
    return facts ? mapWorkProjectionFacts(facts) : null;
  }
}

export function mapWorkProjectionFacts(
  facts: WorkProjectionFacts,
): ProductWorkProjectionFacts {
  const dependencyIds = new Map<string, string[]>();
  for (const dependency of facts.dependencies) {
    const ids = dependencyIds.get(dependency.sourceWorkItemId) ?? [];
    ids.push(dependency.dependencyWorkItemId);
    dependencyIds.set(dependency.sourceWorkItemId, ids);
  }
  return {
    work_items: facts.workItems.map((item) => ({
      id: item.id,
      subject: item.subject,
      description: item.description,
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
        source_refs: {
          root_task_id: facts.rootTaskId,
          ...(attempt.sourceRefs.teamRunId
            ? { team_run_id: attempt.sourceRefs.teamRunId }
            : {}),
          ...(attempt.sourceRefs.teamMemberRunId
            ? { team_member_run_id: attempt.sourceRefs.teamMemberRunId }
            : {}),
          ...(attempt.sourceRefs.taskId
            ? { task_id: attempt.sourceRefs.taskId }
            : {}),
          ...(attempt.sourceRefs.runId
            ? { run_id: attempt.sourceRefs.runId }
            : {}),
          ...(attempt.sourceRefs.teamMessageId
            ? { team_message_id: attempt.sourceRefs.teamMessageId }
            : {}),
        },
      })),
      source_refs: {
        root_task_id: facts.rootTaskId,
        ...(item.sourceRefs.teamRunId
          ? { team_run_id: item.sourceRefs.teamRunId }
          : {}),
        ...(item.sourceRefs.teamMemberRunId
          ? { team_member_run_id: item.sourceRefs.teamMemberRunId }
          : {}),
        ...(item.sourceRefs.taskId ? { task_id: item.sourceRefs.taskId } : {}),
        ...(item.sourceRefs.runId ? { run_id: item.sourceRefs.runId } : {}),
        ...(item.sourceRefs.teamMessageId
          ? { team_message_id: item.sourceRefs.teamMessageId }
          : {}),
      },
    })),
    actors: facts.actors.map((actor) => ({
      id: actor.id,
      name: actor.name,
      source_refs: {
        root_task_id: facts.rootTaskId,
        ...(actor.sourceRefs.teamRunId
          ? { team_run_id: actor.sourceRefs.teamRunId }
          : {}),
        ...(actor.sourceRefs.teamMemberRunId
          ? { team_member_run_id: actor.sourceRefs.teamMemberRunId }
          : {}),
        ...(actor.sourceRefs.taskId
          ? { task_id: actor.sourceRefs.taskId }
          : {}),
        ...(actor.sourceRefs.runId ? { run_id: actor.sourceRefs.runId } : {}),
        ...(actor.sourceRefs.teamMessageId
          ? { team_message_id: actor.sourceRefs.teamMessageId }
          : {}),
      },
    })),
    messages: facts.messages.map((message) => ({
      id: message.id,
      sender_id: requireSenderId(message.id, message.senderId),
      recipient_id: message.recipientId,
      sender_name: message.senderName,
      recipient_name: message.recipientName,
      summary: null,
      summary_capture_status:
        message.bodyCapture === 'present' ? 'redacted' : 'not_present',
      source_refs: {
        root_task_id: facts.rootTaskId,
        ...(message.sourceRefs.teamRunId
          ? { team_run_id: message.sourceRefs.teamRunId }
          : {}),
        ...(message.sourceRefs.teamMemberRunId
          ? { team_member_run_id: message.sourceRefs.teamMemberRunId }
          : {}),
        ...(message.sourceRefs.taskId
          ? { task_id: message.sourceRefs.taskId }
          : {}),
        ...(message.sourceRefs.runId
          ? { run_id: message.sourceRefs.runId }
          : {}),
        ...(message.sourceRefs.teamMessageId
          ? { team_message_id: message.sourceRefs.teamMessageId }
          : {}),
      },
    })),
  };
}

function requireSenderId(messageId: string, senderId: string | null): string {
  if (senderId === null)
    throw new Error(`product_message_sender_id_missing:${messageId}`);
  return senderId;
}
