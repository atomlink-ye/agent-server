/** Workspace-only owner scope for the Work read boundary. */
export interface WorkProjectionWorkspaceScope {
  readonly tenantId: string;
  readonly workspaceId: string;
}

/** Technical lineage is kept separate from product identity. */
export interface WorkProjectionSourceRefs {
  readonly rootTaskId?: string;
  readonly teamRunId?: string;
  readonly teamMemberRunId?: string;
  readonly taskId?: string;
  readonly runId?: string;
  readonly teamMessageId?: string;
}

export type WorkProjectionAttemptStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed';

export interface WorkProjectionAttemptFact {
  readonly id: string;
  readonly workItemId: string;
  readonly attemptNo: number;
  readonly status: WorkProjectionAttemptStatus;
  /** Captured for provenance only; the Product mapper does not disclose it. */
  readonly feedbackCapture: 'present' | 'absent';
  readonly resultCapture: 'present' | 'absent';
  readonly sourceRefs: WorkProjectionSourceRefs;
}

export interface WorkProjectionWorkItemFact {
  readonly id: string;
  readonly subject: string;
  readonly description: string | null;
  readonly status: string;
  /** Existing member-run UUID used as the actor source identity. */
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
  /** Capture status only; message body is never exposed by S2. */
  readonly bodyCapture: 'present' | 'absent';
  readonly sourceRefs: WorkProjectionSourceRefs;
}

/** Facts intentionally contain no Work/WorkRun product IDs in S2. */
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

/** Repository-facing reader; technical storage stays outside application. */
export interface WorkProjectionFactsReader {
  getByRootTask(
    owner: WorkProjectionWorkspaceScope,
    rootTaskId: string,
  ): Promise<WorkProjectionFacts | null>;
}
