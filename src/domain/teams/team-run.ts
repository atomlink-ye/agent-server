import { randomUUID } from 'node:crypto';

export type TeamRunStatus = 'active' | 'waiting' | 'succeeded' | 'failed';
export type AgenticTeamControlState =
  'lead_ready' | 'lead_running' | 'member_work_running' | 'terminal';
export type TeamRunPhase =
  'lead_kickoff' | 'member_work' | 'lead_finalize' | 'done';

export interface TeamRun {
  readonly id: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly principalType: string;
  readonly principalId: string;
  readonly rootTaskId: string;
  readonly rootRunId: string;
  readonly teamVersionId: string;
  readonly environmentVersionId: string;
  readonly status: TeamRunStatus;
  readonly controlState: AgenticTeamControlState | null;
  readonly revision: number;
  readonly leadTurnCount: number;
  readonly stopReason: string | null;
  readonly completionRequestedByRunId: string | null;
  /** Snapshot of whether completion review is required for this Team run. */
  readonly completionApprovalRequired: boolean;
  readonly phase: TeamRunPhase;
  readonly finalText: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateTeamRunOptions {
  readonly id?: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly principalType: string;
  readonly principalId: string;
  readonly rootTaskId: string;
  readonly rootRunId: string;
  readonly teamVersionId: string;
  readonly environmentVersionId: string;
  /** Set when activation admits the initial Agentic lead task in this path. */
  readonly initialLeadTurn?: boolean;
  /** Snapshot of whether completion review is required for this Team run. */
  readonly completionApprovalRequired?: boolean;
  readonly now?: () => Date;
}

export function createTeamRun(options: CreateTeamRunOptions): TeamRun {
  const timestamp = (options.now ?? (() => new Date()))().toISOString();
  const initialAgenticLead = options.initialLeadTurn === true;
  return Object.freeze({
    id: options.id ?? randomUUID(),
    tenantId: options.tenantId,
    workspaceId: options.workspaceId,
    principalType: options.principalType,
    principalId: options.principalId,
    rootTaskId: options.rootTaskId,
    rootRunId: options.rootRunId,
    teamVersionId: options.teamVersionId,
    environmentVersionId: options.environmentVersionId,
    status: 'active' as const,
    controlState: initialAgenticLead ? 'lead_running' : 'lead_ready',
    revision: initialAgenticLead ? 1 : 0,
    leadTurnCount: initialAgenticLead ? 1 : 0,
    stopReason: null,
    completionRequestedByRunId: null,
    completionApprovalRequired: options.completionApprovalRequired ?? false,
    phase: 'lead_kickoff' as const,
    finalText: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export function normalizeTeamRunFinalText(finalText: string): string {
  const normalized = finalText.trim();
  if (!normalized) throw new Error('Team run final text must not be blank.');
  return normalized;
}
