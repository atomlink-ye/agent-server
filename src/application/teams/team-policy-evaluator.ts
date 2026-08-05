import { AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS } from '../../domain/teams/canonical-team-role-tools.js';
import {
  canonicalTeamToolRefsForDirectMessage,
  canonicalTeamToolRefsForRole,
} from '../../domain/teams/canonical-team-role-tools.js';
export {
  canonicalTeamToolRefsForDirectMessage,
  canonicalTeamToolRefsForRole,
} from '../../domain/teams/canonical-team-role-tools.js';
import type { TeamToolContext } from './team-tool-context.js';
import type { TeamRun } from '../../domain/teams/team-run.js';
import type { TeamWorkItem } from '../../domain/teams/team-work-item.js';
import type { TeamWorkItemAttempt } from '../../domain/teams/team-work-item-attempt.js';

export const AGENTIC_TEAM_LIMITS = Object.freeze({
  maxLeadTurns: 8,
  maxWorkItems: 4,
  maxAttemptsPerItem: 2,
});
export type AgenticLeadCommand =
  | 'team_work_create'
  | 'team_work_accept'
  | 'team_work_request_changes'
  | 'team_finish';
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
    team.completionRequestedByRunId !== null
  )
    return none();
  if (limits.remainingLeadTurns === 0 && team.controlState !== 'lead_running')
    return none();
  if (!workItems.length)
    return { ...none(), allowedCommands: ['team_work_create'] };
  const accepted = workItems.every((item) => item.status === 'accepted');
  if (accepted) return { ...none(), allowedCommands: ['team_finish'] };
  const accept: string[] = [],
    rework: string[] = [];
  for (const item of workItems) {
    if (item.status === 'accepted') continue;
    const latest = attempts
      .filter((a) => a.workItemId === item.id)
      .sort((a, b) => b.attemptNo - a.attemptNo)[0];
    if (!latest || latest.status !== 'completed' || !latest.resultSummary)
      continue;
    accept.push(item.id);
    if (latest.attemptNo < AGENTIC_TEAM_LIMITS.maxAttemptsPerItem)
      rework.push(item.id);
  }
  const allowed: AgenticLeadCommand[] = [];
  if (accept.length) allowed.push('team_work_accept');
  if (rework.length) allowed.push('team_work_request_changes');
  if (allowed.length)
    return {
      ...none(),
      allowedCommands: allowed,
      eligibleAcceptWorkItemIds: accept,
      eligibleReworkWorkItemIds: rework,
    };
  if (limits.remainingWorkItems > 0)
    return { ...none(), allowedCommands: ['team_work_create'] };
  return none();
}

export type TeamPolicy = Readonly<{ allowedTools: readonly string[] }>;

const canonicalTeamSafeReadToolRefs = canonicalTeamToolRefsForDirectMessage();

export function canonicalTeamToolRefsForLeadPolicy(
  policy: Pick<AgenticLeadCommandPolicy, 'allowedCommands'>,
): readonly string[] {
  const commandRefs: Record<AgenticLeadCommand, string> = {
    team_work_create: AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.workCreate,
    team_work_accept: AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.accept,
    team_work_request_changes:
      AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.requestChanges,
    team_finish: AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.finish,
  };
  return Object.freeze([
    AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.state,
    AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.workList,
    AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.messageSend,
    ...policy.allowedCommands.map((command) => commandRefs[command]),
  ]);
}

export class TeamPolicyEvaluator {
  public evaluate(context: TeamToolContext): TeamPolicy {
    const permitted =
      context.task.teamTaskKind === 'direct_message'
        ? canonicalTeamToolRefsForDirectMessage()
        : context.task.teamTaskKind === 'work_attempt' &&
            context.attempt?.status === 'completed'
          ? canonicalTeamSafeReadToolRefs
          : context.task.teamTaskKind === 'work_attempt' &&
              context.member.role === 'member'
            ? canonicalTeamToolRefsForRole('member')
            : context.task.teamTaskKind === 'lead_turn' &&
                context.member.role === 'lead'
              ? canonicalTeamToolRefsForRole('lead')
              : [];
    return Object.freeze({
      allowedTools: Object.freeze(
        permitted.filter((ref) => context.grant.allowedTools.includes(ref)),
      ),
    });
  }
}
