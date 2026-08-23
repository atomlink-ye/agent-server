import {
  transitionRun,
  type Run,
  type RunFailure,
} from '../../domain/runs/run.js';
import { transitionTask, type Task } from '../../domain/tasks/task.js';
import type { Logger } from '../../shared/observability/logger.js';
import type { AgentResolutionApi } from '../ports/agent-resolution-api.js';
import type { DefinitionReadApi } from '../ports/definition-read-api.js';
import type { FileStore } from '../ports/file-store.js';
import type { MemoryVersionReadApi } from '../ports/memory-version-read-api.js';
import type { RunEventRepository } from '../ports/run-events.js';
import {
  RunCompletionConflictError,
  type ClaimedRun,
  type RunRepository,
} from '../ports/run-repository.js';
import type { SessionRepository } from '../ports/session-repository.js';
import type { TaskRepository } from '../ports/task-repository.js';
import type { EnvironmentReadApi } from '../ports/environment-read-api.js';
import type { TeamExecutionRepository } from '../ports/team-execution-repository.js';
import type { WorkRunResourceManifestRead } from '../ports/work-run-resource-manifest-read.js';
import type { CreateMemoryProposal } from '../memory/create-memory-proposal.js';
import { RuntimeTimedOutError } from '../runtime/execution-runtime-errors.js';
import { RuntimeTurnExecutionError } from '../runtime/execute-runtime-turn.js';
import type { RuntimeExecutionProvider } from '../ports/runtime-execution-provider.js';
import type { RuntimeSessionStore } from '../ports/runtime-session-store.js';
import type { ResolveRuntimeSessionSpec } from '../ports/resolve-runtime-session-spec.js';
import type { ExecuteRuntimeTurn } from '../runtime/execute-runtime-turn.js';
import { ExecuteTeamTask } from '../tasks/execute-team-task.js';
import type { CollaborationActivationReconciler } from '../collaboration/collaboration-activation-reconciler.js';
import { AgentRunExecutor } from './agent-run-executor.js';
import { CompleteRun } from './complete-run.js';
import { RunPromptContext } from './run-prompt-context.js';
import {
  RunTeamCoordinator,
  type RunTeamContext,
} from './run-team-coordinator.js';
import {
  createRuntimeExecutionReceipt,
  RunCompletionPersistenceError,
  RuntimeMemoryPersistenceError,
  RunPostPersistenceError,
} from './runtime-execution-receipt.js';
import { RuntimeMemoryProposalWriter } from './runtime-memory-proposal-writer.js';

/** Durable Run process manager. */
export interface ExecuteRunOptions {
  readonly completeRun: CompleteRun;
  readonly tasks: TaskRepository;
  readonly definitions: DefinitionReadApi;
  readonly executeTeamTask: ExecuteTeamTask;
  readonly runtimeProvider: Pick<RuntimeExecutionProvider, 'ensureReady'>;
  readonly runtimeTurns: Pick<ExecuteRuntimeTurn, 'execute'>;
  readonly logger: Logger;
  readonly now?: () => Date;
  readonly resolver?: AgentResolutionApi;
  readonly events?: RunEventRepository;
  readonly fileStore?: FileStore;
  readonly createMemoryProposal?: CreateMemoryProposal;
  readonly runtimeSessions?: RuntimeSessionStore;
  readonly resolveRuntimeSpec?: ResolveRuntimeSessionSpec;
  readonly sessions?: Pick<SessionRepository, 'getSession'>;
  readonly environments?: EnvironmentReadApi;
  readonly runtimeCellRoot?: string;
  readonly collaborativeExecutions?: TeamExecutionRepository;
  readonly runs?: Pick<RunRepository, 'findByIdForOwner'>;
  readonly activationReconciler?: Pick<
    CollaborationActivationReconciler,
    'reconcileForRootTask'
  >;
  readonly workRunManifests?: WorkRunResourceManifestRead;
  readonly memoryVersions?: MemoryVersionReadApi;
}

export class ExecuteRun {
  private readonly completeRun: CompleteRun;
  private readonly tasks: TaskRepository;
  private readonly executeTeamTask: ExecuteTeamTask;
  private readonly runtimeProvider: Pick<
    RuntimeExecutionProvider,
    'ensureReady'
  >;
  private readonly logger: Logger;
  private readonly now: () => Date;
  private readonly events: RunEventRepository | undefined;
  private readonly teamCoordinator: RunTeamCoordinator | undefined;
  private readonly agentRunExecutor: AgentRunExecutor;

  public constructor(options: ExecuteRunOptions) {
    const {
      completeRun,
      tasks,
      executeTeamTask,
      runtimeProvider,
      runtimeTurns,
      logger,
      now = () => new Date(),
      resolver = { resolvePublished: async () => null },
      events,
      fileStore,
      createMemoryProposal,
      runtimeSessions,
      resolveRuntimeSpec,
      sessions,
      environments,
      runtimeCellRoot,
      collaborativeExecutions,
      runs,
      activationReconciler,
      workRunManifests,
      memoryVersions,
    } = options;
    this.completeRun = completeRun;
    this.tasks = tasks;
    this.executeTeamTask = executeTeamTask;
    this.runtimeProvider = runtimeProvider;
    this.logger = logger;
    this.now = now;
    this.events = events;
    this.teamCoordinator = collaborativeExecutions
      ? new RunTeamCoordinator(
          collaborativeExecutions,
          tasks,
          activationReconciler,
        )
      : undefined;
    const promptContext = new RunPromptContext(
      resolver,
      tasks,
      fileStore,
      collaborativeExecutions,
    );
    const memoryWriter = new RuntimeMemoryProposalWriter(
      createMemoryProposal,
      logger,
      this.now,
    );
    const compositionReads = environments as
      | (EnvironmentReadApi & {
          readonly workRunManifests?: WorkRunResourceManifestRead;
          readonly memoryVersions?: MemoryVersionReadApi;
        })
      | undefined;
    this.agentRunExecutor = new AgentRunExecutor(
      runtimeTurns,
      tasks,
      promptContext,
      memoryWriter,
      logger,
      events,
      runtimeSessions,
      resolveRuntimeSpec,
      sessions,
      environments,
      runtimeCellRoot,
      collaborativeExecutions,
      runs,
      workRunManifests ?? compositionReads?.workRunManifests,
      memoryVersions ?? compositionReads?.memoryVersions,
      this.now,
    );
  }

  public async ensureRuntimeReady(): Promise<boolean> {
    try {
      return await this.runtimeProvider.ensureReady();
    } catch (error) {
      this.logger.log('warn', 'run.runtime.unavailable', {
        error_name: error instanceof Error ? error.name : 'UnknownError',
      });
      return false;
    }
  }

  public async execute(claim: ClaimedRun) {
    if (this.teamCoordinator) {
      const task = await this.tasks.findById(claim.taskId);
      const memberId = task?.teamMemberRunId;
      if (memberId)
        return this.teamCoordinator.runExclusive(memberId, () =>
          this.executeUnlocked(claim),
        );
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
    let teamContext: RunTeamContext | null = null;
    let task: Task | null | undefined;
    try {
      task = await this.tasks.findById(claim.taskId);
      if (!task)
        throw new Error(
          `Task ${claim.taskId} could not be loaded for execution`,
        );
      if (
        ['lead_turn', 'work_attempt', 'direct_message'].includes(
          task.teamTaskKind ?? '',
        ) &&
        !task.teamMemberRunId
      )
        throw new Error('Team task is missing member identity.');
      if (task.teamMemberRunId && !this.teamCoordinator)
        throw new Error('Team member task requires TeamRun execution.');

      teamContext = this.teamCoordinator
        ? await this.teamCoordinator.resolve(task)
        : null;
      await this.events?.append(claim.run.id, 'started', {});
      if (teamContext) await this.teamCoordinator!.markActive(teamContext);
      await this.events?.bind({
        runId: claim.run.id,
        ...(task.sessionId ? { sessionId: task.sessionId } : {}),
        createdAt: claim.run.updatedAt,
      });
      if (task.status === 'queued')
        await this.tasks.save(
          transitionTask(task, 'active', () => new Date(claim.run.updatedAt)),
        );

      const terminalRun =
        task.invokableKind === 'team'
          ? await this.executeTeamTask.execute({ claim, task })
          : await this.agentRunExecutor.execute({
              claim,
              ownerScope: {
                tenantId: task.tenantId,
                workspaceId: task.workspaceId,
                principalType: task.principalType,
                principalId: task.principalId,
              },
              invokableVersionId: task.invokableVersionId,
              task,
              teamContext,
            });
      completed =
        terminalRun.status === 'waiting_children'
          ? terminalRun
          : await this.completeTerminalRun(claim, terminalRun);
      if (teamContext && terminalRun.status !== 'waiting_children')
        await this.teamCoordinator!.updateTerminal({
          claimTaskId: claim.taskId,
          task,
          context: teamContext,
          fallbackStatus: completed.status === 'succeeded' ? 'idle' : 'failed',
        });
      if (teamContext) await this.teamCoordinator!.reconcile(teamContext);
    } catch (error) {
      if (error instanceof RunCompletionConflictError) throw error;
      if (error instanceof RunCompletionPersistenceError) {
        await this.teamCoordinator?.updateTerminalBestEffort({
          claimTaskId: claim.taskId,
          task,
          context: teamContext,
          fallbackStatus: 'failed',
        });
        this.reportCompletionPersistenceFailure(error.receipt);
        throw error;
      }
      if (error instanceof RunPostPersistenceError) {
        await this.teamCoordinator?.updateTerminalBestEffort({
          claimTaskId: claim.taskId,
          task,
          context: teamContext,
          fallbackStatus:
            error.details.terminalStatus === 'succeeded' ? 'idle' : 'failed',
        });
        this.reportPostPersistenceFailure(error);
        throw error;
      }
      await this.teamCoordinator?.updateTerminalBestEffort({
        claimTaskId: claim.taskId,
        task,
        context: teamContext,
        fallbackStatus: 'failed',
      });
      if (error instanceof RuntimeMemoryPersistenceError) {
        this.logger.log('error', 'run.memory_persistence_failed', {
          run_id: error.receipt.runId,
          terminal_status: error.receipt.terminalStatus,
          result_available: error.receipt.resultAvailable,
        });
        throw error;
      }
      const timedOut =
        error instanceof RuntimeTimedOutError ||
        (error instanceof RuntimeTurnExecutionError &&
          error.code === 'runtime_turn_timed_out');
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
        { error: failure },
        this.now,
      );
      try {
        completed = await this.completeTerminalRun(claim, failed);
      } catch (completionError) {
        if (completionError instanceof RunCompletionPersistenceError)
          this.reportCompletionPersistenceFailure(completionError.receipt);
        if (completionError instanceof RunPostPersistenceError)
          this.reportPostPersistenceFailure(completionError);
        throw completionError;
      }
    }
    this.reportCompletedRun(claim, completed);
    return completed;
  }

  private async completeTerminalRun(claim: ClaimedRun, run: Run) {
    return this.completeRun.execute({ claim, run });
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
}
