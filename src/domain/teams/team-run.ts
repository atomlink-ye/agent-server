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
    phase: 'lead_kickoff' as const,
    finalText: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export function transitionAgenticControlState(
  run: TeamRun,
  expectedRevision: number,
  to: AgenticTeamControlState,
): TeamRun {
  if (run.revision !== expectedRevision)
    throw new Error('Team run revision conflict.');
  return Object.freeze({
    ...run,
    controlState: to,
    revision: run.revision + 1,
  });
}

export function transitionTeamRunPhase(
  run: TeamRun,
  toPhase: TeamRunPhase,
  now: () => Date = () => new Date(),
): TeamRun {
  const valid: Record<TeamRunPhase, TeamRunPhase[]> = {
    lead_kickoff: ['member_work'],
    member_work: ['lead_finalize'],
    lead_finalize: ['done'],
    done: [],
  };
  if (!valid[run.phase].includes(toPhase)) {
    throw new Error(`Invalid phase transition: ${run.phase} → ${toPhase}`);
  }
  return Object.freeze({
    ...run,
    phase: toPhase,
    updatedAt: now().toISOString(),
  });
}

export function normalizeTeamRunFinalText(finalText: string): string {
  const normalized = finalText.trim();
  if (!normalized) throw new Error('Team run final text must not be blank.');
  return normalized;
}

export function succeedTeamRun(
  run: TeamRun,
  finalText: string,
  now: () => Date = () => new Date(),
): TeamRun {
  const normalizedFinalText = normalizeTeamRunFinalText(finalText);
  return Object.freeze({
    ...run,
    status: 'succeeded' as const,
    phase: 'done' as const,
    finalText: normalizedFinalText,
    updatedAt: now().toISOString(),
  });
}

export function failTeamRun(
  run: TeamRun,
  now: () => Date = () => new Date(),
): TeamRun {
  return Object.freeze({
    ...run,
    status: 'failed' as const,
    updatedAt: now().toISOString(),
  });
}
