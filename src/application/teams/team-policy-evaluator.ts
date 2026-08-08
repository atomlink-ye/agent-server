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
import type { TeamCompletionDecision } from '../../domain/teams/team-completion-decision.js';
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
  | 'team_work_cancel'
  | 'team_work_request_changes'
  | 'team_finish';
export interface AgenticLeadCommandPolicy {
  readonly allowedCommands: readonly AgenticLeadCommand[];
  readonly eligibleAcceptWorkItemIds: readonly string[];
  readonly eligibleReworkWorkItemIds: readonly string[];
  readonly eligibleCancelWorkItemIds: readonly string[];
  readonly limits: {
    readonly maxLeadTurns: number;
    readonly remainingLeadTurns: number;
    readonly maxWorkItems: number;
    readonly remainingWorkItems: number;
    readonly maxAttemptsPerItem: number;
  };
}

export function completionDecisionMatchesCurrentRequest(
  team: TeamRun,
  decision: TeamCompletionDecision | null | undefined,
): boolean {
  return Boolean(
    decision &&
    team.completionRequestedByRunId !== null &&
    decision.teamRunId === team.id &&
    decision.tenantId === team.tenantId &&
    decision.workspaceId === team.workspaceId &&
    decision.principalType === team.principalType &&
    decision.principalId === team.principalId &&
    decision.completionRequestedByRunId === team.completionRequestedByRunId,
  );
}

export function isTeamCompletionApprovalPending(
  team: TeamRun,
  decision: TeamCompletionDecision | null | undefined,
): boolean {
  return Boolean(
    team.completionApprovalRequired &&
    team.completionRequestedByRunId !== null &&
    !completionDecisionMatchesCurrentRequest(team, decision),
  );
}

export function deriveAgenticLeadCommandPolicy(
  team: TeamRun,
  workItems: readonly TeamWorkItem[],
  attempts: readonly TeamWorkItemAttempt[],
  latestDecision?: TeamCompletionDecision | null,
): AgenticLeadCommandPolicy {
  const currentRejection =
    latestDecision?.decision === 'reject' &&
    completionDecisionMatchesCurrentRequest(team, latestDecision) &&
    latestDecision.leadTurnCountAtDecision <= team.leadTurnCount;
  const turnsSinceDecision = currentRejection
    ? Math.max(0, team.leadTurnCount - latestDecision.leadTurnCountAtDecision)
    : team.leadTurnCount;
  const limits = {
    maxLeadTurns: AGENTIC_TEAM_LIMITS.maxLeadTurns,
    remainingLeadTurns: Math.max(
      0,
      AGENTIC_TEAM_LIMITS.maxLeadTurns - turnsSinceDecision,
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
    eligibleCancelWorkItemIds: [] as const,
    limits,
  });
  if (
    team.status !== 'active' ||
    team.controlState === 'terminal' ||
    (team.completionRequestedByRunId !== null && !currentRejection)
  )
    return none();
  if (limits.remainingLeadTurns === 0 && team.controlState !== 'lead_running')
    return none();
  if (!workItems.length)
    return { ...none(), allowedCommands: ['team_work_create'] };
  const eligibleRejectedTargets = new Set<string>();
  if (currentRejection) {
    const targetAttempts = new Map(
      latestDecision.targets.map((target) => [target.workItemId, target]),
    );
    for (const item of workItems) {
      const target = targetAttempts.get(item.id);
      if (!target || item.status !== 'accepted') continue;
      const latest = attempts
        .filter((attempt) => attempt.workItemId === item.id)
        .sort((a, b) => b.attemptNo - a.attemptNo)[0];
      if (
        latest?.status === 'completed' &&
        latest.resultSummary &&
        latest.attemptNo === target.attemptNoAtDecision
      )
        eligibleRejectedTargets.add(item.id);
    }
  }
  const acceptedOrCancelled = workItems.every((item) =>
    ['accepted', 'cancelled'].includes(item.status),
  );
  if (acceptedOrCancelled && eligibleRejectedTargets.size === 0)
    return { ...none(), allowedCommands: ['team_finish'] };
  const accept: string[] = [],
    rework: string[] = [],
    cancel: string[] = [];
  for (const item of workItems) {
    const rejectedTarget = eligibleRejectedTargets.has(item.id);
    if (item.status === 'accepted' || item.status === 'cancelled') {
      if (rejectedTarget) rework.push(item.id);
      continue;
    }
    const latest = attempts
      .filter((a) => a.workItemId === item.id)
      .sort((a, b) => b.attemptNo - a.attemptNo)[0];
    if (!latest) continue;
    if (latest.status === 'failed' && item.status === 'in_progress') {
      cancel.push(item.id);
      continue;
    }
    if (latest.status !== 'completed' || !latest.resultSummary) continue;
    accept.push(item.id);
    if (
      latest.attemptNo < AGENTIC_TEAM_LIMITS.maxAttemptsPerItem ||
      rejectedTarget
    )
      rework.push(item.id);
  }
  const allowed: AgenticLeadCommand[] = [];
  if (cancel.length) allowed.push('team_work_cancel');
  if (accept.length) allowed.push('team_work_accept');
  if (rework.length) allowed.push('team_work_request_changes');
  if (allowed.length)
    return {
      ...none(),
      allowedCommands: allowed,
      eligibleAcceptWorkItemIds: accept,
      eligibleReworkWorkItemIds: rework,
      eligibleCancelWorkItemIds: cancel,
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
    team_work_cancel: AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.cancel,
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
