import type {
  TeamExecution,
  TeamNodeExecution,
  TeamNodeExecutionStatus,
  TeamExecutionStatus,
} from '../../domain/invokables/team-execution.js';

export interface TeamExecutionRepository {
  create(execution: TeamExecution): Promise<void>;
  findById(
    id: string,
    owner: TeamExecutionOwner,
  ): Promise<TeamExecution | null>;
  findByRootRunId(
    rootRunId: string,
    owner: TeamExecutionOwner,
  ): Promise<TeamExecution | null>;
  findByChildTaskId(
    childTaskId: string,
    owner: TeamExecutionOwner,
  ): Promise<TeamExecution | null>;
  recordNodeResult(input: RecordNodeResultInput): Promise<TeamExecution>;
  setStatus(
    id: string,
    owner: TeamExecutionOwner,
    status: TeamExecutionStatus,
    result?: string | null,
    failureDetail?: string | null,
  ): Promise<void>;
  environmentVersionForChild(
    id: string,
    owner: TeamExecutionOwner,
  ): Promise<string | null>;
}
export interface TeamExecutionOwner {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly principalType: string;
  readonly principalId: string;
}
export interface RecordNodeResultInput extends TeamExecutionOwner {
  readonly teamExecutionId: string;
  readonly nodeId: string;
  readonly status: TeamNodeExecutionStatus;
  readonly childTaskId?: string | null;
  readonly childRunId?: string | null;
  readonly result?: string | null;
  readonly failureDetail?: string | null;
}
export type { TeamNodeExecution };
