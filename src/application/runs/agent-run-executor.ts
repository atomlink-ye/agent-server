import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { isManagedEnvironmentProvider } from '../../domain/environments/managed-environment-package.js';
import { transitionRun } from '../../domain/runs/run.js';
import { terminalRunStatuses } from '../../domain/runs/run-status.js';
import type { Task } from '../../domain/tasks/task.js';
import type { Logger } from '../../shared/observability/logger.js';
import { AGENT_SERVER_COLLABORATION_TOOL_REFS } from '../agents/built-in-skills.js';
import { resolveRuntimeModelPolicy } from '../agents/runtime-model-policy.js';
import type { RuntimeSessionStore } from '../ports/runtime-session-store.js';
import type { RuntimeScope, RuntimeSessionOwner } from '../../domain/runtime/runtime-session.js';
import type { ResolveRuntimeSessionSpec } from '../ports/resolve-runtime-session-spec.js';
import type { EnvironmentReadApi } from '../ports/environment-read-api.js';
import type { ExecutionObservation } from '../ports/runtime-execution-session.js';
import type { InvokableOwnerScope } from '../ports/invokable-repository.js';
import type { MemoryVersionReadApi } from '../ports/memory-version-read-api.js';
import type { RunEventRepository } from '../ports/run-events.js';
import type { RunRepository, ClaimedRun } from '../ports/run-repository.js';
import type { SessionRepository } from '../ports/session-repository.js';
import type { TaskRepository } from '../ports/task-repository.js';
import type { TeamExecutionRepository } from '../ports/team-execution-repository.js';
import type {
  WorkRunCompositionManifest,
  WorkRunResourceManifestRead,
} from '../ports/work-run-resource-manifest-read.js';
import type {
  ExecutionRuntimeService,
  ExecutionTurnOutcome,
} from '../ports/execution-runtime.js';
import { executionObservationPayload } from './execution-observation-payload.js';
import type { RunTeamContext } from './run-team-coordinator.js';
import { RunPromptContext } from './run-prompt-context.js';
import { RuntimeMemoryProposalWriter } from './runtime-memory-proposal-writer.js';
import { createDesiredRuntimeSystemPrompt } from '../../domain/runtime/desired-runtime-system-prompt.js';

/**
 * Executes one leaf Agent Run after ExecuteRun has established durable Task/Run
 * lifecycle. Runtime placement and session resolution remain here until this
 * caller is fully migrated to RuntimeSession/RuntimeTurn use cases.
 */
export class AgentRunExecutor {
  public constructor(
    private readonly runtime: ExecutionRuntimeService,
    private readonly tasks: TaskRepository,
    private readonly promptContext: RunPromptContext,
    private readonly memoryWriter: RuntimeMemoryProposalWriter,
    private readonly logger: Logger,
    private readonly events?: RunEventRepository,
    private readonly runtimeSessions?: RuntimeSessionStore,
    private readonly resolveRuntimeSpec?: ResolveRuntimeSessionSpec,
    private readonly sessions?: Pick<SessionRepository, 'getSession'>,
    private readonly environments?: EnvironmentReadApi,
    private readonly runtimeCellRoot?: string,
    private readonly collaborativeExecutions?: TeamExecutionRepository,
    private readonly runs?: Pick<RunRepository, 'findByIdForOwner'>,
    private readonly workRunManifests?: WorkRunResourceManifestRead,
    private readonly memoryVersions?: MemoryVersionReadApi,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async execute(input: {
    readonly claim: ClaimedRun;
    readonly ownerScope: InvokableOwnerScope;
    readonly invokableVersionId: string;
    readonly task: Task;
    readonly teamContext: RunTeamContext | null;
  }) {
    const { claim, ownerScope, invokableVersionId, task } = input;
    const collaborativeTeam =
      input.teamContext?.team ??
      (this.collaborativeExecutions
        ? await this.collaborativeExecutions.findTeamRunByRootTaskId(
            task.rootTaskId,
            {
              tenantId: task.tenantId,
              workspaceId: task.workspaceId,
              principalType: task.principalType,
              principalId: task.principalId,
            },
          )
        : null);
    const member = input.teamContext?.member ?? null;

    const productSession =
      task.sessionId && this.sessions
        ? await this.sessions.getSession(task.sessionId, {
            tenantId: task.tenantId,
            principalType: task.principalType as 'service_account',
            principalId: task.principalId,
            workspaceId: task.workspaceId,
            policySnapshotVersion: task.policySnapshotVersion,
          })
        : null;
    if (task.sessionId && this.sessions && !productSession)
      throw new Error('Product Session could not be loaded.');

    const workManifest = this.workRunManifests
      ? await this.workRunManifests.findByRootTaskId(task.rootTaskId, {
          tenantId: task.tenantId,
          workspaceId: task.workspaceId,
          principalType: task.principalType,
          principalId: task.principalId,
        })
      : null;
    const compositionEnvironmentVersionId = workManifest
      ? manifestEnvironmentVersionId(workManifest)
      : null;

    const owner: RuntimeSessionOwner = {
      tenantId: task.tenantId,
      workspaceId: task.workspaceId,
      principalType: task.principalType,
      principalId: task.principalId,
    };
    const scope: RuntimeScope = member
      ? { kind: 'team_member', id: member.id }
      : task.sessionId
        ? { kind: 'product_session', id: task.sessionId }
        : { kind: 'task', id: task.id };
    const runtimeSession = this.runtimeSessions
      ? await this.runtimeSessions.findByScope(owner, scope)
      : null;
    const hasRuntimeSession = runtimeSession !== null;

    const resolved = hasRuntimeSession
      ? await this.promptContext.resolveContinuation({
          prompt: claim.run.prompt,
          ownerScope,
          invokableVersionId,
          task,
        })
      : await this.promptContext.resolveInitial({
          prompt: claim.run.prompt,
          ownerScope,
          invokableVersionId,
          task,
        });

    if (workManifest)
      assertPinnedParticipantResources(
        workManifest,
        member?.name ?? null,
        resolved.agentVersionId,
        resolved.skills,
        resolved.toolRefs,
      );
    const pinnedWorkMemory = workManifest
      ? await this.loadPinnedWorkMemory(workManifest, task)
      : null;
    const resolvedForPrompt = pinnedWorkMemory
      ? {
          ...resolved,
          turnPrompt: `${resolved.turnPrompt}\n\n${pinnedWorkMemory}`,
        }
      : resolved;

    const runtimeModelPolicy = resolveRuntimeModelPolicy(
      resolved.modelPolicyRef,
    );
    const agenticLeadState =
      collaborativeTeam != null && member?.role === 'lead'
        ? await this.promptContext.loadAgenticLeadState(collaborativeTeam, task)
        : null;
    const teamMembers =
      collaborativeTeam && this.collaborativeExecutions
        ? await this.collaborativeExecutions.findMembersByTeamRunId(
            collaborativeTeam.id,
            {
              tenantId: task.tenantId,
              workspaceId: task.workspaceId,
              principalType: task.principalType,
              principalId: task.principalId,
            },
          )
        : [];

    let sessionRuntime = runtimeSession;
    const collaborationRefs = new Set<string>(
      Object.values(AGENT_SERVER_COLLABORATION_TOOL_REFS),
    );
    const domainToolRefs = (
      resolved.toolRefs
    ).filter((ref) => !collaborationRefs.has(ref));
    const runtimeToolRefs =
      collaborativeTeam != null && member ? domainToolRefs : resolved.toolRefs;

    const prompts = await this.promptContext.buildTurnPrompts({
      resolved: resolvedForPrompt,
      priorExternalSessionId: runtimeSession?.id ?? null,
      team: collaborativeTeam,
      member,
      teamMembers,
      leadState: agenticLeadState,
      task,
    });

    if (
      this.runtimeSessions &&
      !sessionRuntime &&
      ((task.sessionId && productSession?.environmentVersionId != null) ||
        (member != null && collaborativeTeam != null) ||
        (!task.sessionId && !member && compositionEnvironmentVersionId != null))
    ) {
      if (!this.environments)
        throw new Error('Runtime Environment dependencies are unavailable.');
      const environmentVersionId =
        productSession?.environmentVersionId ??
        collaborativeTeam?.environmentVersionId ??
        compositionEnvironmentVersionId;
      const environment = await this.environments.findVersion(
        {
          tenantId: task.tenantId,
          workspaceId: task.workspaceId,
          principalType: task.principalType,
          principalId: task.principalId,
        },
        environmentVersionId!,
      );
      const spec = environment?.package.spec;
      if (
        !environment ||
        environment.status !== 'published' ||
        spec?.adapter !== 'paseo' ||
        !isManagedEnvironmentProvider(spec.provider) ||
        spec.modelPolicyRef !== 'free-only' ||
        spec.runtimeCellPolicy !== 'per_runtime_session'
      )
        throw new Error('Work runtime Environment is not supported.');
      if (workManifest) {
        const manifestEnvironment = workManifest.entries.find(
          (entry) => entry.resourceKind === 'environment',
        );
        if (
          manifestEnvironment &&
          (manifestEnvironment.resolvedVersionId !== environment.id ||
            manifestEnvironment.resolvedFingerprint !== environment.fingerprint)
        )
          throw new Error(
            'WorkRun Environment no longer matches its manifest.',
          );
      }
      if (!this.resolveRuntimeSpec)
        throw new Error('Runtime session spec resolver is unavailable.');
      const runtimeSpec = this.resolveRuntimeSpec.execute({
        owner,
        agentVersionId: resolved.agentVersionId,
        environmentVersionId: environmentVersionId!,
        resolvedSkills: resolved.skills,
        toolRefs: runtimeToolRefs,
        configuration: {
          provider: spec.provider,
          model: null,
          cwd: this.runtimeCellRoot ?? process.cwd(),
          contextEpoch: 0,
          desiredSystemPrompt: createDesiredRuntimeSystemPrompt(
            prompts.systemPrompt,
          ),
        },
      });
      sessionRuntime = await this.runtimeSessions.createWithInitialSpec({
        owner,
        scope,
        spec: runtimeSpec,
      });
      if (!sessionRuntime) throw new Error('Work runtime session unavailable.');
    }

    if (member && sessionRuntime && this.collaborativeExecutions)
      await this.collaborativeExecutions.updateMemberRuntimeSession(
        member.id,
        sessionRuntime.id,
        {
          tenantId: task.tenantId,
          workspaceId: task.workspaceId,
          principalType: task.principalType,
          principalId: task.principalId,
        },
      );

    const cellCwd =
      sessionRuntime && this.runtimeCellRoot
        ? join(this.runtimeCellRoot, sessionRuntime.id)
        : undefined;
    if (cellCwd) await mkdir(cellCwd, { recursive: true });


    const runtimeObservationSink = this.events
      ? {
          emit: async (observation: ExecutionObservation) => {
            const payload = executionObservationPayload(observation, {
              isTeamMember: member != null,
            });
            if (payload)
              await this.events!.append(claim.run.id, 'output', payload);
          },
        }
      : undefined;

    let execution: ExecutionTurnOutcome | undefined;
    let executionFailed = false;
    let executionError: unknown;
    try {
      execution = await this.runtime.executeTurn(
        {
          runId: claim.run.id,
          prompt: prompts.deliveredTurnPrompt,
          recoveryPrompt: prompts.recoveryTurnPrompt,
          ...(sessionRuntime ? { runtimeSessionId: sessionRuntime.id } : {}),
          ...(cellCwd ? { cwd: cellCwd } : {}),
          ...(!hasRuntimeSession &&
          collaborativeTeam &&
          member &&
          sessionRuntime
            ? {
                workspaceOwner: {
                  kind: 'team_run' as const,
                  id: collaborativeTeam.id,
                  tenantId: task.tenantId,
                  productWorkspaceId: task.workspaceId,
                  principalType: task.principalType,
                  principalId: task.principalId,
                },
                ...(member.role !== 'lead'
                  ? { requireExistingWorkspaceBinding: true }
                  : {}),
              }
            : {}),
          ...(runtimeModelPolicy
            ? {
                provider: runtimeModelPolicy.provider,
                model: runtimeModelPolicy.model,
              }
            : {}),
          systemPrompt: prompts.systemPrompt,
          ...(collaborativeTeam && !hasRuntimeSession
            ? {
                workspaceTitle: `Team ${collaborativeTeam.id.slice(0, 8)}`,
              }
            : {}),
          ...(member && !hasRuntimeSession
            ? {
                sessionTitle: `${member.name} (${member.role})`,
                labels: {
                  team_run_id: member.teamRunId,
                  member_name: member.name,
                  role: member.role,
                },
              }
            : {}),
          ...(resolved.proposalLimit > 0
            ? { proposalLimit: resolved.proposalLimit }
            : {}),
        },
        runtimeObservationSink,
      );
    } catch (error) {
      executionFailed = true;
      executionError = error;
    }

    if (executionFailed) throw executionError;
    if (!execution) throw new Error('Runtime execution returned no result.');

    await this.events?.bind({
      runId: claim.run.id,
      ...(task.sessionId ? { sessionId: task.sessionId } : {}),
      sessionBinding: execution.sessionBinding,
      createdAt: claim.run.updatedAt,
    });

    await this.memoryWriter.write({
      claim,
      task,
      agentVersionId: resolved.agentVersionId,
      proposalLimit: resolved.proposalLimit,
      execution,
    });

    return transitionRun(
      claim.run,
      'succeeded',
      {
        runtime: {
          provider: execution.provider,
          model: execution.model,
        },
        result: { text: execution.text },
        ...(execution.usage ? { usage: execution.usage } : {}),
      },
      this.now,
    );
  }

  private async loadPinnedWorkMemory(
    manifest: WorkRunCompositionManifest,
    task: Task,
  ): Promise<string | null> {
    const entries = manifest.entries.filter(
      (entry) => entry.resourceKind === 'memory',
    );
    if (entries.length === 0) return null;
    if (!this.memoryVersions)
      throw new Error('Pinned Work Memory reader is unavailable.');
    const sections: string[] = [];
    let bytes = 0;
    for (const entry of entries) {
      const memory = await this.memoryVersions.findVersion(
        entry.resolvedVersionId,
        {
          tenantId: task.tenantId,
          workspaceId: task.workspaceId,
          principalType: task.principalType,
          principalId: task.principalId,
        },
      );
      if (
        !memory ||
        entry.resolvedFingerprint !== `sha256:${memory.contentSha256}` ||
        entry.slot !== `memory:${memory.path}`
      )
        throw new Error('Pinned Work Memory no longer matches its manifest.');
      bytes += Buffer.byteLength(memory.content, 'utf8');
      if (bytes > 256 * 1024)
        throw new Error('Pinned Work Memory exceeds the MVE prompt budget.');
      sections.push(`### ${memory.path}\n${memory.content}`);
    }
    return `## Pinned Work Definition Memory\n\n${sections.join('\n\n')}`;
  }

}

function manifestEnvironmentVersionId(
  manifest: WorkRunCompositionManifest,
): string | null {
  const entries = manifest.entries.filter(
    (entry) => entry.resourceKind === 'environment',
  );
  if (entries.length > 1)
    throw new Error('WorkRun manifest has more than one Environment.');
  return entries[0]?.resolvedVersionId ?? null;
}

function assertPinnedParticipantResources(
  manifest: WorkRunCompositionManifest,
  memberName: string | null,
  agentVersionId: string,
  skills: readonly { readonly ref: string; readonly digest: string }[],
  toolRefs: readonly string[],
): void {
  const agents = manifest.entries.filter(
    (entry) =>
      entry.resourceKind === 'agent' &&
      entry.resolvedVersionId === agentVersionId &&
      entry.slot.endsWith(':agent'),
  );
  const agent = memberName
    ? agents.find((entry) => entry.slot === `participant:${memberName}:agent`)
    : agents.length === 1
      ? agents[0]
      : undefined;
  if (!agent)
    throw new Error(
      'Task Agent version is not authorized by the WorkRun manifest.',
    );
  const prefix = agent.slot.slice(0, -':agent'.length);
  const pinnedSkills = manifest.entries
    .filter(
      (entry) =>
        entry.resourceKind === 'skill' &&
        entry.slot.startsWith(`${prefix}:skill:`),
    )
    .map((entry) => ({
      ref: entry.requestedRef,
      fingerprint: entry.resolvedFingerprint,
    }))
    .sort((a, b) => String(a.ref).localeCompare(String(b.ref)));
  const currentSkills = skills
    .map((skill) => ({
      ref: skill.ref,
      fingerprint: `sha256:${skill.digest}`,
    }))
    .sort((a, b) => a.ref.localeCompare(b.ref));
  if (JSON.stringify(pinnedSkills) !== JSON.stringify(currentSkills))
    throw new Error('Task Skill resolution drifted from the WorkRun manifest.');

  const pinnedTools = manifest.entries
    .filter(
      (entry) =>
        entry.resourceKind === 'tool' &&
        entry.slot.startsWith(`${prefix}:tool:`),
    )
    .map((entry) => entry.requestedRef)
    .filter((ref): ref is string => ref !== null);
  if (!sameToolRefs(pinnedTools, toolRefs))
    throw new Error('Task Tool resolution drifted from the WorkRun manifest.');
}

function sameToolRefs(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) return false;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return (
    leftSet.size === left.length &&
    rightSet.size === right.length &&
    [...leftSet].every((ref) => rightSet.has(ref))
  );
}
