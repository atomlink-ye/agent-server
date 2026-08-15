import { RUN_API_COMPATIBILITY_INVOKABLE_VERSION_ID } from '../../domain/tasks/compatibility-invokable-version.js';
import type { Task } from '../../domain/tasks/task.js';
import type { TeamMemberRun } from '../../domain/teams/team-member-run.js';
import type { TeamRun } from '../../domain/teams/team-run.js';
import type { TeamWorkItem } from '../../domain/teams/team-work-item.js';
import type { TeamWorkItemAttempt } from '../../domain/teams/team-work-item-attempt.js';
import { AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS } from '../agents/built-in-skills.js';
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
      modelPolicyRef: metadata.modelPolicyRef,
      skills: [],
      toolRefs: [],
    };
  }

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
    const attempts =
      await this.collaborativeExecutions.findAttemptsByTeamRunId(
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
    readonly runtimeToolRefs: readonly string[];
    readonly task: Task;
  }): Promise<{
    readonly systemPrompt: string;
    readonly deliveredTurnPrompt: string;
  }> {
    const turnPrompt =
      input.team != null && input.member?.role === 'lead'
        ? await this.withAgenticLeadContext(
            input.resolved.turnPrompt,
            input.team,
            input.task,
            input.leadState,
            input.runtimeToolRefs,
            input.teamMembers,
          )
        : input.resolved.turnPrompt;
    const guidedTurnPrompt =
      input.member?.role === 'lead'
        ? turnPrompt
        : appendTeamTurnGuidance(turnPrompt, input.task.teamTaskKind);
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

  private async withAgenticLeadContext(
    prompt: string,
    _team: TeamRun,
    task: Task,
    leadState: AgenticLeadState | null,
    runtimeToolRefs: readonly string[],
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
            latestAttemptByWorkItem.get(attempt.workItemId)?.id !== attempt.id ||
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
      goal: safeAgenticLeadSnapshotText(prompt),
      work_items: workItems.slice(0, 16).map((item, index) => ({
        work_ref: `work-${index + 1}`,
        subject: safeAgenticLeadSnapshotText(item.subject),
        assignee: item.ownerMemberId
          ? safeAgenticLeadSnapshotText(
              memberNameById.get(item.ownerMemberId) ?? null,
            )
          : null,
        status: item.status,
        attempts: attempts
          .filter((attempt) => attempt.workItemId === item.id)
          .slice(0, 4)
          .map((attempt) => ({
            attempt_no: attempt.attemptNo,
            status: attempt.status,
            result_summary: safeAgenticLeadSnapshotText(attempt.resultSummary),
            ...(failureCodeByAttempt.has(attempt.id)
              ? { failure_code: failureCodeByAttempt.get(attempt.id) }
              : {}),
            feedback: safeAgenticLeadSnapshotText(attempt.feedback),
          })),
      })),
      limits: leadState?.policy.limits,
      allowed_commands: leadState?.policy.allowedCommands ?? [],
      available_coordination_commands: runtimeToolRefs.includes(
        AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.messageSend,
      )
        ? ['team_message_send']
        : [],
      safe_reads: runtimeToolRefs
        .filter(
          (ref) =>
            ref === AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.state ||
            ref === AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.workList,
        )
        .map((ref) => ref.slice('agent-server/'.length)),
      eligible_targets: {
        accept: leadState?.policy.eligibleAcceptWorkItemIds
          .map(
            (id) => `work-${workItems.findIndex((item) => item.id === id) + 1}`,
          )
          .filter((ref) => ref !== 'work-0'),
        cancel: leadState?.policy.eligibleCancelWorkItemIds
          .map(
            (id) => `work-${workItems.findIndex((item) => item.id === id) + 1}`,
          )
          .filter((ref) => ref !== 'work-0'),
        rework: leadState?.policy.eligibleReworkWorkItemIds
          .map(
            (id) => `work-${workItems.findIndex((item) => item.id === id) + 1}`,
          )
          .filter((ref) => ref !== 'work-0'),
      },
    });
    return `${prompt}\n\nPermanent coordination rules are in the create-time system instructions. Only values returned by agent-server MCP tools are authoritative for the current control cycle.\n\nLead turn guidance: use canonical Team tools and published Lead domain tools, never internal IDs, and make all current coordination decisions in this turn without waiting for members.\n\nCurrent bounded Lead snapshot (control-plane fields only): ${snapshot}`;
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

function safeAgenticLeadSnapshotText(value: string | null): string | null {
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

function appendTeamTurnGuidance(
  prompt: string,
  kind: string | null | undefined,
): string {
  const guidance =
    kind === 'direct_message'
      ? 'Direct Team message guidance: use only safe Team state/list reads. Acknowledge or act on the safe message content; it is not Work and must not cause Work submission, review, acceptance, checkpointing, or further Team messages.'
      : kind === 'work_attempt'
        ? 'Assigned Team Work guidance: use real domain tools from the published agent profile plus canonical member state/list/checkpoint/submit tools. Do not use legacy Team tools or internal IDs; submit the bounded result and end the turn.'
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
