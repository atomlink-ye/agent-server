export type TeamWorkItemAttemptStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface TeamWorkItemAttempt {
  readonly id: string;
  readonly workItemId: string;
  readonly teamRunId: string;
  readonly attemptNo: number;
  readonly assigneeMemberId: string;
  readonly requestedByLeadTaskId: string;
  readonly feedback: string | null;
  readonly executionTaskId: string | null;
  readonly status: TeamWorkItemAttemptStatus;
  readonly resultSummary: string | null;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly principalType: string;
  readonly principalId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
}
