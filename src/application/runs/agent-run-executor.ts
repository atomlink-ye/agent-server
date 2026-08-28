import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { isManagedEnvironmentProvider } from '../../domain/environments/managed-environment-package.js';
import { transitionRun } from '../../domain/runs/run.js';
import { terminalRunStatuses } from '../../domain/runs/run-status.js';
import type { Task } from '../../domain/tasks/task.js';
import type { Logger } from '../../shared/observability/logger.js';
import { AGENT_SERVER_PLATFORM_COLLABORATION_TOOL_REFS } from '../agents/built-in-skills.js';
import { resolveRuntimeModelPolicy } from '../agents/runtime-model-policy.js';
import type { RuntimeSessionStore } from '../ports/runtime-session-store.js';
import type {
  RuntimeScope,
  RuntimeSessionOwner,
} from '../../domain/runtime/runtime-session.js';
import type { EnsureDesiredRuntimeSpec } from '../ports/ensure-desired-runtime-spec.js';
import type { EnvironmentReadApi } from '../ports/environment-read-api.js';
import type { ExecutionObservation } from '../ports/runtime-execution-session.js';
import type { ExecutionOutput } from '../ports/runtime-execution-session.js';
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
import type { ExecuteRuntimeTurn } from '../runtime/execute-runtime-turn.js';
import { executionObservationPayload } from './execution-observation-payload.js';
import type { RunTeamContext } from './run-team-coordinator.js';
import { RunPromptContext } from './run-prompt-context.js';
import { RuntimeMemoryProposalWriter } from './runtime-memory-proposal-writer.js';
import { createDesiredRuntimeSystemPrompt } from '../../domain/runtime/desired-runtime-system-prompt.js';
import { recordExecutionTrace } from '../../shared/observability/execution-trace.js';

/**
 * Executes one leaf Agent Run after ExecuteRun has established durable Task/Run
 * lifecycle. Runtime placement and session resolution remain here until this
 * caller is fully migrated to RuntimeSession/RuntimeTurn use cases.
 */
export class AgentRunExecutor {
  public constructor(
    private readonly runtime: Pick<ExecuteRuntimeTurn, 'execute'>,
    private readonly tasks: TaskRepository,
    private readonly promptContext: RunPromptContext,
    private readonly memoryWriter: RuntimeMemoryProposalWriter,
    private readonly logger: Logger,
    private readonly events?: RunEventRepository,
    private readonly runtimeSessions?: Pick<RuntimeSessionStore, 'findByScope'>,
    private readonly ensureDesiredRuntimeSpec?: EnsureDesiredRuntimeSpec,
    private readonly runtimeConfiguration?: {
      readonly provider: string;
      readonly model: string | null;
      readonly cwd: string;
    },
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
    recordExecutionTrace({
      module: 'AgentRunExecutor',
      runId: input.claim.run.id,
    });
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
        : { kind: 'run', id: claim.run.id };
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
        resolved.workerVersionId ?? resolved.agentVersionId,
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
    const runtimeToolRefs =
      collaborativeTeam != null && member
        ? Object.freeze([
            ...new Set([
              ...resolved.toolRefs,
              ...AGENT_SERVER_PLATFORM_COLLABORATION_TOOL_REFS,
            ]),
          ])
        : resolved.toolRefs;

    const prompts = await this.promptContext.buildTurnPrompts({
      resolved: resolvedForPrompt,
      priorExternalSessionId: runtimeSession?.id ?? null,
      team: collaborativeTeam,
      member,
      teamMembers,
      leadState: agenticLeadState,
      task,
    });

    const environmentVersionId =
      productSession?.environmentVersionId ??
      collaborativeTeam?.environmentVersionId ??
      compositionEnvironmentVersionId ??
      null;
    const needsDesiredRuntimeSpec =
      environmentVersionId !== null ||
      (!sessionRuntime && this.runtimeConfiguration !== undefined);
    if (this.runtimeSessions && needsDesiredRuntimeSpec) {
      if (!this.ensureDesiredRuntimeSpec)
        throw new Error('Runtime desired-spec owner is unavailable.');
      const configuration = environmentVersionId
        ? await this.resolveEnvironmentConfiguration(
            environmentVersionId,
            owner,
            workManifest,
            runtimeModelPolicy,
          )
        : this.resolveGenericConfiguration(runtimeModelPolicy);
      const ensured = await this.ensureDesiredRuntimeSpec.execute({
        owner,
        scope,
        subject:
          task.invokableKind === 'worker'
            ? {
                kind: 'worker',
                workerVersionId: resolved.workerVersionId ?? invokableVersionId,
              }
            : {
                kind: 'legacy_agent_task',
                agentVersionId: resolved.agentVersionId,
              },
        environmentVersionId,
        resolvedSkills: resolved.skills,
        toolRefs: runtimeToolRefs,
        configuration: {
          ...configuration,
          contextEpoch: 0,
          desiredSystemPrompt: createDesiredRuntimeSystemPrompt(
            prompts.systemPrompt,
          ),
        },
      });
      sessionRuntime = ensured.session;
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

    let execution: ExecutionOutput | undefined;
    let executionFailed = false;
    let executionError: unknown;
    try {
      if (!sessionRuntime) throw new Error('runtime_session_required');
      execution = await this.runtime.execute({
        runtimeSessionId: sessionRuntime.id,
        source: member
          ? {
              kind: 'team_member',
              teamMemberRunId: member.id,
              taskId: task.id,
              runId: claim.run.id,
            }
          : { kind: 'run', runId: claim.run.id },
        prompt: prompts.deliveredTurnPrompt,
        desiredSystemPrompt: createDesiredRuntimeSystemPrompt(
          prompts.systemPrompt,
        ),
        recoveryPrompt: prompts.recoveryTurnPrompt,
        ...(runtimeObservationSink ? { observer: runtimeObservationSink } : {}),
      });
    } catch (error) {
      executionFailed = true;
      executionError = error;
    }

    if (executionFailed) throw executionError;
    if (!execution) throw new Error('Runtime execution returned no result.');

    if (task.invokableKind !== 'worker')
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

  private resolveGenericConfiguration(
    policy: ReturnType<typeof resolveRuntimeModelPolicy>,
  ) {
    if (!this.runtimeConfiguration)
      throw new Error('Runtime fallback configuration is unavailable.');
    return {
      provider: policy?.provider ?? this.runtimeConfiguration.provider,
      model: policy?.model ?? this.runtimeConfiguration.model,
      cwd: this.runtimeCellRoot ?? this.runtimeConfiguration.cwd,
    };
  }

  private async resolveEnvironmentConfiguration(
    environmentVersionId: string,
    owner: RuntimeSessionOwner,
    workManifest: WorkRunCompositionManifest | null,
    policy: ReturnType<typeof resolveRuntimeModelPolicy>,
  ) {
    if (!this.environments)
      throw new Error('Runtime Environment dependencies are unavailable.');
    const environment = await this.environments.findVersion(
      owner,
      environmentVersionId,
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
        throw new Error('WorkRun Environment no longer matches its manifest.');
    }
    return {
      provider:
        policy?.provider ??
        this.runtimeConfiguration?.provider ??
        spec.provider,
      model: policy?.model ?? null,
      cwd:
        this.runtimeCellRoot ?? this.runtimeConfiguration?.cwd ?? process.cwd(),
    };
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
  executionVersionId: string,
  skills: readonly { readonly ref: string; readonly digest: string }[],
  toolRefs: readonly string[],
): void {
  const workers = manifest.entries.filter(
    (entry) =>
      entry.resourceKind === 'worker' &&
      entry.resolvedVersionId === executionVersionId &&
      entry.slot.endsWith(':worker'),
  );
  const worker = memberName
    ? workers.find((entry) => entry.slot === `participant:${memberName}:worker`)
    : workers.length === 1
      ? workers[0]
      : undefined;
  if (!worker)
    throw new Error(
      'Task Worker version is not authorized by the WorkRun manifest.',
    );
  const prefix = worker.slot.slice(0, -':worker'.length);
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
