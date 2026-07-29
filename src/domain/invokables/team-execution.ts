export const teamExecutionStatuses = [
  'running',
  'waiting_children',
  'succeeded',
  'failed',
] as const;
export type TeamExecutionStatus = (typeof teamExecutionStatuses)[number];
export const teamNodeExecutionStatuses = [
  'pending',
  'queued',
  'running',
  'succeeded',
  'failed',
  'blocked',
] as const;
export type TeamNodeExecutionStatus =
  (typeof teamNodeExecutionStatuses)[number];

export interface TeamNodeExecution {
  readonly id: string;
  readonly teamExecutionId: string;
  readonly nodeId: string;
  readonly dependencyNodeIds: readonly string[];
  readonly childTaskId: string | null;
  readonly childRunId: string | null;
  readonly status: TeamNodeExecutionStatus;
  readonly result: string | null;
  readonly failureDetail: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TeamExecution {
  readonly id: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly principalType: string;
  readonly principalId: string;
  readonly rootTaskId: string;
  readonly rootRunId: string;
  readonly teamVersionId: string;
  readonly environmentVersionId: string;
  readonly status: TeamExecutionStatus;
  readonly result: string | null;
  readonly failureDetail: string | null;
  readonly nodes: readonly TeamNodeExecution[];
  readonly createdAt: string;
  readonly updatedAt: string;
}
