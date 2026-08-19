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
  readonly assigneeActorId: string;
  readonly requestedByLeadTaskId: string;
  readonly reviewerActorId: string | null;
  readonly createdAt: string;
  readonly feedbackCapture: 'present' | 'absent';
  readonly resultCapture: 'present' | 'absent';
  /** Populated by a run-aware projection layer; zero is fail-closed. */
  readonly executionRunCount?: number;
  readonly startedAt?: string | null;
  readonly endedAt?: string | null;
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
  readonly teamRunId: string;
  readonly sourceWorkItemId: string;
  readonly dependencyWorkItemId: string;
  readonly createdAt: string;
}

export interface WorkProjectionMessageFact {
  readonly id: string;
  readonly senderId: string | null;
  readonly recipientId: string;
  readonly workItemId: string | null;
  readonly attemptId: string | null;
  readonly sequence: number;
  readonly createdAt: string;
  readonly senderName: string | null;
  readonly recipientName: string | null;
  readonly bodyCapture: 'present' | 'absent';
  readonly sourceRefs: WorkProjectionSourceRefs;
}

export interface WorkProjectionFacts {
  readonly rootTaskId: string;
  /** The TeamRun row selected while loading the existing projection facts. */
  readonly teamRunId: string;
  readonly teamRunStatus?: 'active' | 'waiting' | 'succeeded' | 'failed' | null;
  readonly teamRunPhase?: string | null;
  readonly teamRunRevision?: number | null;
  readonly completionApprovalRequired?: boolean | null;
  readonly completionRequestedByRunId?: string | null;
  readonly approvalAccepted?: boolean;
  readonly rejectionRecorded?: boolean;
  readonly finalText?: string | null;
  readonly finalTextPresent?: boolean;
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
