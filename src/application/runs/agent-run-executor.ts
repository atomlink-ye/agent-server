import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { isManagedEnvironmentProvider } from '../../domain/environments/managed-environment-package.js';
import { transitionRun } from '../../domain/runs/run.js';
import { terminalRunStatuses } from '../../domain/runs/run-status.js';
import type { Task } from '../../domain/tasks/task.js';
import type { Logger } from '../../shared/observability/logger.js';
import { AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS } from '../agents/built-in-skills.js';
import { resolveRuntimeModelPolicy } from '../agents/runtime-model-policy.js';
import type { RuntimeExtensionBinder } from '../extensions/runtime-extension-binder.js';
import type { EnvironmentReadApi } from '../ports/environment-read-api.js';
import type { ExecutionObservation } from '../ports/execution-plane.js';
import type { InvokableOwnerScope } from '../ports/invokable-repository.js';
import type { RunEventRepository } from '../ports/run-events.js';
import type { RunRepository, ClaimedRun } from '../ports/run-repository.js';
import type { RuntimeSessionRepository } from '../ports/runtime-session-repository.js';
import type { SessionRepository } from '../ports/session-repository.js';
import type { TaskRepository } from '../ports/task-repository.js';
import type { TeamExecutionRepository } from '../ports/team-execution-repository.js';
import type {
  ExecutionRuntimeService,
  ExecutionTurnOutcome,
} from '../runtime/execution-plane-runtime-facade.js';
import { deriveTeamContextEpoch } from '../teams/team-tool-context.js';
import {
  canonicalTeamToolRefsForDirectMessage,
  canonicalTeamToolRefsForLeadPolicy,
  canonicalTeamToolRefsForRole,
} from '../teams/team-policy-evaluator.js';
import { executionObservationPayload } from './execution-observation-payload.js';
import type { RunTeamContext } from './run-team-coordinator.js';
import { RunPromptContext } from './run-prompt-context.js';
import { RuntimeMemoryProposalWriter } from './runtime-memory-proposal-writer.js';

/**
 * Executes one leaf Agent Run after ExecuteRun has established durable Task/Run
 * lifecycle. Runtime placement, session reuse and extension-grant behavior are
 * intentionally kept together here because they form one existing execution
 * transaction and are not yet proven independent seams.
 */
export class AgentRunExecutor {
  public constructor(
    private readonly runtime: ExecutionRuntimeService,
    private readonly tasks: TaskRepository,
    private readonly promptContext: RunPromptContext,
    private readonly memoryWriter: RuntimeMemoryProposalWriter,
    private readonly logger: Logger,
    private readonly events?: RunEventRepository,
    private readonly runtimeExtensionBinder?: RuntimeExtensionBinder,
    private readonly runtimeSessions?: RuntimeSessionRepository,
    private readonly sessions?: Pick<SessionRepository, 'getSession'>,
    private readonly environments?: EnvironmentReadApi,
    private readonly runtimeCellRoot?: string,
    private readonly collaborativeExecutions?: TeamExecutionRepository,
    private readonly runs?: Pick<RunRepository, 'findByIdForOwner'>,
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
    const turnGrantScopeId = member?.id ?? task.id;

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

    const runtimeSession =
      task.sessionId && this.runtimeSessions
        ? await this.runtimeSessions.findByProductSession({
            productSessionId: task.sessionId,
            tenantId: task.tenantId,
            principalType: task.principalType,
            principalId: task.principalId,
          })
        : member && this.runtimeSessions?.findByTeamMember
          ? await this.runtimeSessions.findByTeamMember({
              teamMemberRunId: member.id,
              tenantId: task.tenantId,
              workspaceId: task.workspaceId,
              principalType: task.principalType,
              principalId: task.principalId,
            })
          : null;

    if (
      member &&
      runtimeSession &&
      (runtimeSession.sessionBinding === null) !==
        (runtimeSession.workspaceBinding === null)
    )
      throw new Error('Runtime session execution binding is partial.');

    const legacySessionBinding =
      task.sessionId &&
      productSession &&
      productSession.environmentVersionId == null &&
      !runtimeSession &&
      this.events?.findLatestSessionBindingBySessionId
        ? await this.events.findLatestSessionBindingBySessionId(task.sessionId)
        : null;

    if (
      runtimeSession &&
      member &&
      (runtimeSession.scopeKind !== 'team_member' ||
        runtimeSession.scopeId !== member.id)
    )
      throw new Error('Team member runtime session scope is invalid.');

    if (runtimeSession) {
      const commonSnapshotInvalid =
        runtimeSession.agentVersionId !== task.invokableVersionId ||
        runtimeSession.workspaceId !== task.workspaceId;
      if (
        member &&
        (commonSnapshotInvalid ||
          runtimeSession.environmentVersionId !==
            collaborativeTeam?.environmentVersionId)
      )
        throw new Error('Runtime session snapshot is invalid.');
      if (
        !member &&
        (commonSnapshotInvalid ||
          runtimeSession.scopeKind !== 'product_session' ||
          runtimeSession.scopeId !== task.sessionId ||
          runtimeSession.environmentVersionId !==
            productSession?.environmentVersionId)
      )
        throw new Error('Product Session runtime session snapshot is invalid.');
    }

    const priorSessionBinding = member
      ? (runtimeSession?.sessionBinding ?? null)
      : (runtimeSession?.sessionBinding ??
        legacySessionBinding ??
        (!this.runtimeSessions &&
        task.sessionId &&
        this.events?.findLatestSessionBindingBySessionId
          ? await this.events.findLatestSessionBindingBySessionId(task.sessionId)
          : null));
    const priorExternalSessionId = priorSessionBinding?.externalSessionId ?? null;

    if (priorExternalSessionId && member?.role === 'lead' && collaborativeTeam) {
      const fenceBinder = this.runtimeExtensionBinder as RuntimeExtensionBinder & {
        getTeamMemberGrant?: RuntimeExtensionBinder['getTeamMemberGrant'];
        activeToolCalls?: (grantId: string) => number;
      };
      const previous = fenceBinder.getTeamMemberGrant?.({
        teamMemberRunId: member.id,
        scopeId: turnGrantScopeId,
      });
      if (
        !previous?.runId ||
        previous.runId === claim.run.id ||
        previous.allowedTools.length !== 0 ||
        !this.tasks.findByRootTaskIdForOwner ||
        !this.runs ||
        (runtimeSession &&
          !sameToolRefs(previous.catalogTools, runtimeSession.toolRefs))
      )
        throw new Error('Previous Team turn cannot be verified.');
      const previousRun = await this.runs.findByIdForOwner(previous.runId, {
        tenantId: task.tenantId,
        workspaceId: task.workspaceId,
        principalType: task.principalType,
        principalId: task.principalId,
      });
      if (!previousRun || !terminalRunStatuses.has(previousRun.status))
        throw new Error('Previous Team run is still active.');
      const records = await this.tasks.findByRootTaskIdForOwner(
        collaborativeTeam.rootTaskId,
        {
          tenantId: task.tenantId,
          workspaceId: task.workspaceId,
          principalType: task.principalType,
          principalId: task.principalId,
        },
      );
      if (
        records.some(
          (record) =>
            record.task.teamMemberRunId === member.id &&
            record.task.id !== task.id &&
            record.latestRun !== null &&
            !terminalRunStatuses.has(record.latestRun.status),
        )
      )
        throw new Error('Team member has another active Task.');
      if (
        !fenceBinder.activeToolCalls ||
        fenceBinder.activeToolCalls(previous.grantId) !== 0
      )
        throw new Error('Previous Team turn cannot be verified.');
    }

    const resolved = priorExternalSessionId
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
    let createdRuntimeSession = false;
    const canonicalTeamRefs = new Set<string>(
      Object.values(AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS),
    );
    const domainToolRefs = (
      sessionRuntime?.toolRefs ?? resolved.toolRefs
    ).filter((ref) => !canonicalTeamRefs.has(ref));
    const leadCatalogToolRefs = [
      ...domainToolRefs,
      ...canonicalTeamToolRefsForRole('lead'),
    ];
    if (member?.role === 'lead' && sessionRuntime) {
      const persistedCanonical = sessionRuntime.toolRefs.filter((ref) =>
        canonicalTeamRefs.has(ref),
      );
      const expectedCanonical = canonicalTeamToolRefsForRole('lead');
      if (!sameToolRefs(persistedCanonical, expectedCanonical))
        throw new Error('Lead runtime session catalog is invalid.');
    }
    const runtimeToolRefs =
      collaborativeTeam != null && task.teamTaskKind === 'direct_message'
        ? canonicalTeamToolRefsForDirectMessage()
        : collaborativeTeam != null && task.teamTaskKind === 'work_attempt'
          ? [...domainToolRefs, ...canonicalTeamToolRefsForRole('member')]
          : collaborativeTeam != null && member?.role === 'lead'
            ? [
                ...domainToolRefs,
                ...canonicalTeamToolRefsForLeadPolicy(
                  agenticLeadState?.policy ?? { allowedCommands: [] },
                ),
              ]
            : resolved.toolRefs;

    const prompts = await this.promptContext.buildTurnPrompts({
      resolved,
      priorExternalSessionId,
      team: collaborativeTeam,
      member,
      teamMembers,
      leadState: agenticLeadState,
      runtimeToolRefs,
      task,
    });

    if (
      this.runtimeSessions &&
      !sessionRuntime &&
      ((task.sessionId && productSession?.environmentVersionId != null) ||
        (member != null && collaborativeTeam != null))
    ) {
      if (!this.environments)
        throw new Error(
          'Product Session runtime dependencies are unavailable.',
        );
      const environmentVersionId =
        productSession?.environmentVersionId ??
        collaborativeTeam?.environmentVersionId;
      const environment = await this.environments.findVersion(
        {
          tenantId: task.tenantId,
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
        throw new Error('Product Session environment is not supported.');
      sessionRuntime = task.sessionId
        ? await this.runtimeSessions.createOrGetForProductSession({
            productSessionId: task.sessionId,
            tenantId: task.tenantId,
            principalType: task.principalType,
            principalId: task.principalId,
            workspaceId: task.workspaceId,
            agentVersionId: resolved.agentVersionId,
            environmentVersionId: environmentVersionId!,
            resolvedSkills: resolved.skills,
            toolRefs: runtimeToolRefs,
          })
        : member && this.runtimeSessions.createOrGetForTeamMember
          ? await this.runtimeSessions.createOrGetForTeamMember({
              teamMemberRunId: member.id,
              taskId: task.id,
              tenantId: task.tenantId,
              principalType: task.principalType,
              principalId: task.principalId,
              workspaceId: task.workspaceId,
              agentVersionId: resolved.agentVersionId,
              environmentVersionId: environmentVersionId!,
              resolvedSkills: resolved.skills,
              toolRefs:
                member.role === 'lead' ? leadCatalogToolRefs : runtimeToolRefs,
            })
          : null;
      if (!sessionRuntime)
        throw new Error('Team member runtime session unavailable.');
      createdRuntimeSession = true;
    }

    if (createdRuntimeSession && member) {
      if (
        !sessionRuntime ||
        sessionRuntime.scopeKind !== 'team_member' ||
        sessionRuntime.scopeId !== member.id ||
        sessionRuntime.taskId !== task.id ||
        sessionRuntime.workspaceId !== task.workspaceId ||
        sessionRuntime.agentVersionId !== task.invokableVersionId ||
        sessionRuntime.environmentVersionId !==
          collaborativeTeam?.environmentVersionId ||
        !sameToolRefs(
          sessionRuntime.toolRefs,
          member.role === 'lead' ? leadCatalogToolRefs : runtimeToolRefs,
        ) ||
        sessionRuntime.sessionBinding !== null ||
        sessionRuntime.workspaceBinding !== null
      )
        throw new Error('New Team member runtime session is already bound.');
    } else if (createdRuntimeSession) {
      if (
        !sessionRuntime ||
        sessionRuntime.scopeKind !== 'product_session' ||
        sessionRuntime.scopeId !== task.sessionId ||
        sessionRuntime.workspaceId !== task.workspaceId ||
        sessionRuntime.agentVersionId !== task.invokableVersionId ||
        sessionRuntime.environmentVersionId !==
          productSession?.environmentVersionId ||
        !sameToolRefs(sessionRuntime.toolRefs, runtimeToolRefs) ||
        sessionRuntime.sessionBinding !== null ||
        sessionRuntime.workspaceBinding !== null
      )
        throw new Error(
          'New Product Session runtime session is already bound.',
        );
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

    if (member?.role === 'lead') {
      const capabilityBinder = this.runtimeExtensionBinder as
        | (RuntimeExtensionBinder & {
            revoke?: (grantId: string) => void;
            activeToolCalls?: (grantId: string) => number;
          })
        | undefined;
      if (
        !capabilityBinder?.bind ||
        !capabilityBinder.getTeamMemberGrant ||
        !capabilityBinder.refreshForTeamMember ||
        !capabilityBinder.activeToolCalls ||
        !capabilityBinder.revoke
      )
        throw new Error('Lead runtime grant capabilities are unavailable.');
    }

    let extensions;
    if (
      !priorExternalSessionId &&
      (resolved.skills.length > 0 || runtimeToolRefs.length > 0)
    ) {
      if (!this.runtimeExtensionBinder)
        throw new Error('Runtime extension binding is unavailable.');
      extensions = await this.runtimeExtensionBinder.bind({
        tenantId: task.tenantId,
        principalType: task.principalType,
        principalId: task.principalId,
        workspaceId: task.workspaceId,
        ...(task.sessionId ? { productSessionId: task.sessionId } : {}),
        ...(!task.sessionId ? { scopeId: turnGrantScopeId } : {}),
        taskId: task.id,
        runId: claim.run.id,
        ...(member?.id ? { teamMemberRunId: member.id } : {}),
        ...(collaborativeTeam && member
          ? { teamRunId: collaborativeTeam.id }
          : {}),
        ...(collaborativeTeam && member
          ? { contextEpoch: deriveTeamContextEpoch(task.id, claim.run.id) }
          : {}),
        skills: resolved.skills,
        toolRefs: runtimeToolRefs,
        catalogTools:
          collaborativeTeam && member?.role === 'lead'
            ? leadCatalogToolRefs
            : runtimeToolRefs,
        ...(cellCwd ? { cellCwd } : {}),
      });
    }

    const refreshableBinder = this.runtimeExtensionBinder as
      | (RuntimeExtensionBinder & {
          refreshForSession?: (
            productSessionId: string,
            allowedTools: readonly string[],
            ttlMs?: number,
          ) => void;
        })
      | undefined;
    let exactLeadGrantId: string | undefined;

    if (member?.role === 'lead') {
      if (!refreshableBinder?.getTeamMemberGrant)
        throw new Error('Lead runtime grant is unavailable.');
      const issued = refreshableBinder.getTeamMemberGrant({
        teamMemberRunId: member.id,
        scopeId: turnGrantScopeId,
      });
      if (!issued) throw new Error('Lead runtime grant is unavailable.');
      if (
        sessionRuntime &&
        !sameToolRefs(issued.catalogTools, sessionRuntime.toolRefs)
      )
        throw new Error('Lead runtime grant catalog is invalid.');
      exactLeadGrantId = issued.grantId;
    }

    if (
      priorExternalSessionId &&
      member &&
      member.role !== 'lead' &&
      collaborativeTeam
    ) {
      if (
        !this.tasks.findByRootTaskIdForOwner ||
        !this.runs ||
        !refreshableBinder?.getTeamMemberGrant ||
        !refreshableBinder.refreshForTeamMember
      )
        throw new Error('Previous Team turn cannot be verified.');
      const oldGrant = refreshableBinder.getTeamMemberGrant({
        teamMemberRunId: member.id,
        scopeId: turnGrantScopeId,
      });
      if (
        !oldGrant?.runId ||
        oldGrant.runId === claim.run.id ||
        oldGrant.allowedTools.length !== 0 ||
        !refreshableBinder.activeToolCalls ||
        refreshableBinder.activeToolCalls(oldGrant.grantId) !== 0 ||
        (sessionRuntime &&
          !sameToolRefs(oldGrant.catalogTools, sessionRuntime.toolRefs))
      )
        throw new Error('Previous Team turn cannot be verified.');
      const oldRun = await this.runs.findByIdForOwner(oldGrant.runId, {
        tenantId: task.tenantId,
        workspaceId: task.workspaceId,
        principalType: task.principalType,
        principalId: task.principalId,
      });
      if (!oldRun || !terminalRunStatuses.has(oldRun.status))
        throw new Error('Previous Team run is still active.');
      const records = await this.tasks.findByRootTaskIdForOwner(
        collaborativeTeam.rootTaskId,
        {
          tenantId: task.tenantId,
          workspaceId: task.workspaceId,
          principalType: task.principalType,
          principalId: task.principalId,
        },
      );
      const otherActive = records.some(
        (record) =>
          record.task.teamMemberRunId === member.id &&
          record.task.id !== task.id &&
          record.latestRun !== null &&
          !terminalRunStatuses.has(record.latestRun.status),
      );
      if (otherActive) throw new Error('Team member has another active Task.');
    }

    if (
      priorExternalSessionId &&
      member &&
      collaborativeTeam &&
      refreshableBinder?.refreshForTeamMember
    ) {
      const refreshed = refreshableBinder.refreshForTeamMember({
        ...(exactLeadGrantId ? { grantId: exactLeadGrantId } : {}),
        teamMemberRunId: member.id,
        scopeId: turnGrantScopeId,
        taskId: task.id,
        runId: claim.run.id,
        allowedTools: runtimeToolRefs,
        contextEpoch: deriveTeamContextEpoch(task.id, claim.run.id),
      });
      exactLeadGrantId = refreshed.grantId;
    }

    if (
      priorExternalSessionId &&
      !member &&
      sessionRuntime &&
      sessionRuntime.toolRefs.length > 0 &&
      refreshableBinder?.refreshForSession
    )
      refreshableBinder.refreshForSession(
        task.sessionId ?? task.id,
        task.sessionId ? sessionRuntime.toolRefs : [],
      );

    const runtimeObservationSink = this.events
      ? {
          emit: async (observation: ExecutionObservation) => {
            const payload = executionObservationPayload(observation, {
              isTeamMember: member != null,
              runtimeToolRefs,
              catalogTools:
                member?.role === 'lead' ? leadCatalogToolRefs : runtimeToolRefs,
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
          ...(sessionRuntime ? { runtimeSessionId: sessionRuntime.id } : {}),
          ...(cellCwd ? { cwd: cellCwd } : {}),
          ...(priorSessionBinding && !sessionRuntime
            ? { compatibilitySessionBinding: priorSessionBinding }
            : {}),
          ...(!priorExternalSessionId &&
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
          ...(!priorExternalSessionId && runtimeModelPolicy
            ? {
                provider: runtimeModelPolicy.provider,
                model: runtimeModelPolicy.model,
              }
            : {}),
          ...(!priorExternalSessionId
            ? {
                systemPrompt: prompts.systemPrompt,
                ...(collaborativeTeam
                  ? { workspaceTitle: `Team ${collaborativeTeam.id.slice(0, 8)}` }
                  : {}),
                ...(member
                  ? {
                      sessionTitle: `${member.name} (${member.role})`,
                      labels: {
                        team_run_id: member.teamRunId,
                        member_name: member.name,
                        role: member.role,
                      },
                    }
                  : {}),
                ...(extensions ? { extensions } : {}),
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

    let narrowingError: unknown;
    try {
      if (member?.role === 'lead') {
        if (!exactLeadGrantId || !refreshableBinder?.refreshForTeamMember)
          throw new Error('Lead runtime grant could not be narrowed.');
        try {
          const narrowed = refreshableBinder.refreshForTeamMember({
            grantId: exactLeadGrantId,
            teamMemberRunId: member.id,
            scopeId: turnGrantScopeId,
            taskId: task.id,
            runId: claim.run.id,
            allowedTools: [],
            contextEpoch: deriveTeamContextEpoch(task.id, claim.run.id),
          });
          if (narrowed.allowedTools.length !== 0)
            throw new Error('Lead runtime grant did not narrow to zero.');
        } catch (error) {
          this.revokeGrantSafely(refreshableBinder, exactLeadGrantId);
          throw error;
        }
      } else if (
        member &&
        refreshableBinder?.getTeamMemberGrant &&
        refreshableBinder.refreshForTeamMember
      ) {
        const grant = refreshableBinder.getTeamMemberGrant({
          teamMemberRunId: member.id,
          scopeId: turnGrantScopeId,
        });
        if (grant) {
          try {
            refreshableBinder.refreshForTeamMember({
              grantId: grant.grantId,
              teamMemberRunId: member.id,
              scopeId: turnGrantScopeId,
              taskId: task.id,
              runId: claim.run.id,
              allowedTools: [],
              contextEpoch: deriveTeamContextEpoch(task.id, claim.run.id),
            });
          } catch (error) {
            this.revokeGrantSafely(refreshableBinder, grant.grantId);
            throw error;
          }
        }
      }
    } catch (error) {
      narrowingError = error;
    }

    if (executionFailed) throw executionError;
    if (narrowingError) throw narrowingError;
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

  private revokeGrantSafely(
    binder: RuntimeExtensionBinder,
    grantId: string,
  ): void {
    try {
      binder.revoke?.(grantId);
    } catch (error) {
      try {
        this.logger.log('warn', 'run.runtime_grant_revoke_failed', {
          grant_id: grantId,
          error_name: error instanceof Error ? error.name : 'UnknownError',
        });
      } catch {
        // Secondary logging failure must not mask the primary runtime error.
      }
    }
  }
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
