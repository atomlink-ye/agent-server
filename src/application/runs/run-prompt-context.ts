import {
  projectBoardStatus,
  workRef,
} from '../../domain/collaboration/collaboration.js';
import { RUN_API_COMPATIBILITY_INVOKABLE_VERSION_ID } from '../../domain/tasks/compatibility-invokable-version.js';
import type { Task } from '../../domain/tasks/task.js';
import type { TeamMemberRun } from '../../domain/teams/team-member-run.js';
import type { TeamRun } from '../../domain/teams/team-run.js';
import type { TeamWorkItem } from '../../domain/teams/team-work-item.js';
import type { TeamWorkItemAttempt } from '../../domain/teams/team-work-item-attempt.js';
import type { ResourceOwner } from '../../domain/tenancy/product-context.js';
import type {
  AgentResolutionApi,
  ResolvedAgentVersion,
} from '../ports/agent-resolution-api.js';
import type { FileStore } from '../ports/file-store.js';
import type { InvokableOwnerScope } from '../ports/invokable-repository.js';
import type { TaskRepository } from '../ports/task-repository.js';
import type { TeamExecutionRepository } from '../ports/team-execution-repository.js';
import {
  buildBootstrapPrompt,
  buildTeamSystemPrompt,
  buildTurnPrompt,
  formatTeamDeliveryPrompt,
  TEAM_LEAD_CONTROL_PROTOCOL,
  type TeamPromptRosterMember,
} from '../context/runtime-prompts.js';
import type { ResolvedSkillPackage } from '../extensions/skill-catalog.js';
import {
  deriveAgenticLeadCommandPolicy,
  type AgenticLeadCommandPolicy,
} from '../teams/team-policy-evaluator.js';

export interface ResolvedRunPrompt {
  readonly systemPrompt: string;
  readonly turnPrompt: string;
  readonly proposalLimit: number;
  readonly agentVersionId: string;
  readonly agentDefinitionId?: string;
  readonly agentOwner?: ResourceOwner;
  readonly modelPolicyRef: ResolvedAgentVersion['modelPolicyRef'];
  readonly skills: readonly ResolvedSkillPackage[];
  readonly toolRefs: readonly string[];
}

export interface AgenticLeadState {
  readonly policy: AgenticLeadCommandPolicy;
  readonly workItems: readonly TeamWorkItem[];
  readonly attempts: readonly TeamWorkItemAttempt[];
}

/**
 * Pure/read-only context assembly for an Agent turn. Runtime placement,
 * extension grants, event writes and execution side effects live elsewhere.
 */
export class RunPromptContext {
  public constructor(
    private readonly resolver: AgentResolutionApi,
    private readonly tasks: TaskRepository,
    private readonly fileStore?: FileStore,
    private readonly collaborativeExecutions?: TeamExecutionRepository,
  ) {}

  public async resolveInitial(input: {
    readonly prompt: string;
    readonly ownerScope: InvokableOwnerScope;
    readonly invokableVersionId: string;
    readonly task: Task;
  }): Promise<ResolvedRunPrompt> {
    if (
      input.invokableVersionId === RUN_API_COMPATIBILITY_INVOKABLE_VERSION_ID
    ) {
      return {
        systemPrompt: buildBootstrapPrompt(),
        turnPrompt: input.prompt,
        proposalLimit: 0,
        agentVersionId: input.invokableVersionId,
        modelPolicyRef: 'free-only',
        skills: [],
        toolRefs: [],
      };
    }

    const agentVersion = await this.resolver.resolvePublished(
      input.invokableVersionId,
      input.ownerScope,
    );
    if (!agentVersion)
      throw new Error(
        `Published agent version ${input.invokableVersionId} could not be loaded for execution`,
      );

    const memory = await this.loadPinnedMemory(input.task);
    return {
      systemPrompt: buildBootstrapPrompt(
        agentVersion.instructions,
        agentVersion.skills,
      ),
      turnPrompt: buildTurnPrompt({ taskInput: input.prompt, memory }),
      proposalLimit: agentVersion.proposalLimit ?? 0,
      agentVersionId: input.invokableVersionId,
      ...(agentVersion.definitionId
        ? { agentDefinitionId: agentVersion.definitionId }
        : {}),
      ...(agentVersion.agentOwner ? { agentOwner: agentVersion.agentOwner } : {}),
      modelPolicyRef: agentVersion.modelPolicyRef,
      skills: agentVersion.skills,
      toolRefs: agentVersion.toolRefs,
    };
  }

  public async resolveContinuation(input: {
    readonly prompt: string;
    readonly ownerScope: InvokableOwnerScope;
    readonly invokableVersionId: string;
    readonly task: Task;
  }): Promise<ResolvedRunPrompt> {
    const metadata =
      input.invokableVersionId === RUN_API_COMPATIBILITY_INVOKABLE_VERSION_ID
        ? { proposalLimit: 0, modelPolicyRef: 'free-only' as const }
        : await this.resolver.resolvePublished(
            input.invokableVersionId,
            input.ownerScope,
            { resolveExtensions: false },
          );
    if (!metadata)
      throw new Error(
        `Published agent version ${input.invokableVersionId} could not be loaded for execution`,
      );

    return {
      systemPrompt: '',
      turnPrompt: buildTurnPrompt({
        taskInput: input.prompt,
        memory: await this.loadPinnedMemory(input.task),
      }),
      proposalLimit: metadata.proposalLimit ?? 0,
      agentVersionId: input.invokableVersionId,
      ...('definitionId' in metadata && metadata.definitionId
        ? { agentDefinitionId: metadata.definitionId }
        : {}),
      ...('agentOwner' in metadata && metadata.agentOwner
        ? { agentOwner: metadata.agentOwner }
        : {}),
      modelPolicyRef: metadata.modelPolicyRef,
      skills: [],
      toolRefs: [],
    };
  }

  /**
   * The legacy policy snapshot is retained only to narrow compatibility aliases
   * while the new collaboration tools use capability-based authorization.
   */
  public async loadAgenticLeadState(
    team: TeamRun,
    task: Task,
  ): Promise<AgenticLeadState> {
    if (!this.collaborativeExecutions)
      throw new Error('Team execution context is unavailable.');
    const owner = {
      tenantId: task.tenantId,
      workspaceId: task.workspaceId,
      principalType: task.principalType,
      principalId: task.principalId,
    };
    const workItems =
      await this.collaborativeExecutions.findWorkItemsByTeamRunId(
        team.id,
        owner,
      );
    const attempts = await this.collaborativeExecutions.findAttemptsByTeamRunId(
      team.id,
      owner,
    );
    const decision = team.completionRequestedByRunId
      ? await this.collaborativeExecutions.findCompletionDecisionForRequest(
          team.id,
          team.completionRequestedByRunId,
          owner,
        )
      : null;
    return {
      workItems,
      attempts,
      policy: deriveAgenticLeadCommandPolicy(
        team,
        workItems,
        attempts,
        decision,
      ),
    };
  }

  public async buildTurnPrompts(input: {
    readonly resolved: ResolvedRunPrompt;
    readonly priorExternalSessionId: string | null;
    readonly team: TeamRun | null;
    readonly member: TeamMemberRun | null;
    readonly teamMembers: readonly TeamMemberRun[];
    readonly leadState: AgenticLeadState | null;
    readonly task: Task;
  }): Promise<{
    readonly systemPrompt: string;
    readonly deliveredTurnPrompt: string;
  }> {
    const turnPrompt =
      input.team != null && input.member?.role === 'lead'
        ? await this.withLeadCollaborationContext(
            input.resolved.turnPrompt,
            input.task,
            input.leadState,
            input.teamMembers,
          )
        : input.resolved.turnPrompt;
    const guidedTurnPrompt =
      input.member?.role === 'lead'
        ? turnPrompt
        : appendCollaborationTurnGuidance(turnPrompt, input.task.teamTaskKind);
    const systemPrompt =
      !input.priorExternalSessionId && input.team && input.member
        ? buildTeamSystemPrompt({
            role: input.member.role,
            roster: projectTeamRoster(input.teamMembers),
            staticText: [
              input.resolved.systemPrompt,
              ...(input.member.role === 'lead'
                ? [TEAM_LEAD_CONTROL_PROTOCOL]
                : []),
            ].join('\n\n'),
          })
        : !input.priorExternalSessionId
          ? input.resolved.systemPrompt
          : '';
    const deliveredTurnPrompt =
      input.team && input.member?.role === 'lead'
        ? formatTeamDeliveryPrompt({
            teamId: input.team.id.slice(0, 8),
            to: input.member.name,
            kind: 'lead_turn',
            from: 'agent-server',
            sequence: requirePositiveTeamSequence(input.task.teamSequence),
            body: guidedTurnPrompt,
          })
        : guidedTurnPrompt;
    return { systemPrompt, deliveredTurnPrompt };
  }

  private async withLeadCollaborationContext(
    prompt: string,
    task: Task,
    leadState: AgenticLeadState | null,
    members: readonly TeamMemberRun[],
  ): Promise<string> {
    const workItems = leadState?.workItems ?? [];
    const attempts = leadState?.attempts ?? [];
    const latestAttemptByWorkItem = new Map<string, TeamWorkItemAttempt>();
    for (const attempt of attempts) {
      const previous = latestAttemptByWorkItem.get(attempt.workItemId);
      if (!previous || attempt.attemptNo > previous.attemptNo)
        latestAttemptByWorkItem.set(attempt.workItemId, attempt);
    }

    const failureCodeByAttempt = new Map<string, string>();
    if (this.tasks.findByIdForOwner) {
      await Promise.all(
        attempts.map(async (attempt) => {
          if (
            attempt.status !== 'failed' ||
            latestAttemptByWorkItem.get(attempt.workItemId)?.id !==
              attempt.id ||
            !attempt.executionTaskId
          )
            return;
          const record = await this.tasks.findByIdForOwner(
            attempt.executionTaskId,
            {
              tenantId: task.tenantId,
              workspaceId: task.workspaceId,
              principalType: task.principalType,
              principalId: task.principalId,
            },
          );
          const code = record?.latestRun?.error?.code;
          if (
            code === 'runtime_timed_out' ||
            code === 'runtime_execution_failed'
          )
            failureCodeByAttempt.set(attempt.id, code);
        }),
      );
    }

    const memberNameById = new Map(
      members.map((member) => [member.id, member.name]),
    );
    const snapshot = JSON.stringify({
      goal: safeSnapshotText(prompt),
      board: workItems.slice(0, 16).map((item, index) => {
        const itemAttempts = attempts
          .filter((attempt) => attempt.workItemId === item.id)
          .sort((left, right) => left.attemptNo - right.attemptNo);
        return {
          work_ref: workRef(index),
          subject: safeSnapshotText(item.subject),
          owner: item.ownerMemberId
            ? safeSnapshotText(memberNameById.get(item.ownerMemberId) ?? null)
            : null,
          status: projectBoardStatus(item, itemAttempts),
          latest_attempt: itemAttempts.at(-1)
            ? {
                attempt_no: itemAttempts.at(-1)!.attemptNo,
                status: itemAttempts.at(-1)!.status,
                result_summary: safeSnapshotText(
                  itemAttempts.at(-1)!.resultSummary,
                ),
                feedback: safeSnapshotText(itemAttempts.at(-1)!.feedback),
                ...(failureCodeByAttempt.has(itemAttempts.at(-1)!.id)
                  ? {
                      failure_code: failureCodeByAttempt.get(
                        itemAttempts.at(-1)!.id,
                      ),
                    }
                  : {}),
              }
            : null,
        };
      }),
      limits: leadState?.policy.limits,
    });
    return `${prompt}\n\nWorkboard and Mailbox are durable collaboration facts. Use collaboration_state, board_list and inbox_list for current details. A natural-language message never changes ownership or Work state: use board_create/board_assign/board_accept/board_request_changes explicitly. Tool availability does not imply that an operation is currently legal. If a collaboration tool returns a typed error, read collaboration_state again before deciding the next action. You may make all currently useful decisions in this turn; do not wait for running participants.\n\nCurrent bounded collaboration snapshot: ${snapshot}`;
  }

  private async loadPinnedMemory(task: Task): Promise<string | null> {
    if (!task.memorySnapshotId || !task.memorySnapshotHash) return null;
    if (!this.fileStore)
      throw new Error('Pinned memory projection is unavailable');
    return this.fileStore.readVerified({
      tenantId: task.tenantId,
      workspaceId: task.workspaceId,
      snapshotId: task.memorySnapshotId,
      expectedContentHash: task.memorySnapshotHash,
    });
  }
}

function safeSnapshotText(value: string | null): string | null {
  if (value === null) return null;
  return value
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 512);
}

function projectTeamRoster(
  members: readonly TeamMemberRun[],
): readonly TeamPromptRosterMember[] {
  return [...members]
    .filter((member) => member.role !== 'lead')
    .sort(
      (left, right) =>
        compareStableText(left.name, right.name) ||
        compareStableText(left.role, right.role) ||
        compareStableText(left.id, right.id),
    )
    .map((member) => ({ name: member.name, role: member.role }));
}

function compareStableText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function appendCollaborationTurnGuidance(
  prompt: string,
  kind: string | null | undefined,
): string {
  const guidance =
    kind === 'direct_message'
      ? 'Collaboration message guidance: read inbox_list and board_list. A message is communication, never an implicit assignment. Acknowledge messages that request it with message_ack. If you choose to take an open actionable item, call board_claim explicitly. You may reply with message_send. Do not submit or accept Work merely because a message says it is done.'
      : kind === 'work_attempt'
        ? 'Assigned Workboard guidance: use your real domain tools plus board_list/inbox_list. Persist meaningful progress with board_checkpoint, report a true blocker with board_block, communicate with message_send when useful, and complete the semantic attempt with board_submit including evidence_refs/artifact_refs when available. Do not use internal IDs or legacy Team commands.'
        : null;
  return guidance ? `${prompt}\n\n${guidance}` : prompt;
}

function requirePositiveTeamSequence(
  sequence: number | null | undefined,
): number {
  if (
    typeof sequence !== 'number' ||
    !Number.isSafeInteger(sequence) ||
    sequence <= 0
  )
    throw new Error('Lead Team sequence is invalid.');
  return sequence;
}
