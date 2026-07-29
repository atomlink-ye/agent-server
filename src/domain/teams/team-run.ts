import { randomUUID } from 'node:crypto';

export type TeamRunStatus = 'active' | 'waiting' | 'succeeded' | 'failed';
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
  readonly now?: () => Date;
}

export function createTeamRun(options: CreateTeamRunOptions): TeamRun {
  const timestamp = (options.now ?? (() => new Date()))().toISOString();
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
    phase: 'lead_kickoff' as const,
    finalText: null,
    createdAt: timestamp,
    updatedAt: timestamp,
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

export function succeedTeamRun(
  run: TeamRun,
  finalText: string,
  now: () => Date = () => new Date(),
): TeamRun {
  return Object.freeze({
    ...run,
    status: 'succeeded' as const,
    phase: 'done' as const,
    finalText,
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
