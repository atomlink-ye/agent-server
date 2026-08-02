import {
  transitionRun,
  type Run,
  type RunFailure,
} from '../../domain/runs/run.js';
import { RUN_API_COMPATIBILITY_INVOKABLE_VERSION_ID } from '../../domain/tasks/compatibility-invokable-version.js';
import { transitionTask } from '../../domain/tasks/task.js';
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
import type { ClaimedRun } from '../ports/run-repository.js';
import type { TaskRepository } from '../ports/task-repository.js';
import type { RunEventRepository } from '../ports/run-events.js';
import type { FileStore } from '../ports/file-store.js';
import type { CreateMemoryProposal } from '../memory/create-memory-proposal.js';
import {
  buildBootstrapPrompt,
  buildTurnPrompt,
} from '../context/runtime-prompts.js';
import { ExecuteTeamTask } from '../tasks/execute-team-task.js';
import { AGENT_SERVER_TEAM_TOOL_REFS } from '../agents/built-in-skills.js';
import type { RuntimeExtensionBinder } from '../extensions/runtime-extension-binder.js';
import type { ResolvedSkillPackage } from '../extensions/skill-catalog.js';
import type { RuntimeSessionRepository } from '../ports/runtime-session-repository.js';
import type { SessionRepository } from '../ports/session-repository.js';
import type { EnvironmentRegistry } from '../ports/environment-registry.js';
import type { DagTeamExecutionRepository } from '../ports/team-execution-repository.js';
import type { TeamExecutionRepository } from '../ports/team-execution-repository.js';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { CompleteRun } from './complete-run.js';
import {
  createRuntimeExecutionReceipt,
  RunCompletionPersistenceError,
  RuntimeMemoryPersistenceError,
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

    try {
      await this.events?.append(claim.run.id, 'started', {});
      const task = await this.tasks.findById(claim.taskId);
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
      if (memberRunId && memberOwner)
        await this.collaborativeExecutions!.updateMemberRunStatus(
          memberRunId,
          'idle',
          undefined,
          memberOwner,
        );
    } catch (error) {
      if (memberRunId && memberOwner)
        await this.collaborativeExecutions!.updateMemberRunStatus(
          memberRunId,
          'failed',
          undefined,
          memberOwner,
        ).catch(() => undefined);
      if (error instanceof RunCompletionPersistenceError) {
        this.reportCompletionPersistenceFailure(error.receipt);
        throw error;
      }
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
    let completed: Awaited<ReturnType<CompleteRun['execute']>>;
    try {
      completed = await this.completeRun.execute({ claim, run });
    } catch (error) {
      const receipt = createRuntimeExecutionReceipt(run, claim.taskId);
      throw new RunCompletionPersistenceError(receipt);
    }

    return completed;
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
        : member && !leadFinalization && this.runtimeSessions?.findByTeamMember
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
    const runtimeToolRefs =
      collaborativeTeam?.executionMode === 'agentic_mve' &&
      task.teamTaskKind === 'work_attempt'
        ? []
        : collaborativeTeam?.executionMode === 'agentic_mve' &&
            member?.role === 'lead'
          ? AGENT_SERVER_TEAM_TOOL_REFS.slice(6)
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
          )
        : resolved.turnPrompt;
    const systemPrompt =
      collaborativeTeam?.executionMode === 'agentic_mve' &&
      task.teamTaskKind === 'work_attempt'
        ? `${resolved.systemPrompt}\n\nThis is an assigned Agentic Team WorkItemAttempt with controller-provided evidence in the user turn. Do not claim or update WorkItems. Do not use any tool, subagent, shell, search, read, write, edit, fetch, legacy team tool, or Team mutation tool. Return a plain-text evidence report using only the provided evidence and immediately end the turn.`
        : collaborativeTeam?.executionMode === 'agentic_mve' &&
            member?.role === 'lead'
          ? `${resolved.systemPrompt}\n\nAgentic Team policy: this Lead turn is tool-controlled. Never use shell, filesystem, or legacy team_task_* tools. Use only the four agentic Team MCP tools named in the task instructions; if information is unavailable, issue no command rather than substituting a shell command. Each Lead turn performs one current decision only. After calling any mutating Team command (assign, accept, rework, or completion request), immediately return a short decision text; do not call another tool, shell, or wait for a member in the same turn.`
          : resolved.systemPrompt;
    let sessionRuntime = runtimeSession;
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
        ...(!task.sessionId ? { scopeId: member?.id ?? task.id } : {}),
        taskId: task.id,
        runId: claim.run.id,
        ...(member?.id ? { teamMemberRunId: member.id } : {}),
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
        })
      | undefined;
    if (
      priorProviderAgentId &&
      sessionRuntime &&
      sessionRuntime.toolRefs.length > 0 &&
      refreshableBinder?.refreshForSession
    )
      refreshableBinder.refreshForSession(
        task.sessionId ?? member?.id ?? task.id,
        sessionRuntime.toolRefs,
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
      .map((member) => `${member.id} (${member.name})`)
      .join(', ');
    const workItems = this.collaborativeExecutions
      ? await this.collaborativeExecutions.findWorkItemsByTeamRunId(team.id, {
          tenantId: task.tenantId,
          workspaceId: task.workspaceId,
          principalType: task.principalType,
          principalId: task.principalId,
        })
      : [];
    const attempts = this.collaborativeExecutions
      ? await this.collaborativeExecutions.findAttemptsByTeamRunId(team.id, {
          tenantId: task.tenantId,
          workspaceId: task.workspaceId,
          principalType: task.principalType,
          principalId: task.principalId,
        })
      : [];
    const snapshot = JSON.stringify({
      work_items: workItems.slice(0, 16).map((item) => ({
        id: item.id,
        subject: safeAgenticLeadSnapshotText(item.subject),
        status: item.status,
      })),
      attempts: attempts.slice(0, 32).map((attempt) => ({
        work_item_id: attempt.workItemId,
        attempt_no: attempt.attemptNo,
        assignee_member_id: attempt.assigneeMemberId,
        status: attempt.status,
        result_summary: safeAgenticLeadSnapshotText(attempt.resultSummary),
        feedback: safeAgenticLeadSnapshotText(attempt.feedback),
      })),
    });
    return `${prompt}

Agentic Team control protocol (authoritative for this turn): do not use the legacy team_task_* tools or shell commands. This turn may issue exactly one mutating Agentic command: team_work_create_and_assign OR team_work_request_rework OR team_work_accept OR team_completion_request. Use the current snapshot to choose: missing evidence means request_rework; a latest completed, qualifying attempt means accept; all work items accepted means request completion. Every command must use these exact values: team_run_id=${team.id}, source_run_id=${sourceRunId}, lead_task_id=${leadTaskId}, expected_revision=${team.revision}. The fixed member roster is: ${roster || 'none'}. Supply a fresh command_hash. After the command succeeds, immediately return a short decision text and end this turn; do not wait for members, call another tool, use shell, or inspect files. Do not call team_complete.

Current WorkItem/Attempt snapshot (bounded, control-plane fields only): ${snapshot}`;
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
