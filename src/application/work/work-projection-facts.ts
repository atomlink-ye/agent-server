export interface WorkProjectionWorkspaceScope {
  readonly tenantId: string;
  readonly workspaceId: string;
}

export interface WorkProjectionSourceRefs {
  readonly rootTaskId?: string;
  readonly teamRunId?: string;
  readonly teamMemberRunId?: string;
  readonly taskId?: string;
  readonly runId?: string;
  readonly teamMessageId?: string;
}

export type WorkProjectionAttemptStatus =
  'queued' | 'running' | 'completed' | 'failed';

export interface WorkProjectionAttemptFact {
  readonly id: string;
  readonly workItemId: string;
  readonly attemptNo: number;
  readonly status: WorkProjectionAttemptStatus;
  readonly feedbackCapture: 'present' | 'absent';
  readonly resultCapture: 'present' | 'absent';
  readonly sourceRefs: WorkProjectionSourceRefs;
}

export interface WorkProjectionWorkItemFact {
  readonly id: string;
  readonly subject: string;
  readonly description: string | null;
  readonly status: string;
  readonly actorId: string | null;
  readonly attempts: readonly WorkProjectionAttemptFact[];
  readonly sourceRefs: WorkProjectionSourceRefs;
}

export interface WorkProjectionActorFact {
  readonly id: string;
  readonly name: string | null;
  readonly sourceRefs: WorkProjectionSourceRefs;
}

export interface WorkProjectionDependencyFact {
  readonly sourceWorkItemId: string;
  readonly dependencyWorkItemId: string;
}

export interface WorkProjectionMessageFact {
  readonly id: string;
  readonly senderId: string | null;
  readonly recipientId: string;
  readonly senderName: string | null;
  readonly recipientName: string | null;
  readonly bodyCapture: 'present' | 'absent';
  readonly sourceRefs: WorkProjectionSourceRefs;
}

export interface WorkProjectionFacts {
  readonly rootTaskId: string;
  readonly workItems: readonly WorkProjectionWorkItemFact[];
  readonly actors: readonly WorkProjectionActorFact[];
  readonly dependencies: readonly WorkProjectionDependencyFact[];
  readonly messages: readonly WorkProjectionMessageFact[];
}

export interface WorkProjectionFactsQuery {
  getByRootTask(
    input: WorkProjectionWorkspaceScope & { readonly rootTaskId: string },
  ): Promise<WorkProjectionFacts | null>;
}

export interface WorkProjectionFactsReader {
  getByRootTask(
    owner: WorkProjectionWorkspaceScope,
    rootTaskId: string,
  ): Promise<WorkProjectionFacts | null>;
}
