import {
  AGENT_SERVER_COLLABORATION_TOOL_REFS,
  collaborationToolRefsForCapabilities,
  collaborationToolRefsForMessageTurn,
  collaborationToolRefsForRole,
} from '../../domain/collaboration/canonical-collaboration-tools.js';
import { COLLABORATION_LIMITS } from '../../domain/collaboration/collaboration-policy-definition.js';
import type { TeamCompletionDecision } from '../../domain/teams/team-completion-decision.js';
import type { TeamRun } from '../../domain/teams/team-run.js';
import type { TeamWorkItem } from '../../domain/teams/team-work-item.js';
import type { TeamWorkItemAttempt } from '../../domain/teams/team-work-item-attempt.js';
import type { TeamToolContext } from './team-tool-context.js';

export type CollaborationLeadCommand =
  | 'board_create'
  | 'board_accept'
  | 'board_cancel'
  | 'board_request_changes'
  | 'collaboration_finish';

export interface AgenticLeadCommandPolicy {
  readonly allowedCommands: readonly CollaborationLeadCommand[];
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
    team.status === 'active' &&
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
    maxLeadTurns: COLLABORATION_LIMITS.maxLeadTurns,
    remainingLeadTurns: Math.max(
      0,
      COLLABORATION_LIMITS.maxLeadTurns - turnsSinceDecision,
    ),
    maxWorkItems: COLLABORATION_LIMITS.maxWorkItems,
    remainingWorkItems: Math.max(
      0,
      COLLABORATION_LIMITS.maxWorkItems - workItems.length,
    ),
    maxAttemptsPerItem: COLLABORATION_LIMITS.maxAttemptsPerItem,
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
    return { ...none(), allowedCommands: ['board_create'] };

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
    return { ...none(), allowedCommands: ['collaboration_finish'] };

  const accept: string[] = [];
  const rework: string[] = [];
  const cancel: string[] = [];
  for (const item of workItems) {
    const rejectedTarget = eligibleRejectedTargets.has(item.id);
    if (item.status === 'accepted' || item.status === 'cancelled') {
      if (rejectedTarget) rework.push(item.id);
      continue;
    }
    const latest = attempts
      .filter((attempt) => attempt.workItemId === item.id)
      .sort((a, b) => b.attemptNo - a.attemptNo)[0];
    if (!latest) continue;
    if (
      item.status === 'blocked' &&
      latest.status === 'completed' &&
      latest.resultSummary
    ) {
      rework.push(item.id);
      cancel.push(item.id);
      continue;
    }
    if (latest.status === 'failed' && item.status === 'in_progress') {
      cancel.push(item.id);
      continue;
    }
    if (latest.status !== 'completed' || !latest.resultSummary) continue;
    accept.push(item.id);
    if (
      latest.attemptNo < COLLABORATION_LIMITS.maxAttemptsPerItem ||
      rejectedTarget
    )
      rework.push(item.id);
  }

  const allowed: CollaborationLeadCommand[] = [];
  if (cancel.length) allowed.push('board_cancel');
  if (accept.length) allowed.push('board_accept');
  if (rework.length) allowed.push('board_request_changes');
  if (allowed.length)
    return {
      ...none(),
      allowedCommands: allowed,
      eligibleAcceptWorkItemIds: accept,
      eligibleReworkWorkItemIds: rework,
      eligibleCancelWorkItemIds: cancel,
    };
  if (limits.remainingWorkItems > 0)
    return { ...none(), allowedCommands: ['board_create'] };
  return none();
}

export type TeamPolicy = Readonly<{ allowedTools: readonly string[] }>;

const SAFE_READ_REFS = collaborationToolRefsForCapabilities([
  'board.read',
  'mailbox.read',
]);

export function collaborationToolRefsForLeadPolicy(
  policy: Pick<AgenticLeadCommandPolicy, 'allowedCommands'>,
): readonly string[] {
  const commandRefs: Record<CollaborationLeadCommand, string> = {
    board_create: AGENT_SERVER_COLLABORATION_TOOL_REFS.boardCreate,
    board_accept: AGENT_SERVER_COLLABORATION_TOOL_REFS.boardAccept,
    board_cancel: AGENT_SERVER_COLLABORATION_TOOL_REFS.boardCancel,
    board_request_changes:
      AGENT_SERVER_COLLABORATION_TOOL_REFS.boardRequestChanges,
    collaboration_finish: AGENT_SERVER_COLLABORATION_TOOL_REFS.finish,
  };
  const sameTurnFinish = policy.allowedCommands.includes('board_accept')
    ? [AGENT_SERVER_COLLABORATION_TOOL_REFS.finish]
    : [];
  return Object.freeze([
    ...new Set([
      ...collaborationToolRefsForCapabilities([
        'board.read',
        'mailbox.read',
        'mailbox.send',
        'mailbox.ack',
      ]),
      ...policy.allowedCommands.map((command) => commandRefs[command]),
      ...sameTurnFinish,
    ]),
  ]);
}

export class TeamPolicyEvaluator {
  public evaluate(context: TeamToolContext): TeamPolicy {
    const permitted =
      context.task.teamTaskKind === 'direct_message'
        ? collaborationToolRefsForMessageTurn()
        : context.task.teamTaskKind === 'work_attempt' &&
            context.attempt?.status === 'completed'
          ? SAFE_READ_REFS
          : context.task.teamTaskKind === 'work_attempt' &&
              context.member.role === 'member'
            ? collaborationToolRefsForRole('member')
            : context.task.teamTaskKind === 'lead_turn' &&
                context.member.role === 'lead'
              ? collaborationToolRefsForRole('lead')
              : [];
    return Object.freeze({
      allowedTools: Object.freeze(
        permitted.filter((ref) => context.grant.allowedTools.includes(ref)),
      ),
    });
  }
}
