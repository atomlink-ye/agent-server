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
import type { RuntimeExtensionBinder } from '../extensions/runtime-extension-binder.js';
import type { ResolvedSkillPackage } from '../extensions/skill-catalog.js';
import type { RuntimeSessionRepository } from '../ports/runtime-session-repository.js';
import type { SessionRepository } from '../ports/session-repository.js';
import type { EnvironmentRegistry } from '../ports/environment-registry.js';
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

    try {
      await this.events?.append(claim.run.id, 'started', {});
      const task = await this.tasks.findById(claim.taskId);
      if (!task) {
        throw new Error(
          `Task ${claim.taskId} could not be loaded for execution`,
        );
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

      completed = await this.completeTerminalRun(claim, terminalRun);
    } catch (error) {
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
    let sessionRuntime = runtimeSession;
    if (
      task.sessionId &&
      this.runtimeSessions &&
      !sessionRuntime &&
      productSession?.environmentVersionId != null
    ) {
      if (!this.environments)
        throw new Error(
          'Product Session runtime dependencies are unavailable.',
        );
      const environment = await this.environments.findVersion(
        {
          tenantId: task.tenantId,
          principalType: task.principalType,
          principalId: task.principalId,
        },
        productSession.environmentVersionId,
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
      sessionRuntime = await this.runtimeSessions.createOrGetForProductSession({
        productSessionId: task.sessionId,
        tenantId: task.tenantId,
        principalType: task.principalType,
        principalId: task.principalId,
        workspaceId: task.workspaceId,
        agentVersionId: resolved.agentVersionId,
        environmentVersionId: productSession.environmentVersionId,
        resolvedSkills: resolved.skills,
        toolRefs: resolved.toolRefs,
      });
    }
    const cellCwd =
      sessionRuntime && this.runtimeCellRoot
        ? join(this.runtimeCellRoot, sessionRuntime.id)
        : undefined;
    if (cellCwd) await mkdir(cellCwd, { recursive: true });
    let extensions;
    if (
      !priorProviderAgentId &&
      (resolved.skills.length > 0 || resolved.toolRefs.length > 0)
    ) {
      if (!this.runtimeExtensionBinder)
        throw new Error('Runtime extension binding is unavailable.');
      extensions = await this.runtimeExtensionBinder.bind({
        tenantId: task.tenantId,
        principalType: task.principalType,
        principalId: task.principalId,
        workspaceId: task.workspaceId,
        ...(task.sessionId ? { productSessionId: task.sessionId } : {}),
        skills: resolved.skills,
        toolRefs: resolved.toolRefs,
        ...(cellCwd ? { cellCwd } : {}),
      });
    }
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
            prompt: resolved.turnPrompt,
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
            prompt: resolved.turnPrompt,
            systemPrompt: resolved.systemPrompt,
            ...(extensions ? { extensions } : {}),
            ...(resolved.proposalLimit > 0
              ? { memoryCandidates: { proposalLimit: resolved.proposalLimit } }
              : {}),
          },
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
