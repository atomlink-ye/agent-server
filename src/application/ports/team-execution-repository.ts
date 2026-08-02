import type { TeamRun } from '../../domain/teams/team-run.js';
import type { TeamMemberRun } from '../../domain/teams/team-member-run.js';
import type { TeamWorkItem } from '../../domain/teams/team-work-item.js';
import type { TeamWorkItemAttempt } from '../../domain/teams/team-work-item-attempt.js';
import type {
  TeamExecution,
  TeamNodeExecution,
} from '../../domain/invokables/team-execution.js';

export interface OwnerScope {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly principalType: string;
  readonly principalId: string;
}

// -- DAG execution repository (legacy) --
export interface DagTeamExecutionRepository {
  create(execution: TeamExecution): Promise<void>;
  findByChildTaskId(
    childTaskId: string,
    owner: OwnerScope,
  ): Promise<TeamExecution | null>;
  recordNodeResult(input: RecordNodeResultInput): Promise<TeamExecution>;
  setStatus(
    id: string,
    owner: OwnerScope,
    status: TeamExecution['status'],
    result: string | null,
    failureDetail?: string | null,
  ): Promise<void>;
}

export interface RecordNodeResultInput {
  readonly teamExecutionId: string;
  readonly nodeId: string;
  readonly status: TeamNodeExecution['status'];
  readonly childTaskId?: string | null;
  readonly childRunId?: string | null;
  readonly result?: string | null;
  readonly failureDetail?: string | null;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly principalType: string;
  readonly principalId: string;
}

// -- Collaborative team execution repository (new) --
export interface TeamExecutionRepository {
  createTeamRun(run: TeamRun): Promise<void>;
  findTeamRunById(id: string, owner: OwnerScope): Promise<TeamRun | null>;
  findTeamRunByRootTaskId(
    rootTaskId: string,
    owner: OwnerScope,
  ): Promise<TeamRun | null>;
  updateTeamRunPhase(
    id: string,
    phase: TeamRun['phase'],
    owner: OwnerScope,
    expectedPhase?: TeamRun['phase'],
  ): Promise<TeamRun>;
  updateTeamRunPhaseIfCurrent(
    id: string,
    phase: TeamRun['phase'],
    owner: OwnerScope,
    expectedPhase: TeamRun['phase'],
  ): Promise<TeamRun | null>;
  updateTeamRunStatus(
    id: string,
    status: TeamRun['status'],
    finalText: string | null,
    owner: OwnerScope,
  ): Promise<TeamRun>;
  completeTeamRunAtomically(input: {
    readonly teamRunId: string;
    readonly rootRunId: string;
    readonly rootTaskId: string;
    readonly finalText: string;
    readonly owner: OwnerScope;
    readonly updatedAt: string;
  }): Promise<TeamRun>;

  createMemberRun(member: TeamMemberRun): Promise<void>;
  findMembersByTeamRunId(
    teamRunId: string,
    owner: OwnerScope,
  ): Promise<TeamMemberRun[]>;
  findMemberRunById(
    id: string,
    owner: OwnerScope,
  ): Promise<TeamMemberRun | null>;
  updateMemberRunStatus(
    id: string,
    status: TeamMemberRun['status'],
    runtimeSessionId?: string | null,
    owner?: OwnerScope,
  ): Promise<TeamMemberRun>;
  updateMemberRuntimeSession(
    id: string,
    runtimeSessionId: string,
    owner: OwnerScope,
  ): Promise<TeamMemberRun>;

  createWorkItem(item: TeamWorkItem): Promise<void>;
  findWorkItemsByTeamRunId(
    teamRunId: string,
    owner: OwnerScope,
  ): Promise<TeamWorkItem[]>;
  findWorkItemById(id: string, owner: OwnerScope): Promise<TeamWorkItem | null>;
  atomicClaimWorkItem(
    id: string,
    ownerMemberId: string,
    teamRunId: string,
    owner: OwnerScope,
  ): Promise<TeamWorkItem>;
  updateWorkItemStatus(
    id: string,
    status: TeamWorkItem['status'],
    completionSummary: string | null,
    owner: OwnerScope & {
      readonly memberId?: string;
      readonly role?: 'lead' | 'member';
    },
  ): Promise<TeamWorkItem>;
  findAttemptsByTeamRunId(
    teamRunId: string,
    owner: OwnerScope,
  ): Promise<TeamWorkItemAttempt[]>;
  bindAttemptExecution(
    attemptId: string,
    executionTaskId: string,
    owner: OwnerScope,
  ): Promise<TeamWorkItemAttempt>;
  updateAttemptStatus(
    attemptId: string,
    status: TeamWorkItemAttempt['status'],
    resultSummary: string | null,
    owner: OwnerScope,
  ): Promise<TeamWorkItemAttempt>;

  createAssignedWork(input: {
    readonly teamRunId: string;
    readonly sourceRunId: string;
    readonly leadTaskId: string;
    readonly assigneeMemberId: string;
    readonly subject: string;
    readonly description: string | null;
    readonly commandHash: string;
    readonly expectedRevision: number;
    readonly owner: OwnerScope;
  }): Promise<{ item: TeamWorkItem; attempt: TeamWorkItemAttempt }>;
  acceptWork(input: {
    readonly teamRunId: string;
    readonly workItemId: string;
    readonly sourceRunId: string;
    readonly commandHash: string;
    readonly expectedRevision: number;
    readonly owner: OwnerScope;
  }): Promise<TeamWorkItem>;
  requestRework(input: {
    readonly teamRunId: string;
    readonly workItemId: string;
    readonly assigneeMemberId: string;
    readonly feedback: string;
    readonly sourceRunId: string;
    readonly leadTaskId: string;
    readonly commandHash: string;
    readonly expectedRevision: number;
    readonly owner: OwnerScope;
  }): Promise<TeamWorkItemAttempt>;
  requestCompletion(input: {
    readonly teamRunId: string;
    readonly sourceRunId: string;
    readonly commandHash: string;
    readonly expectedRevision: number;
    readonly owner: OwnerScope;
  }): Promise<{ requested: true }>;
  advanceAgenticLead(input: {
    teamRunId: string;
    expectedRevision: number;
    owner: OwnerScope;
  }): Promise<TeamRun>;
}
