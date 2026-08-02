import type { TeamRun } from '../../domain/teams/team-run.js';
import type { TeamWorkItem } from '../../domain/teams/team-work-item.js';
import type { TeamWorkItemAttempt } from '../../domain/teams/team-work-item-attempt.js';

export const AGENTIC_TEAM_LIMITS = Object.freeze({
  maxLeadTurns: 4,
  maxWorkItems: 4,
  maxAttemptsPerItem: 2,
});

export type AgenticLeadCommand =
  | 'team_work_create_and_assign'
  | 'team_work_accept'
  | 'team_work_request_rework'
  | 'team_completion_request';

export interface AgenticLeadCommandPolicy {
  readonly allowedCommands: readonly AgenticLeadCommand[];
  readonly eligibleAcceptWorkItemIds: readonly string[];
  readonly eligibleReworkWorkItemIds: readonly string[];
  readonly limits: {
    readonly maxLeadTurns: number;
    readonly remainingLeadTurns: number;
    readonly maxWorkItems: number;
    readonly remainingWorkItems: number;
    readonly maxAttemptsPerItem: number;
  };
}

export function deriveAgenticLeadCommandPolicy(
  team: TeamRun,
  workItems: readonly TeamWorkItem[],
  attempts: readonly TeamWorkItemAttempt[],
): AgenticLeadCommandPolicy {
  const limits = {
    maxLeadTurns: AGENTIC_TEAM_LIMITS.maxLeadTurns,
    remainingLeadTurns: Math.max(
      0,
      AGENTIC_TEAM_LIMITS.maxLeadTurns - team.leadTurnCount,
    ),
    maxWorkItems: AGENTIC_TEAM_LIMITS.maxWorkItems,
    remainingWorkItems: Math.max(
      0,
      AGENTIC_TEAM_LIMITS.maxWorkItems - workItems.length,
    ),
    maxAttemptsPerItem: AGENTIC_TEAM_LIMITS.maxAttemptsPerItem,
  };
  const none = () => ({
    allowedCommands: [] as const,
    eligibleAcceptWorkItemIds: [] as const,
    eligibleReworkWorkItemIds: [] as const,
    limits,
  });

  if (
    team.status !== 'active' ||
    team.controlState === 'terminal' ||
    team.completionRequestedByRunId !== null ||
    attempts.some(
      (attempt) => attempt.status === 'queued' || attempt.status === 'running',
    )
  )
    return none();

  if (limits.remainingLeadTurns === 0 && team.controlState !== 'lead_running')
    return none();

  if (workItems.length === 0)
    return {
      ...none(),
      allowedCommands: ['team_work_create_and_assign'],
    };

  const accepted = workItems.every((item) => item.status === 'accepted');
  if (accepted)
    return {
      ...none(),
      allowedCommands: ['team_completion_request'],
    };

  const eligibleAcceptWorkItemIds: string[] = [];
  const eligibleReworkWorkItemIds: string[] = [];
  for (const item of workItems) {
    if (item.status === 'accepted') continue;
    const latest = latestAttempt(item.id, attempts);
    if (!latest || latest.status !== 'completed' || !latest.resultSummary)
      continue;
    eligibleAcceptWorkItemIds.push(item.id);
    if (latest.attemptNo < AGENTIC_TEAM_LIMITS.maxAttemptsPerItem)
      eligibleReworkWorkItemIds.push(item.id);
  }

  const allowedCommands: AgenticLeadCommand[] = [];
  if (eligibleAcceptWorkItemIds.length)
    allowedCommands.push('team_work_accept');
  if (eligibleReworkWorkItemIds.length)
    allowedCommands.push('team_work_request_rework');
  if (limits.remainingWorkItems > 0)
    allowedCommands.push('team_work_create_and_assign');
  return {
    ...none(),
    allowedCommands,
    eligibleAcceptWorkItemIds,
    eligibleReworkWorkItemIds,
  };
}

function latestAttempt(
  workItemId: string,
  attempts: readonly TeamWorkItemAttempt[],
): TeamWorkItemAttempt | undefined {
  return attempts
    .filter((attempt) => attempt.workItemId === workItemId)
    .sort((a, b) => b.attemptNo - a.attemptNo)[0];
}
