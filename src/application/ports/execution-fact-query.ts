export interface ExecutionFactOwnerScope {
  readonly tenantId: string;
  readonly workspaceId: string;
}

export interface ExecutionRunFact {
  readonly runId: string;
  readonly taskId: string;
  readonly rootTaskId: string;
  readonly status:
    | 'queued'
    | 'running'
    | 'waiting_children'
    | 'succeeded'
    | 'failed'
    | 'timed_out'
    | 'cancelled';
  readonly provider: string | null;
  readonly model: string | null;
  readonly resultPresent: boolean;
  readonly errorCode: string | null;
  readonly actorId: string | null;
  readonly workItemId: string | null;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ExecutionEventFact {
  readonly id: string;
  readonly runId: string;
  readonly sequence: number;
  readonly type: 'started' | 'output' | 'succeeded' | 'failed' | 'cancelled';
  readonly payloadPresent: boolean;
  readonly taskId: string;
  readonly rootTaskId: string;
  readonly actorId: string | null;
  readonly workItemId: string | null;
  readonly activityId: string | null;
  readonly activityKind: 'tool_status' | 'permission' | null;
  readonly activityCategory: string | null;
  readonly activityStatus: string | null;
  readonly toolName: string | null;
  readonly createdAt: string;
}

export type ExecutionFactQueryFailureReason =
  'event_page_limit' | 'event_page_order_invalid';

export class ExecutionFactQueryError extends Error {
  public constructor(public readonly reason: ExecutionFactQueryFailureReason) {
    super(`execution_fact_query_failed:${reason}`);
    this.name = 'ExecutionFactQueryError';
  }
}

export interface ExecutionFactQuery {
  listRunsByRootTask(
    input: ExecutionFactOwnerScope & { readonly rootTaskId: string },
  ): Promise<readonly ExecutionRunFact[]>;
  listRunEvents(
    input: ExecutionFactOwnerScope & { readonly runIds: readonly string[] },
  ): Promise<readonly ExecutionEventFact[]>;
}
