import {
  transitionRun,
  type Run,
  type RunFailure,
} from '../../domain/runs/run.js';
import { RUN_API_COMPATIBILITY_INVOKABLE_VERSION_ID } from '../../domain/tasks/compatibility-invokable-version.js';
import { transitionTask, type Task } from '../../domain/tasks/task.js';
import type { Logger } from '../../shared/observability/logger.js';
import { ResolveAgentVersion } from '../agents/resolve-agent-version.js';
import {
  type AgentRuntimePort,
  type RuntimeEvent,
  RuntimeTimedOutError,
} from '../ports/agent-runtime.js';
import type {
  InvokableOwnerScope,
  InvokableRepository,
} from '../ports/invokable-repository.js';
import {
  RunCompletionConflictError,
  type ClaimedRun,
  type RunRepository,
} from '../ports/run-repository.js';
import type { TaskRepository } from '../ports/task-repository.js';
import type { RunEventRepository } from '../ports/run-events.js';
import type { FileStore } from '../ports/file-store.js';
import type { CreateMemoryProposal } from '../memory/create-memory-proposal.js';
import {
  buildBootstrapPrompt,
  buildTurnPrompt,
} from '../context/runtime-prompts.js';
import { ExecuteTeamTask } from '../tasks/execute-team-task.js';
import {
  AGENT_SERVER_TEAM_TOOL_REFS,
  AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS,
} from '../agents/built-in-skills.js';
import type { RuntimeExtensionBinder } from '../extensions/runtime-extension-binder.js';
import type { ResolvedSkillPackage } from '../extensions/skill-catalog.js';
import type { RuntimeSessionRepository } from '../ports/runtime-session-repository.js';
import type { SessionRepository } from '../ports/session-repository.js';
import type { EnvironmentRegistry } from '../ports/environment-registry.js';
import type { DagTeamExecutionRepository } from '../ports/team-execution-repository.js';
import type { TeamExecutionRepository } from '../ports/team-execution-repository.js';
import type { TeamWakeReconciler } from '../teams/team-wake-reconciler.js';
import {
  deriveAgenticLeadCommandPolicy,
  type AgenticLeadCommandPolicy,
} from '../teams/team-policy-evaluator.js';
import type { TeamWorkItem } from '../../domain/teams/team-work-item.js';
import type { TeamWorkItemAttempt } from '../../domain/teams/team-work-item-attempt.js';
import { terminalRunStatuses } from '../../domain/runs/run-status.js';
import { deriveTeamContextEpoch } from '../teams/team-tool-context.js';
import {
  canonicalTeamToolRefsForLeadPolicy,
  canonicalTeamToolRefsForDirectMessage,
  canonicalTeamToolRefsForRole,
} from '../teams/team-policy-evaluator.js';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { CompleteRun } from './complete-run.js';
import {
  createRuntimeExecutionReceipt,
  RunCompletionPersistenceError,
  RuntimeMemoryPersistenceError,
  RunPostPersistenceError,
} from './runtime-execution-receipt.js';

export class ExecuteRun {
  public constructor(
    private readonly completeRun: CompleteRun,
    private readonly tasks: TaskRepository,
    private readonly invokables: InvokableRepository,
    private readonly executeTeamTask: ExecuteTeamTask,
    private readonly runtime: AgentRuntimePort,
    private readonly logger: Logger,
    private readonly now: () => Date = () => new Date(),
    private readonly resolver: ResolveAgentVersion = new ResolveAgentVersion(
      { findVersion: async () => null },
      invokables,
      { resolve: async () => null },
    ),
    private readonly events?: RunEventRepository,
    private readonly fileStore?: FileStore,
    private readonly createMemoryProposal?: CreateMemoryProposal,
    private readonly runtimeExtensionBinder?: RuntimeExtensionBinder,
    private readonly runtimeSessions?: RuntimeSessionRepository,
    private readonly sessions?: Pick<SessionRepository, 'getSession'>,
    private readonly environments?: Pick<EnvironmentRegistry, 'findVersion'>,
    private readonly runtimeCellRoot?: string,
    private readonly teamExecutions?: DagTeamExecutionRepository,
    private readonly collaborativeExecutions?: TeamExecutionRepository,
    private readonly runs?: Pick<RunRepository, 'findByIdForOwner'>,
    private readonly wakeReconciler?: Pick<
      TeamWakeReconciler,
      'reconcileForRootTask'
    >,
  ) {}

  public async ensureRuntimeReady(): Promise<boolean> {
    try {
      const health = await this.runtime.health();
      if (health.ready) {
        return true;
      }

      await this.runtime.initialize();
      return (await this.runtime.health()).ready;
    } catch (error) {
      this.logger.log('warn', 'run.runtime.unavailable', {
        error_name: error instanceof Error ? error.name : 'UnknownError',
      });
      return false;
    }
  }

  public async execute(claim: ClaimedRun) {
    this.logger.log('info', 'run.started', {
      run_id: claim.run.id,
      worker_id: claim.workerId,
      activation_id: claim.activationId,
      fencing_token: claim.fencingToken,
    });

    let completed: Run;
    let memberRunId: string | null = null;
    let memberOwner: InvokableOwnerScope | null = null;
    let task: Task | null | undefined;

    try {
      await this.events?.append(claim.run.id, 'started', {});
      task = await this.tasks.findById(claim.taskId);
      if (!task) {
        throw new Error(
          `Task ${claim.taskId} could not be loaded for execution`,
        );
      }

      if (this.collaborativeExecutions && task.logicalStepKey) {
        const memberId = task.logicalStepKey.match(
          /^(?:member|lead):[^:]+:([^:]+)/,
        )?.[1];
        if (memberId) {
          const owner = {
            tenantId: task.tenantId,
            workspaceId: task.workspaceId,
            principalType: task.principalType,
            principalId: task.principalId,
          };
          const member = await this.collaborativeExecutions.findMemberRunById(
            memberId,
            owner,
          );
          if (member) {
            memberRunId = member.id;
            memberOwner = owner;
            await this.collaborativeExecutions.updateMemberRunStatus(
              member.id,
              'active',
              undefined,
              owner,
            );
          }
        }
      }

      await this.events?.bind({
        runId: claim.run.id,
        ...(task.sessionId ? { sessionId: task.sessionId } : {}),
        createdAt: claim.run.updatedAt,
      });

      if (task.status === 'queued') {
        await this.tasks.save(
          transitionTask(task, 'active', () => new Date(claim.run.updatedAt)),
        );
      }

      const terminalRun =
        task.invokableKind === 'team'
          ? await this.executeTeamTask.execute({
              claim,
              task,
              resolver: this.resolver,
            })
          : await this.executeAgentRun(
              claim,
              {
                tenantId: task.tenantId,
                workspaceId: task.workspaceId,
                principalType: task.principalType,
                principalId: task.principalId,
              },
              task.invokableVersionId,
              task,
            );

      completed =
        terminalRun.status === 'waiting_children'
          ? terminalRun
          : await this.completeTerminalRun(claim, terminalRun);
      if (
        memberRunId &&
        memberOwner &&
        terminalRun.status !== 'waiting_children'
      )
        await this.updateTerminalMemberRunStatus({
          claimTaskId: claim.taskId,
          task,
          memberRunId,
          memberOwner,
          fallbackStatus: completed.status === 'succeeded' ? 'idle' : 'failed',
        });
      if (memberRunId && memberOwner && this.wakeReconciler) {
        const team = await this.collaborativeExecutions!.findMemberRunById(
          memberRunId,
          memberOwner,
        );
        if (team)
          await this.wakeReconciler.reconcileForRootTask(
            (
              await this.collaborativeExecutions!.findTeamRunById(
                team.teamRunId,
                memberOwner,
              )
            )?.rootTaskId ?? '',
            memberOwner,
          );
      }
    } catch (error) {
      if (error instanceof RunCompletionConflictError) throw error;
      if (error instanceof RunCompletionPersistenceError) {
        if (memberRunId && memberOwner)
          await this.updateTerminalMemberRunStatus({
            claimTaskId: claim.taskId,
            task,
            memberRunId,
            memberOwner,
            fallbackStatus: 'failed',
          }).catch(() => undefined);
        this.reportCompletionPersistenceFailure(error.receipt);
        throw error;
      }
      if (error instanceof RunPostPersistenceError) {
        if (memberRunId && memberOwner)
          await this.updateTerminalMemberRunStatus({
            claimTaskId: claim.taskId,
            task,
            memberRunId,
            memberOwner,
            fallbackStatus:
              error.details.terminalStatus === 'succeeded' ? 'idle' : 'failed',
          }).catch(() => undefined);
        this.reportPostPersistenceFailure(error);
        throw error;
      }
      if (memberRunId && memberOwner)
        await this.updateTerminalMemberRunStatus({
          claimTaskId: claim.taskId,
          task,
          memberRunId,
          memberOwner,
          fallbackStatus: 'failed',
        }).catch(() => undefined);
      if (error instanceof RuntimeMemoryPersistenceError) {
        this.logger.log('error', 'run.memory_persistence_failed', {
          run_id: error.receipt.runId,
          terminal_status: error.receipt.terminalStatus,
          result_available: error.receipt.resultAvailable,
        });
        throw error;
      }
      const timedOut = error instanceof RuntimeTimedOutError;
      const failure: RunFailure = timedOut
        ? {
            code: 'runtime_timed_out',
            message: 'The runtime exceeded the configured timeout.',
          }
        : {
            code: 'runtime_execution_failed',
            message: 'The runtime could not complete the run.',
          };
      const failed = transitionRun(
        claim.run,
        timedOut ? 'timed_out' : 'failed',
        {
          error: failure,
        },
        this.now,
      );
      try {
        completed = await this.completeTerminalRun(claim, failed);
      } catch (completionError) {
        if (completionError instanceof RunCompletionPersistenceError) {
          this.reportCompletionPersistenceFailure(completionError.receipt);
        }
        if (completionError instanceof RunPostPersistenceError) {
          this.reportPostPersistenceFailure(completionError);
        }
        throw completionError;
      }
    }

    this.reportCompletedRun(claim, completed);
    return completed;
  }

  private async completeTerminalRun(
    claim: ClaimedRun,
    run: Awaited<ReturnType<ExecuteRun['executeAgentRun']>>,
  ) {
    return this.completeRun.execute({ claim, run });
  }

  private async updateTerminalMemberRunStatus(input: {
    readonly claimTaskId: string;
    readonly task: Task | null | undefined;
    readonly memberRunId: string;
    readonly memberOwner: InvokableOwnerScope;
    readonly fallbackStatus: 'idle' | 'failed';
  }): Promise<void> {
    const status = await this.resolveTerminalMemberRunStatus(input).catch(
      () => input.fallbackStatus,
    );
    await this.collaborativeExecutions!.updateMemberRunStatus(
      input.memberRunId,
      status,
      undefined,
      input.memberOwner,
    );
  }

  private async resolveTerminalMemberRunStatus(input: {
    readonly claimTaskId: string;
    readonly task: Task | null | undefined;
    readonly memberRunId: string;
    readonly memberOwner: InvokableOwnerScope;
    readonly fallbackStatus: 'idle' | 'failed';
  }): Promise<'idle' | 'failed'> {
    const { task } = input;
    if (
      !task ||
      task.teamTaskKind !== 'work_attempt' ||
      task.teamMemberRunId !== input.memberRunId
    )
      return input.fallbackStatus;
    const team = await this.collaborativeExecutions!.findTeamRunByRootTaskId(
      task.rootTaskId,
      input.memberOwner,
    );
    if (!team) return input.fallbackStatus;
    const attempts =
      await this.collaborativeExecutions!.findAttemptsByTeamRunId(
        team.id,
        input.memberOwner,
      );
    return attempts.some(
      (attempt) =>
        attempt.executionTaskId === input.claimTaskId &&
        attempt.assigneeMemberId === input.memberRunId &&
        attempt.status === 'completed',
    )
      ? 'idle'
      : input.fallbackStatus;
  }

  private reportCompletedRun(claim: ClaimedRun, completed: Run): void {
    this.logger.log(
      completed.status === 'succeeded' ? 'info' : 'error',
      completed.status === 'succeeded' ? 'run.succeeded' : 'run.failed',
      {
        run_id: claim.run.id,
        ...(completed.runtime
          ? {
              provider: completed.runtime.provider,
              model: completed.runtime.model,
            }
          : {}),
        ...(completed.error ? { failure_code: completed.error.code } : {}),
      },
    );
  }

  private reportCompletionPersistenceFailure(
    receipt: ReturnType<typeof createRuntimeExecutionReceipt>,
  ): void {
    this.logger.log('error', 'run.completion_persistence_failed', {
      run_id: receipt.runId,
      task_id: receipt.taskId,
      terminal_status: receipt.terminalStatus,
      provider: receipt.provider,
      model: receipt.model,
      result_available: receipt.resultAvailable,
      result_fingerprint: receipt.resultFingerprint,
      completed_at: receipt.completedAt,
    });
  }

  private reportPostPersistenceFailure(error: RunPostPersistenceError): void {
    this.logger.log('error', 'run.post_persistence_failed', {
      run_id: error.details.runId,
      task_id: error.details.taskId,
      terminal_status: error.details.terminalStatus,
      stage: error.details.stage,
      error_name: error.details.errorName,
      cause: error.cause,
    });
  }

  private async executeAgentRun(
    claim: ClaimedRun,
    ownerScope: InvokableOwnerScope,
    invokableVersionId: string,
    task: import('../../domain/tasks/task.js').Task,
  ) {
    const teamExecution =
      !task.sessionId && this.teamExecutions
        ? await this.teamExecutions.findByChildTaskId(claim.taskId, {
            tenantId: task.tenantId,
            workspaceId: task.workspaceId,
            principalType: task.principalType,
            principalId: task.principalId,
          })
        : null;
    const collaborativeTeam = this.collaborativeExecutions
      ? await this.collaborativeExecutions.findTeamRunByRootTaskId(
          task.rootTaskId,
          {
            tenantId: task.tenantId,
            workspaceId: task.workspaceId,
            principalType: task.principalType,
            principalId: task.principalId,
          },
        )
      : null;
    const memberId = task.logicalStepKey?.match(
      /^(?:member|lead):[^:]+:([^:]+)/,
    )?.[1];
    const member =
      collaborativeTeam && memberId && this.collaborativeExecutions
        ? (
            await this.collaborativeExecutions.findMembersByTeamRunId(
              collaborativeTeam.id,
              {
                tenantId: task.tenantId,
                workspaceId: task.workspaceId,
                principalType: task.principalType,
                principalId: task.principalId,
              },
            )
          ).find((candidate) => candidate.id === memberId)
        : null;
    const leadFinalization =
      member?.role === 'lead' && task.logicalStepKey?.endsWith(':finalize');
    const agenticLeadControlTurn =
      collaborativeTeam?.executionMode === 'agentic_mve' &&
      task.teamTaskKind === 'lead_turn' &&
      member?.role === 'lead';
    const turnGrantScopeId = agenticLeadControlTurn
      ? task.id
      : (member?.id ?? task.id);
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
        : agenticLeadControlTurn && this.runtimeSessions
          ? await this.runtimeSessions.findByTask({
              taskId: task.id,
              tenantId: task.tenantId,
              principalType: task.principalType,
              principalId: task.principalId,
            })
          : member &&
              !leadFinalization &&
              this.runtimeSessions?.findByTeamMember
            ? await this.runtimeSessions.findByTeamMember({
                teamMemberRunId: member.id,
                tenantId: task.tenantId,
                principalType: task.principalType,
                principalId: task.principalId,
              })
            : teamExecution && this.runtimeSessions
              ? await this.runtimeSessions.findByTask({
                  taskId: task.id,
                  tenantId: task.tenantId,
                  principalType: task.principalType,
                  principalId: task.principalId,
                })
              : null;
    const legacyProviderAgentId =
      task.sessionId &&
      productSession &&
      productSession.environmentVersionId == null &&
      !runtimeSession &&
      this.events?.findLatestProviderAgentBySessionId
        ? await this.events.findLatestProviderAgentBySessionId(task.sessionId)
        : null;
    const priorProviderAgentId =
      runtimeSession?.providerAgentId ??
      legacyProviderAgentId ??
      (!this.runtimeSessions &&
      task.sessionId &&
      this.events?.findLatestProviderAgentBySessionId
        ? await this.events.findLatestProviderAgentBySessionId(task.sessionId)
        : null);
    const resolved = priorProviderAgentId
      ? await this.resolveContinuationPrompt(
          claim.run.prompt,
          ownerScope,
          invokableVersionId,
          task,
        )
      : await this.resolveAgentPrompt(
          claim.run.prompt,
          ownerScope,
          invokableVersionId,
          task,
        );
    const agenticLeadState =
      collaborativeTeam?.executionMode === 'agentic_mve' &&
      member?.role === 'lead'
        ? await this.loadAgenticLeadState(collaborativeTeam, task)
        : null;
    let sessionRuntime = runtimeSession;
    const canonicalTeamRefs = new Set<string>([
      ...Object.values(AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS),
      ...AGENT_SERVER_TEAM_TOOL_REFS,
    ]);
    const domainToolRefs = (
      sessionRuntime?.toolRefs ?? resolved.toolRefs
    ).filter((ref) => !canonicalTeamRefs.has(ref));
    const runtimeToolRefs =
      collaborativeTeam?.executionMode === 'agentic_mve' &&
      task.teamTaskKind === 'direct_message'
        ? canonicalTeamToolRefsForDirectMessage()
        : collaborativeTeam?.executionMode === 'agentic_mve' &&
            task.teamTaskKind === 'work_attempt'
          ? [...domainToolRefs, ...canonicalTeamToolRefsForRole('member')]
          : collaborativeTeam?.executionMode === 'agentic_mve' &&
              member?.role === 'lead'
            ? [
                ...domainToolRefs,
                ...canonicalTeamToolRefsForLeadPolicy(
                  agenticLeadState?.policy ?? { allowedCommands: [] },
                ),
              ]
            : leadFinalization
              ? resolved.toolRefs.filter(
                  (ref) => !AGENT_SERVER_TEAM_TOOL_REFS.includes(ref),
                )
              : resolved.toolRefs;
    const turnPrompt =
      collaborativeTeam?.executionMode === 'agentic_mve' &&
      member?.role === 'lead'
        ? await this.withAgenticLeadContext(
            resolved.turnPrompt,
            claim.run.id,
            task.id,
            collaborativeTeam,
            task,
            agenticLeadState,
            runtimeToolRefs,
          )
        : resolved.turnPrompt;
    const systemPrompt =
      collaborativeTeam?.executionMode === 'agentic_mve' &&
      task.teamTaskKind === 'direct_message'
        ? `${resolved.systemPrompt}\n\nThis is a direct Team message turn. Use only safe Team state/list reads. Acknowledge or act on the safe message content; it is not Work and must not cause Work submission, review, acceptance, checkpointing, or further Team messages.`
        : collaborativeTeam?.executionMode === 'agentic_mve' &&
            task.teamTaskKind === 'work_attempt'
          ? `${resolved.systemPrompt}\n\nThis is an assigned Team Work attempt. Use real domain tools from the published agent profile plus canonical member state/list/checkpoint/submit tools. Do not use legacy team tools or internal IDs; submit the bounded result and end the turn.`
          : collaborativeTeam?.executionMode === 'agentic_mve' &&
              member?.role === 'lead'
            ? `${resolved.systemPrompt}\n\nTeam policy: use canonical Team tools and published Lead domain tools. Never use legacy team_task_* tools or internal IDs. Make all current coordination decisions in this turn, may issue multiple valid commands, and do not wait for members.`
            : resolved.systemPrompt;
    if (
      this.runtimeSessions &&
      !sessionRuntime &&
      ((task.sessionId && productSession?.environmentVersionId != null) ||
        (teamExecution != null && teamExecution.environmentVersionId != null) ||
        (member != null && collaborativeTeam != null))
    ) {
      if (!this.environments)
        throw new Error(
          'Product Session runtime dependencies are unavailable.',
        );
      const environmentVersionId =
        productSession?.environmentVersionId ??
        teamExecution?.environmentVersionId ??
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
        spec.provider !== 'opencode' ||
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
        : agenticLeadControlTurn
          ? await this.runtimeSessions.createOrGetForTask({
              taskId: task.id,
              tenantId: task.tenantId,
              principalType: task.principalType,
              principalId: task.principalId,
              workspaceId: task.workspaceId,
              agentVersionId: resolved.agentVersionId,
              environmentVersionId: environmentVersionId!,
              resolvedSkills: resolved.skills,
              toolRefs: runtimeToolRefs,
            })
          : member &&
              !leadFinalization &&
              this.runtimeSessions.createOrGetForTeamMember
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
                toolRefs: runtimeToolRefs,
              })
            : await this.runtimeSessions.createOrGetForTask({
                taskId: task.id,
                tenantId: task.tenantId,
                principalType: task.principalType,
                principalId: task.principalId,
                workspaceId: task.workspaceId,
                agentVersionId: resolved.agentVersionId,
                environmentVersionId: environmentVersionId!,
                resolvedSkills: resolved.skills,
                toolRefs: runtimeToolRefs,
              });
    }
    if (
      member &&
      !leadFinalization &&
      !agenticLeadControlTurn &&
      sessionRuntime &&
      this.collaborativeExecutions
    )
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
    let extensions;
    if (
      !priorProviderAgentId &&
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
        ...(!task.sessionId
          ? {
              scopeId: turnGrantScopeId,
            }
          : {}),
        taskId: task.id,
        runId: claim.run.id,
        ...(member?.id ? { teamMemberRunId: member.id } : {}),
        ...(collaborativeTeam && member
          ? {
              contextEpoch: deriveTeamContextEpoch(task.id, claim.run.id),
            }
          : {}),
        skills: resolved.skills,
        toolRefs: runtimeToolRefs,
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
          refreshForTeamMember?: (input: {
            readonly teamMemberRunId: string;
            readonly scopeId: string;
            readonly taskId: string;
            readonly runId: string;
            readonly allowedTools: readonly string[];
            readonly contextEpoch: string;
          }) => void;
          getTeamMemberGrant?: (input: {
            readonly teamMemberRunId: string;
            readonly scopeId: string;
          }) =>
            | import('../extensions/runtime-tool-grant-service.js').RuntimeToolGrant
            | null;
        })
      | undefined;
    if (priorProviderAgentId && member && collaborativeTeam) {
      if (
        !this.tasks.findByRootTaskIdForOwner ||
        !this.runs ||
        !refreshableBinder?.getTeamMemberGrant ||
        !refreshableBinder.refreshForTeamMember
      )
        throw new Error('Previous Team turn cannot be verified.');
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
      const oldGrant = refreshableBinder?.getTeamMemberGrant?.({
        teamMemberRunId: member.id,
        scopeId: turnGrantScopeId,
      });
      if (!oldGrant?.runId)
        throw new Error('Previous Team turn cannot be verified.');
      const oldRun = await this.runs.findByIdForOwner(oldGrant.runId, {
        tenantId: task.tenantId,
        workspaceId: task.workspaceId,
        principalType: task.principalType,
        principalId: task.principalId,
      });
      if (
        !oldRun ||
        (oldGrant.runId !== claim.run.id &&
          !terminalRunStatuses.has(oldRun.status))
      )
        throw new Error('Previous Team run is still active.');
    }
    if (
      priorProviderAgentId &&
      member &&
      collaborativeTeam &&
      refreshableBinder?.refreshForTeamMember
    )
      refreshableBinder.refreshForTeamMember({
        teamMemberRunId: member.id,
        scopeId: turnGrantScopeId,
        taskId: task.id,
        runId: claim.run.id,
        allowedTools: runtimeToolRefs,
        contextEpoch: deriveTeamContextEpoch(task.id, claim.run.id),
      });
    if (
      priorProviderAgentId &&
      !member &&
      sessionRuntime &&
      sessionRuntime.toolRefs.length > 0 &&
      refreshableBinder?.refreshForSession
    )
      refreshableBinder.refreshForSession(
        task.sessionId ?? task.id,
        task.sessionId ? sessionRuntime.toolRefs : [],
      );
    const runtimeEventSink = this.events
      ? {
          emit: async (event: RuntimeEvent) => {
            await this.events!.append(claim.run.id, 'output', {
              ...runtimeEventPayload(event),
            });
          },
        }
      : undefined;
    const execution = await this.runtime.execute(
      priorProviderAgentId
        ? {
            operation: 'continue',
            ...(sessionRuntime?.paseoWorkspaceId
              ? { paseoWorkspaceId: sessionRuntime.paseoWorkspaceId }
              : {}),
            ...(sessionRuntime ? { runtimeSessionId: sessionRuntime.id } : {}),
            ...(cellCwd ? { cellCwd } : {}),
            runId: claim.run.id,
            prompt: turnPrompt,
            providerAgentId: priorProviderAgentId,
            ...(resolved.proposalLimit > 0
              ? { memoryCandidates: { proposalLimit: resolved.proposalLimit } }
              : {}),
          }
        : {
            operation: 'create',
            ...(sessionRuntime ? { runtimeSessionId: sessionRuntime.id } : {}),
            ...(cellCwd ? { cellCwd } : {}),
            runId: claim.run.id,
            prompt: turnPrompt,
            systemPrompt,
            ...(extensions ? { extensions } : {}),
            ...(resolved.proposalLimit > 0
              ? { memoryCandidates: { proposalLimit: resolved.proposalLimit } }
              : {}),
          },
      runtimeEventSink,
    );
    if (
      sessionRuntime &&
      !sessionRuntime.providerAgentId &&
      execution.paseoWorkspaceId
    )
      await this.runtimeSessions!.bindProvider({
        id: sessionRuntime.id,
        paseoWorkspaceId: execution.paseoWorkspaceId,
        providerAgentId: execution.providerAgentId,
      });
    await this.events?.bind({
      runId: claim.run.id,
      ...(task.sessionId ? { sessionId: task.sessionId } : {}),
      providerAgentId: execution.providerAgentId,
      createdAt: claim.run.updatedAt,
    });
    const candidateInputs = (
      task.sourceMessageId ? (execution.memoryCandidates ?? []) : []
    )
      .slice(0, resolved.proposalLimit)
      .flatMap((candidate, sourceCandidateIndex) => {
        if (!isSafeRuntimeCandidate(candidate)) return [];
        return [
          {
            content: candidate.content,
            category: candidate.category,
            sourceTaskId: task.id,
            ...(task.sessionId ? { sourceSessionId: task.sessionId } : {}),
            ...(task.sourceMessageId
              ? { sourceMessageId: task.sourceMessageId }
              : {}),
            sourceRunId: claim.run.id,
            sourceAgentVersionId: resolved.agentVersionId,
            sourceCandidateIndex,
            accessContext: {
              tenantId: task.tenantId,
              serviceAccountId: task.principalId,
              workspaceId: task.workspaceId,
              principalType: task.principalType as 'service_account',
              principalId: task.principalId,
              policySnapshotVersion: task.policySnapshotVersion,
            },
          },
        ];
      });
    try {
      if (candidateInputs.length && this.createMemoryProposal) {
        if (this.createMemoryProposal.executeBatch) {
          await this.createMemoryProposal.executeBatch(candidateInputs);
        } else {
          for (const input of candidateInputs)
            await this.createMemoryProposal.execute(input);
        }
      }
    } catch (error) {
      const receipt = createRuntimeExecutionReceipt(
        transitionRun(
          claim.run,
          'succeeded',
          {
            runtime: { provider: execution.provider, model: execution.model },
            result: { text: execution.text },
            ...(execution.usage ? { usage: execution.usage } : {}),
          },
          this.now,
        ),
        claim.taskId,
      );
      this.logger.log('error', 'run.memory_persistence_failed', {
        run_id: claim.run.id,
        error_name: error instanceof Error ? error.name : 'UnknownError',
      });
      throw new RuntimeMemoryPersistenceError(receipt);
    }
    const succeeded = transitionRun(
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
    return succeeded;
  }

  private async resolveAgentPrompt(
    prompt: string,
    ownerScope: InvokableOwnerScope,
    invokableVersionId: string,
    task: import('../../domain/tasks/task.js').Task,
  ): Promise<{
    readonly systemPrompt: string;
    readonly turnPrompt: string;
    readonly proposalLimit: number;
    readonly agentVersionId: string;
    readonly skills: readonly ResolvedSkillPackage[];
    readonly toolRefs: readonly string[];
  }> {
    if (invokableVersionId === RUN_API_COMPATIBILITY_INVOKABLE_VERSION_ID) {
      return {
        systemPrompt: buildBootstrapPrompt(),
        turnPrompt: prompt,
        proposalLimit: 0,
        agentVersionId: invokableVersionId,
        skills: [],
        toolRefs: [],
      };
    }

    const agentVersion = await this.resolver.resolvePublished(
      invokableVersionId,
      ownerScope,
    );

    if (!agentVersion) {
      throw new Error(
        `Published agent version ${invokableVersionId} could not be loaded for execution`,
      );
    }
    const memory = await this.loadPinnedMemory(task);
    return {
      systemPrompt: buildBootstrapPrompt(
        agentVersion.instructions,
        agentVersion.skills,
      ),
      turnPrompt: buildTurnPrompt({ taskInput: prompt, memory }),
      proposalLimit: agentVersion.proposalLimit ?? 0,
      agentVersionId: invokableVersionId,
      skills: agentVersion.skills,
      toolRefs: agentVersion.toolRefs,
    };
  }

  private async resolveContinuationPrompt(
    prompt: string,
    ownerScope: InvokableOwnerScope,
    invokableVersionId: string,
    task: import('../../domain/tasks/task.js').Task,
  ): Promise<{
    readonly systemPrompt: string;
    readonly turnPrompt: string;
    readonly proposalLimit: number;
    readonly agentVersionId: string;
    readonly skills: readonly ResolvedSkillPackage[];
    readonly toolRefs: readonly string[];
  }> {
    const metadata =
      invokableVersionId === RUN_API_COMPATIBILITY_INVOKABLE_VERSION_ID
        ? { proposalLimit: 0 }
        : await this.resolver.resolvePublished(invokableVersionId, ownerScope, {
            resolveExtensions: false,
          });
    if (!metadata)
      throw new Error(
        `Published agent version ${invokableVersionId} could not be loaded for execution`,
      );
    return {
      systemPrompt: '',
      turnPrompt: buildTurnPrompt({
        taskInput: prompt,
        memory: await this.loadPinnedMemory(task),
      }),
      proposalLimit: metadata.proposalLimit ?? 0,
      agentVersionId: invokableVersionId,
      skills: [],
      toolRefs: [],
    };
  }

  private async withAgenticLeadContext(
    prompt: string,
    sourceRunId: string,
    leadTaskId: string,
    team: import('../../domain/teams/team-run.js').TeamRun,
    task: import('../../domain/tasks/task.js').Task,
    leadState: {
      readonly policy: AgenticLeadCommandPolicy;
      readonly workItems: readonly TeamWorkItem[];
      readonly attempts: readonly TeamWorkItemAttempt[];
    } | null,
    runtimeToolRefs: readonly string[],
  ): Promise<string> {
    const members = this.collaborativeExecutions
      ? await this.collaborativeExecutions.findMembersByTeamRunId(team.id, {
          tenantId: task.tenantId,
          workspaceId: task.workspaceId,
          principalType: task.principalType,
          principalId: task.principalId,
        })
      : [];
    const roster = members
      .filter((member) => member.role !== 'lead')
      .map((member) => `${member.name} (${member.role})`)
      .join(', ');
    const workItems = leadState?.workItems ?? [];
    const attempts = leadState?.attempts ?? [];
    const memberNameById = new Map(
      members.map((member) => [member.id, member.name]),
    );
    const snapshot = JSON.stringify({
      goal: safeAgenticLeadSnapshotText(prompt),
      members: members.map((member) => ({
        name: safeAgenticLeadSnapshotText(member.name),
        role: member.role,
      })),
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
        rework: leadState?.policy.eligibleReworkWorkItemIds
          .map(
            (id) => `work-${workItems.findIndex((item) => item.id === id) + 1}`,
          )
          .filter((ref) => ref !== 'work-0'),
      },
    });
    return `${prompt}

Team control protocol (authoritative for this turn): Lead control turns must not spawn, delegate to, or use provider subagents, shell commands, or filesystem tools. allowed_commands lists the durable control actions required by the current state; execute every one using eligible_targets. If eligible_targets.accept is non-empty and team_work_accept is allowed, call team_work_accept({work_ref}) for each qualifying completed Work ref that meets the rubric. If eligible_targets.rework is non-empty and team_work_request_changes is allowed, call team_work_request_changes for each qualifying ref that requires correction. If the board is empty and team_work_create is allowed, create the necessary useful Work. If team_finish is allowed, call team_finish. available_coordination_commands lists auxiliary actions actually exposed in this turn; after completing required control, use them only when the task requires them. team_message_send never substitutes for or counts as durable control progress. A plain-text response or no-op is not control progress. Supply only business inputs: use the published logical assignee name and work_ref values such as work-1; the server derives all Team, Task, Run, revision, and command identity. The fixed member roster is: ${roster || 'none'}. Do not wait for members in this turn and do not call team_complete.

Current bounded Lead snapshot (control-plane fields only): ${snapshot}`;
  }

  private async loadAgenticLeadState(
    team: import('../../domain/teams/team-run.js').TeamRun,
    task: import('../../domain/tasks/task.js').Task,
  ) {
    const owner = {
      tenantId: task.tenantId,
      workspaceId: task.workspaceId,
      principalType: task.principalType,
      principalId: task.principalId,
    };
    const workItems =
      await this.collaborativeExecutions!.findWorkItemsByTeamRunId(
        team.id,
        owner,
      );
    const attempts =
      await this.collaborativeExecutions!.findAttemptsByTeamRunId(
        team.id,
        owner,
      );
    return {
      workItems,
      attempts,
      policy: deriveAgenticLeadCommandPolicy(team, workItems, attempts),
    };
  }

  private async loadPinnedMemory(
    task: import('../../domain/tasks/task.js').Task,
  ): Promise<string | null> {
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

function isSafeRuntimeCandidate(candidate: {
  readonly category: string;
  readonly content: string;
}): boolean {
  return (
    [
      'terminology',
      'output_preference',
      'project_constraint',
      'confirmed_workflow_procedure',
    ].includes(candidate.category) &&
    candidate.content.length <= 4096 &&
    !/-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:api[_ -]?key|secret|token|password)\s*[:=]|\b[\w.+-]+@[\w-]+\.[\w.-]+\b/i.test(
      candidate.content,
    )
  );
}

function runtimeEventPayload(
  event: import('../ports/agent-runtime.js').RuntimeEvent,
): Readonly<Record<string, string | number | boolean | null>> {
  switch (event.kind) {
    case 'assistant_text':
      return { kind: event.kind, text: event.text };
    case 'reasoning_progress':
      return {
        kind: event.kind,
        status: event.status,
        ...(event.text ? { text: event.text } : {}),
      };
    case 'tool_status':
      return {
        kind: event.kind,
        activity_id: event.activityId,
        category: event.category,
        status: event.status,
        label: event.label,
        summary: event.summary,
        ...safeRuntimeToolNamePayload(event.toolName),
        ...(event.detailKind
          ? { detail_kind: event.detailKind }
          : ['shell', 'read', 'write', 'edit', 'search', 'fetch'].includes(
                event.category,
              )
            ? { detail_kind: event.category }
            : {}),
        ...(event.detailText ? { detail_text: event.detailText } : {}),
        ...(event.exitCode !== undefined ? { exit_code: event.exitCode } : {}),
        ...(event.parentActivityId
          ? { parent_activity_id: event.parentActivityId }
          : {}),
      };
    case 'child_timeline_item':
      return {
        kind: event.kind,
        activity_id: event.activityId,
        parent_activity_id: event.parentActivityId,
        item_kind: event.itemKind,
        status: event.status,
        label: event.label,
        summary: event.summary,
        ...(event.detailKind ? { detail_kind: event.detailKind } : {}),
        ...(event.detailText ? { detail_text: event.detailText } : {}),
        ...(event.exitCode !== undefined ? { exit_code: event.exitCode } : {}),
      };
    case 'permission':
      return {
        kind: event.kind,
        activity_id: event.activityId,
        category: event.category,
        status: event.status,
        ...(event.decision ? { decision: event.decision } : {}),
        summary: event.summary,
      };
    case 'usage': {
      const payload: Record<string, string | number | boolean | null> = {
        kind: event.kind,
      };
      if (event.inputTokens !== undefined)
        payload.input_tokens = event.inputTokens;
      if (event.cachedInputTokens !== undefined)
        payload.cached_input_tokens = event.cachedInputTokens;
      if (event.outputTokens !== undefined)
        payload.output_tokens = event.outputTokens;
      if (event.totalCostUsd !== undefined)
        payload.total_cost_usd = event.totalCostUsd;
      if (event.contextWindowMaxTokens !== undefined)
        payload.context_window_max_tokens = event.contextWindowMaxTokens;
      if (event.contextWindowUsedTokens !== undefined)
        payload.context_window_used_tokens = event.contextWindowUsedTokens;
      return payload;
    }
    default:
      return assertNeverRuntimeEvent(event);
  }
}

const safeRuntimeToolNames = new Set([
  'synthetic_stock_snapshot',
  'synthetic_event_batch',
  'synthetic_analog_summary',
  'learning_proposal_create',
  'agent_server_memory_read',
]);
const runtimeMcpToolPrefix = 'agent-server-memory-api_';

function safeRuntimeToolNamePayload(toolName: string | undefined) {
  if (!toolName) return {};
  const normalized = toolName.startsWith(runtimeMcpToolPrefix)
    ? toolName.slice(runtimeMcpToolPrefix.length)
    : toolName;
  return safeRuntimeToolNames.has(normalized) ? { tool_name: normalized } : {};
}

function assertNeverRuntimeEvent(
  event: never,
): Readonly<Record<string, string | number | boolean | null>> {
  throw new Error(`Unhandled runtime event kind: ${String(event)}`);
}
