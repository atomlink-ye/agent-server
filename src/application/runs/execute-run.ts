import {
  transitionRun,
  type Run,
  type RunFailure,
} from '../../domain/runs/run.js';
import { RUN_API_COMPATIBILITY_INVOKABLE_VERSION_ID } from '../../domain/tasks/compatibility-invokable-version.js';
import { transitionTask, type Task } from '../../domain/tasks/task.js';
import { isManagedEnvironmentProvider } from '../../domain/environments/managed-environment-package.js';
import type { Logger } from '../../shared/observability/logger.js';
import {
  ResolveAgentVersion,
  type ResolvedAgentVersion,
} from '../agents/resolve-agent-version.js';
import { resolveRuntimeModelPolicy } from '../agents/runtime-model-policy.js';
import {
  AGENT_SERVER_RUNTIME_MCP_SERVER_NAME,
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
  buildTeamSystemPrompt,
  formatTeamDeliveryPrompt,
  TEAM_LEAD_CONTROL_PROTOCOL,
  type TeamPromptRosterMember,
} from '../context/runtime-prompts.js';
import { ExecuteTeamTask } from '../tasks/execute-team-task.js';
import { AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS } from '../agents/built-in-skills.js';
import type { RuntimeExtensionBinder } from '../extensions/runtime-extension-binder.js';
import type { ResolvedSkillPackage } from '../extensions/skill-catalog.js';
import type { RuntimeSessionRepository } from '../ports/runtime-session-repository.js';
import type { SessionRepository } from '../ports/session-repository.js';
import type { EnvironmentRegistry } from '../ports/environment-registry.js';
import type { TeamExecutionRepository } from '../ports/team-execution-repository.js';
import type { TeamWakeReconciler } from '../teams/team-wake-reconciler.js';
import {
  deriveAgenticLeadCommandPolicy,
  type AgenticLeadCommandPolicy,
} from '../teams/team-policy-evaluator.js';
import type { TeamWorkItem } from '../../domain/teams/team-work-item.js';
import type { TeamWorkItemAttempt } from '../../domain/teams/team-work-item-attempt.js';
import type { TeamMemberRun } from '../../domain/teams/team-member-run.js';
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
  private readonly teamMemberMutexes = new Map<
    string,
    { tail: Promise<void>; queued: number }
  >();
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
    if (this.collaborativeExecutions) {
      const task = await this.tasks.findById(claim.taskId);
      const memberId = task?.teamMemberRunId;
      if (memberId) {
        const release = await this.acquireTeamMemberMutex(memberId);
        try {
          return await this.executeUnlocked(claim);
        } finally {
          release();
        }
      }
    }
    return this.executeUnlocked(claim);
  }

  private async executeUnlocked(claim: ClaimedRun) {
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
      task = await this.tasks.findById(claim.taskId);
      if (!task) {
        throw new Error(
          `Task ${claim.taskId} could not be loaded for execution`,
        );
      }
      if (
        ['lead_turn', 'work_attempt', 'direct_message'].includes(
          task.teamTaskKind ?? '',
        ) &&
        !task.teamMemberRunId
      )
        throw new Error('Team task is missing member identity.');

      if (task.teamMemberRunId) {
        if (!this.collaborativeExecutions)
          throw new Error('Team member task requires TeamRun execution.');
        const owner = {
          tenantId: task.tenantId,
          workspaceId: task.workspaceId,
          principalType: task.principalType,
          principalId: task.principalId,
        };
        const [member, team] = await Promise.all([
          this.collaborativeExecutions.findMemberRunById(
            task.teamMemberRunId,
            owner,
          ),
          this.collaborativeExecutions.findTeamRunByRootTaskId(
            task.rootTaskId,
            owner,
          ),
        ]);
        if (
          !team ||
          !member ||
          member.teamRunId !== team.id ||
          !['lead_turn', 'work_attempt', 'direct_message'].includes(
            task.teamTaskKind ?? '',
          ) ||
          (task.teamTaskKind === 'lead_turn' && member.role !== 'lead') ||
          ((task.teamTaskKind === 'work_attempt' ||
            task.teamTaskKind === 'direct_message') &&
            member.role !== 'member') ||
          member.agentVersionId !== task.invokableVersionId
        )
          throw new Error('Team member task identity is invalid.');
        memberRunId = member.id;
        memberOwner = owner;
      }

      await this.events?.append(claim.run.id, 'started', {});
      if (memberRunId && memberOwner)
        await this.collaborativeExecutions!.updateMemberRunStatus(
          memberRunId,
          'active',
          undefined,
          memberOwner,
        );

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
    const memberId = task.teamMemberRunId;
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
    const supportedTeamKind = [
      'lead_turn',
      'work_attempt',
      'direct_message',
    ].includes(task.teamTaskKind ?? '');
    if (task.teamMemberRunId || task.teamTaskKind) {
      if (
        !supportedTeamKind ||
        !task.teamMemberRunId ||
        !collaborativeTeam ||
        !member ||
        member.teamRunId !== collaborativeTeam.id ||
        member.agentVersionId !== task.invokableVersionId ||
        (task.teamTaskKind === 'lead_turn' && member.role !== 'lead') ||
        ((task.teamTaskKind === 'work_attempt' ||
          task.teamTaskKind === 'direct_message') &&
          member.role !== 'member')
      )
        throw new Error('Team member task identity is invalid.');
    }
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
      (runtimeSession.providerAgentId === null) !==
        (runtimeSession.paseoWorkspaceId === null)
    )
      throw new Error('Runtime session provider binding is partial.');
    const legacyProviderAgentId =
      task.sessionId &&
      productSession &&
      productSession.environmentVersionId == null &&
      !runtimeSession &&
      this.events?.findLatestProviderAgentBySessionId
        ? await this.events.findLatestProviderAgentBySessionId(task.sessionId)
        : null;
    if (
      runtimeSession &&
      member &&
      (runtimeSession.scopeKind !== 'team_member' ||
        runtimeSession.scopeId !== member.id)
    )
      throw new Error('Team member runtime session scope is invalid.');
    if (
      runtimeSession &&
      (runtimeSession.agentVersionId !== task.invokableVersionId ||
        runtimeSession.workspaceId !== task.workspaceId ||
        runtimeSession.environmentVersionId !==
          collaborativeTeam?.environmentVersionId)
    )
      throw new Error('Runtime session snapshot is invalid.');
    const priorProviderAgentId = member
      ? (runtimeSession?.providerAgentId ?? null)
      : (runtimeSession?.providerAgentId ??
        legacyProviderAgentId ??
        (!this.runtimeSessions &&
        task.sessionId &&
        this.events?.findLatestProviderAgentBySessionId
          ? await this.events.findLatestProviderAgentBySessionId(task.sessionId)
          : null));
    if (priorProviderAgentId && member?.role === 'lead' && collaborativeTeam) {
      const fenceBinder = this
        .runtimeExtensionBinder as RuntimeExtensionBinder & {
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
    const runtimeModelPolicy = resolveRuntimeModelPolicy(
      resolved.modelPolicyRef,
    );
    const agenticLeadState =
      collaborativeTeam != null && member?.role === 'lead'
        ? await this.loadAgenticLeadState(collaborativeTeam, task)
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
    const teamRoster = projectTeamRoster(teamMembers);
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
    const turnPrompt =
      collaborativeTeam != null && member?.role === 'lead'
        ? await this.withAgenticLeadContext(
            resolved.turnPrompt,
            claim.run.id,
            task.id,
            collaborativeTeam,
            task,
            agenticLeadState,
            runtimeToolRefs,
            teamMembers,
          )
        : resolved.turnPrompt;
    const guidedTurnPrompt =
      member?.role === 'lead'
        ? turnPrompt
        : appendTeamTurnGuidance(turnPrompt, task.teamTaskKind);
    const systemPrompt =
      !priorProviderAgentId && collaborativeTeam && member
        ? buildTeamSystemPrompt({
            role: member.role,
            roster: teamRoster,
            staticText: [
              resolved.systemPrompt,
              ...(member.role === 'lead' ? [TEAM_LEAD_CONTROL_PROTOCOL] : []),
            ].join('\n\n'),
          })
        : !priorProviderAgentId
          ? resolved.systemPrompt
          : '';
    const deliveredTurnPrompt =
      collaborativeTeam && member?.role === 'lead'
        ? formatTeamDeliveryPrompt({
            teamId: collaborativeTeam.id.slice(0, 8),
            to: member.name,
            kind: 'lead_turn',
            from: 'agent-server',
            sequence: requirePositiveTeamSequence(task.teamSequence),
            body: guidedTurnPrompt,
          })
        : guidedTurnPrompt;
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
                member?.role === 'lead' ? leadCatalogToolRefs : runtimeToolRefs,
            })
          : null;
      if (!sessionRuntime)
        throw new Error('Team member runtime session unavailable.');
      createdRuntimeSession = true;
    }
    if (
      createdRuntimeSession &&
      (!sessionRuntime ||
        sessionRuntime.scopeKind !== 'team_member' ||
        sessionRuntime.scopeId !== member?.id ||
        sessionRuntime.taskId !== task.id ||
        sessionRuntime.workspaceId !== task.workspaceId ||
        sessionRuntime.agentVersionId !== task.invokableVersionId ||
        sessionRuntime.environmentVersionId !==
          collaborativeTeam?.environmentVersionId ||
        !sameToolRefs(
          sessionRuntime.toolRefs,
          member?.role === 'lead' ? leadCatalogToolRefs : runtimeToolRefs,
        ) ||
        sessionRuntime.providerAgentId !== null ||
        sessionRuntime.paseoWorkspaceId !== null)
    )
      throw new Error('New Team member runtime session is already bound.');
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
    let teamPaseoWorkspaceId: string | null = null;
    if (
      !priorProviderAgentId &&
      collaborativeTeam &&
      member &&
      sessionRuntime
    ) {
      if (!this.runtimeSessions?.findPaseoWorkspaceByTeamRun)
        throw new Error('TeamRun Paseo Workspace lookup is unavailable.');
      teamPaseoWorkspaceId =
        await this.runtimeSessions.findPaseoWorkspaceByTeamRun({
          teamRunId: collaborativeTeam.id,
          tenantId: task.tenantId,
          workspaceId: task.workspaceId,
          principalType: task.principalType,
          principalId: task.principalId,
        });
      if (member.role !== 'lead' && !teamPaseoWorkspaceId)
        throw new Error('TeamRun Paseo Workspace is unavailable.');
    }
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
          ? { teamRunId: collaborativeTeam.id }
          : {}),
        ...(collaborativeTeam && member
          ? {
              contextEpoch: deriveTeamContextEpoch(task.id, claim.run.id),
            }
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
          refreshForTeamMember?: (input: {
            readonly grantId?: string;
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
          activeToolCalls?: (grantId: string) => number;
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
      priorProviderAgentId &&
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
      priorProviderAgentId &&
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
    let execution: Awaited<ReturnType<AgentRuntimePort['execute']>> | undefined;
    let executionFailed = false;
    let executionError: unknown;
    let providerBindingPersisted = false;
    const bindTeamProvider =
      collaborativeTeam &&
      sessionRuntime &&
      !sessionRuntime.providerAgentId &&
      this.runtimeSessions
        ? async (binding: {
            readonly providerAgentId: string;
            readonly paseoWorkspaceId: string;
          }) => {
            await this.runtimeSessions!.bindProvider({
              id: sessionRuntime.id,
              ...binding,
            });
            providerBindingPersisted = true;
          }
        : undefined;
    try {
      execution = await this.runtime.execute(
        priorProviderAgentId
          ? {
              operation: 'continue',
              ...(sessionRuntime?.paseoWorkspaceId
                ? { paseoWorkspaceId: sessionRuntime.paseoWorkspaceId }
                : {}),
              ...(sessionRuntime
                ? { runtimeSessionId: sessionRuntime.id }
                : {}),
              ...(cellCwd ? { cellCwd } : {}),
              runId: claim.run.id,
              prompt: deliveredTurnPrompt,
              providerAgentId: priorProviderAgentId,
              ...(resolved.proposalLimit > 0
                ? {
                    memoryCandidates: { proposalLimit: resolved.proposalLimit },
                  }
                : {}),
            }
          : {
              operation: 'create',
              ...(runtimeModelPolicy
                ? {
                    provider: runtimeModelPolicy.provider,
                    model: runtimeModelPolicy.model,
                  }
                : {}),
              ...(sessionRuntime
                ? { runtimeSessionId: sessionRuntime.id }
                : {}),
              ...(teamPaseoWorkspaceId
                ? { paseoWorkspaceId: teamPaseoWorkspaceId }
                : {}),
              ...(cellCwd ? { cellCwd } : {}),
              ...(collaborativeTeam
                ? {
                    workspaceTitle: `Team ${collaborativeTeam.id.slice(0, 8)}`,
                  }
                : {}),
              ...(member
                ? {
                    agentTitle: `${member.name} (${member.role})`,
                    agentLabels: {
                      team_run_id: member.teamRunId,
                      member_name: member.name,
                      role: member.role,
                    },
                  }
                : {}),
              ...(bindTeamProvider
                ? { onProviderBinding: bindTeamProvider }
                : {}),
              runId: claim.run.id,
              prompt: deliveredTurnPrompt,
              systemPrompt,
              ...(extensions ? { extensions } : {}),
              ...(resolved.proposalLimit > 0
                ? {
                    memoryCandidates: { proposalLimit: resolved.proposalLimit },
                  }
                : {}),
            },
        runtimeEventSink,
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
    if (
      sessionRuntime &&
      !sessionRuntime.providerAgentId &&
      execution.paseoWorkspaceId &&
      !providerBindingPersisted
    ) {
      const binding = {
        paseoWorkspaceId: execution.paseoWorkspaceId,
        providerAgentId: execution.providerAgentId,
      };
      if (bindTeamProvider) await bindTeamProvider(binding);
      else
        await this.runtimeSessions!.bindProvider({
          id: sessionRuntime.id,
          ...binding,
        });
    }
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

  private async acquireTeamMemberMutex(
    teamMemberRunId: string,
  ): Promise<() => void> {
    let entry = this.teamMemberMutexes.get(teamMemberRunId);
    if (!entry) {
      entry = { tail: Promise.resolve(), queued: 0 };
      this.teamMemberMutexes.set(teamMemberRunId, entry);
    }
    const prior = entry.tail;
    let releaseWaiter!: () => void;
    const current = new Promise<void>((resolve) => {
      releaseWaiter = resolve;
    });
    entry.tail = current;
    entry.queued += 1;
    await prior;
    entry.queued -= 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      releaseWaiter();
      if (entry && entry.tail === current && entry.queued === 0)
        this.teamMemberMutexes.delete(teamMemberRunId);
    };
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
    readonly modelPolicyRef: ResolvedAgentVersion['modelPolicyRef'];
    readonly skills: readonly ResolvedSkillPackage[];
    readonly toolRefs: readonly string[];
  }> {
    if (invokableVersionId === RUN_API_COMPATIBILITY_INVOKABLE_VERSION_ID) {
      return {
        systemPrompt: buildBootstrapPrompt(),
        turnPrompt: prompt,
        proposalLimit: 0,
        agentVersionId: invokableVersionId,
        modelPolicyRef: 'free-only',
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
      modelPolicyRef: agentVersion.modelPolicyRef,
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
    readonly modelPolicyRef: ResolvedAgentVersion['modelPolicyRef'];
    readonly skills: readonly ResolvedSkillPackage[];
    readonly toolRefs: readonly string[];
  }> {
    const metadata =
      invokableVersionId === RUN_API_COMPATIBILITY_INVOKABLE_VERSION_ID
        ? { proposalLimit: 0, modelPolicyRef: 'free-only' as const }
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
      modelPolicyRef: metadata.modelPolicyRef,
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
    return `${prompt}

Permanent coordination rules are in the create-time system instructions. Only values returned by agent-server MCP tools are authoritative for the current control cycle.

Lead turn guidance: use canonical Team tools and published Lead domain tools, never internal IDs, and make all current coordination decisions in this turn without waiting for members.

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
const runtimeMcpToolPrefix = `${AGENT_SERVER_RUNTIME_MCP_SERVER_NAME}_`;

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
