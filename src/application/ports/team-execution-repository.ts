import type { TeamRun } from '../../domain/teams/team-run.js';
import type { TeamMemberRun } from '../../domain/teams/team-member-run.js';
import type { TeamWorkItem } from '../../domain/teams/team-work-item.js';
import type { TeamWorkItemAttempt } from '../../domain/teams/team-work-item-attempt.js';
import type { OwnerScope } from '../../domain/tenancy/owner-scope.js';
export type { OwnerScope } from '../../domain/tenancy/owner-scope.js';

export interface TeamWorkDependency {
  readonly workItemId: string;
  readonly dependsOnWorkItemId: string;
}

export type TeamExecutionErrorCode =
  | 'stale_state'
  | 'not_allowed'
  | 'not_found'
  | 'conflict'
  | 'invalid_transition'
  | 'invalid_target'
  | 'limit_exceeded'
  | 'team_terminal';

export class TeamExecutionError extends Error {
  public constructor(public readonly code: TeamExecutionErrorCode) {
    super(code);
    this.name = 'TeamExecutionError';
  }
}

export type FailTeamRunInput = Readonly<{
  teamRunId: string;
  rootRunId: string;
  rootTaskId: string;
  owner: OwnerScope;
  updatedAt: string;
  failure: {
    readonly code: 'runtime_execution_failed';
    readonly message: string;
  };
}> &
  (
    | Readonly<{
        stopReason: 'lead_no_progress';
        expectedRevision: number;
      }>
    | Readonly<{
        stopReason: 'lead_turn_limit' | 'lead_run_failed';
        expectedRevision?: never;
      }>
    | Readonly<{
        stopReason: 'succeeded_without_submit';
        attemptId: string;
        childTaskId: string;
        childRunId: string;
        expectedRevision?: never;
      }>
  );

export interface TeamExecutionRepository {
  createTeamRun(run: TeamRun): Promise<void>;
  findTeamRunById(id: string, owner: OwnerScope): Promise<TeamRun | null>;
  findTeamRunByRootTaskId(
    rootTaskId: string,
    owner: OwnerScope,
  ): Promise<TeamRun | null>;
  findLatestAgenticTeamRun(
    owner: OwnerScope,
    rootTaskId?: string,
  ): Promise<TeamRun | null>;
  completeTeamRunAtomically(input: {
    readonly teamRunId: string;
    readonly rootRunId: string;
    readonly rootTaskId: string;
    readonly finalText: string;
    readonly owner: OwnerScope;
    readonly updatedAt: string;
    readonly leadRunId?: string;
    readonly approvalDecision?: {
      readonly expectedRevision: number;
      readonly decidedBy: string;
      readonly decidedAt: string;
    };
  }): Promise<TeamRun>;
  failTeamRunAtomically(input: FailTeamRunInput): Promise<TeamRun>;
  recoverExpiredTeamRuns(now: string): Promise<
    readonly {
      readonly teamRunId: string;
      readonly childRunId: string;
      readonly teamTaskKind: 'lead_turn' | 'work_attempt';
      readonly affectedChildRunCount: number;
    }[]
  >;

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

  findWorkItemsByTeamRunId(
    teamRunId: string,
    owner: OwnerScope,
  ): Promise<TeamWorkItem[]>;
  findWorkItemById(id: string, owner: OwnerScope): Promise<TeamWorkItem | null>;
  findWorkDependenciesByTeamRunId(
    teamRunId: string,
    owner: OwnerScope,
  ): Promise<readonly TeamWorkDependency[]>;
  findAttemptsByTeamRunId(
    teamRunId: string,
    owner: OwnerScope,
  ): Promise<TeamWorkItemAttempt[]>;
  materializeAttempt(input: {
    readonly attemptId: string;
    readonly executionTaskId: string;
    readonly teamRunId: string;
    readonly assigneeMemberId: string;
    readonly expectedRevision: number;
    readonly owner: OwnerScope;
  }): Promise<TeamWorkItemAttempt>;
  updateAttemptStatus(
    attemptId: string,
    status: TeamWorkItemAttempt['status'],
    resultSummary: string | null,
    owner: OwnerScope,
  ): Promise<TeamWorkItemAttempt>;
  submitCurrentAttempt(input: {
    readonly teamRunId: string;
    readonly executionTaskId: string;
    readonly currentRunId: string;
    readonly memberId: string;
    readonly resultSummary: string;
    readonly owner: OwnerScope;
  }): Promise<TeamWorkItemAttempt>;

  createAssignedWork(input: {
    readonly teamRunId: string;
    readonly sourceRunId: string;
    readonly leadTaskId: string;
    readonly assigneeMemberId: string;
    readonly subject: string;
    readonly description: string | null;
    readonly dependsOnWorkItemIds?: readonly string[];
    readonly commandHash: string;
    readonly expectedRevision: number;
    readonly owner: OwnerScope;
  }): Promise<{ item: TeamWorkItem; attempt: TeamWorkItemAttempt }>;
  acceptWork(input: {
    readonly teamRunId: string;
    readonly workItemId: string;
    readonly sourceRunId: string;
    readonly leadTaskId?: string;
    readonly commandHash: string;
    readonly expectedRevision: number;
    readonly owner: OwnerScope;
  }): Promise<TeamWorkItem>;
  cancelWork(input: {
    readonly teamRunId: string;
    readonly workItemId: string;
    readonly sourceRunId: string;
    readonly leadTaskId?: string;
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
    readonly leadTaskId?: string;
    readonly commandHash: string;
    readonly expectedRevision: number;
    readonly owner: OwnerScope;
  }): Promise<{ requested: true }>;
  advanceAgenticLead(input: {
    teamRunId: string;
    expectedRevision: number;
    owner: OwnerScope;
  }): Promise<TeamRun>;
  findCompletionDecisionsByTeamRunId(
    teamRunId: string,
    owner: OwnerScope,
  ): Promise<
    readonly import('../../domain/teams/team-completion-decision.js').TeamCompletionDecision[]
  >;
  findLatestCompletionDecision(
    teamRunId: string,
    owner: OwnerScope,
  ): Promise<
    | import('../../domain/teams/team-completion-decision.js').TeamCompletionDecision
    | null
  >;
  findCompletionDecisionForRequest(
    teamRunId: string,
    completionRequestedByRunId: string,
    owner: OwnerScope,
  ): Promise<
    | import('../../domain/teams/team-completion-decision.js').TeamCompletionDecision
    | null
  >;
  recordCompletionRejectionInTransaction(input: {
    readonly teamRunId: string;
    readonly completionRequestedByRunId: string;
    readonly feedback: string;
    readonly workItemIds: readonly string[];
    readonly decidedBy: string;
    readonly decidedAt: string;
    readonly expectedRevision: number;
    readonly owner: OwnerScope;
  }): Promise<{
    readonly decision: import('../../domain/teams/team-completion-decision.js').TeamCompletionDecision;
    readonly team: TeamRun;
    readonly recorded: boolean;
  }>;
}
