import type { ExecuteTeamTask } from '../application/tasks/execute-team-task.js';
import type { TeamDriver } from '../application/teams/team-driver.js';
import type { PostgresRunDispatcher } from '../infrastructure/postgres/postgres-run-dispatcher.js';
import type { PublishMemoryReviewSurface } from '../application/channels/publish-memory-review-surface.js';
import type { Logger } from '../shared/observability/logger.js';
import {
  createCompleteRunConsumer,
  createRunDispatcher,
  createRunExecutionConsumer,
} from './create-execution-consumers.js';
import type { KernelCapabilities } from './create-kernel-capabilities.js';
import type { MemoryModule } from './create-memory-capabilities.js';
import type { ResourceModule } from './create-resource-capabilities.js';
import type { RuntimeOwner } from './create-runtime-owner.js';
import type { TeamCapabilities } from './create-team-capabilities.js';

export interface RunExecutionComposition {
  readonly executeRun: ReturnType<typeof createRunExecutionConsumer>;
  readonly dispatcher: PostgresRunDispatcher;
}

export function createRunExecutionComposition(input: {
  readonly kernel: Pick<
    KernelCapabilities,
    'runRepository' | 'taskRepository' | 'events' | 'sessions'
  >;
  readonly team: Pick<TeamCapabilities, 'executions' | 'activationReconciler'>;
  readonly teamDriver: TeamDriver;
  readonly executeTeamTask: ExecuteTeamTask;
  readonly resources: Pick<
    ResourceModule,
    | 'definitionReadApi'
    | 'agentResolutionApi'
    | 'workerResolutionApi'
    | 'environmentReadApi'
  >;
  readonly runtime: Pick<
    RuntimeOwner,
    | 'runtimeProvider'
    | 'executeRuntimeTurn'
    | 'runtimeSessions'
    | 'ensureDesiredRuntimeSpec'
    | 'chatRuntime'
  >;
  readonly memory: Pick<
    MemoryModule,
    // `logicalFiles` is the same store the ContextFS read routes serve, so a
    // WorkRun result written here is the file the Files surface then lists.
    'fileStore' | 'createMemoryProposal' | 'logicalFiles'
  >;
  readonly memoryReviewSurface?: Pick<PublishMemoryReviewSurface, 'execute'>;
  readonly memoryReviewNotifier?: Pick<PublishMemoryReviewSurface, 'execute'>;
  readonly terminalActivationReconciler?: TeamCapabilities['activationReconciler'];
  readonly workerId: string;
  readonly leaseDurationMs: number;
  readonly concurrency: number;
  readonly logger: Logger;
}): RunExecutionComposition {
  const memoryReviewSurface = input.memoryReviewSurface;
  const memoryReviewNotifier = input.memoryReviewNotifier;
  const completeRun = createCompleteRunConsumer(
    input.kernel.runRepository,
    input.kernel.taskRepository,
    input.kernel.events,
    input.kernel.sessions,
    memoryReviewSurface
      ? {
          notifySucceeded: (completion) =>
            memoryReviewSurface.execute(completion),
        }
      : memoryReviewNotifier
        ? {
            notifySucceeded: (completion) =>
              memoryReviewNotifier.execute(completion),
          }
        : undefined,
    {
      handleTerminalRun: async ({ run, task }) => {
        const team = await input.team.executions.findTeamRunByRootTaskId(
          task.rootTaskId,
          {
            tenantId: task.tenantId,
            workspaceId: task.workspaceId,
            principalType: task.principalType,
            principalId: task.principalId,
          },
        );
        if (team) await input.teamDriver.handleTerminalRun({ team, task, run });
      },
    },
  );
  const executeRun = createRunExecutionConsumer({
    completeRun,
    tasks: input.kernel.taskRepository,
    definitions: input.resources.definitionReadApi,
    executeTeamTask: input.executeTeamTask,
    runtimeTurns: input.runtime.executeRuntimeTurn,
    runtimeProvider: input.runtime.runtimeProvider,
    logger: input.logger,
    resolver: input.resources.agentResolutionApi,
    workerResolver: input.resources.workerResolutionApi,
    events: input.kernel.events,
    fileStore: input.memory.fileStore,
    contextFiles: input.memory.logicalFiles,
    createMemoryProposal: input.memory.createMemoryProposal,
    sessions: input.kernel.sessions,
    runtimeSessions: input.runtime.runtimeSessions,
    ensureDesiredRuntimeSpec: input.runtime.ensureDesiredRuntimeSpec,
    runtimeConfiguration: input.runtime.chatRuntime.configuration,
    environments: input.resources.environmentReadApi,
    collaborativeExecutions: input.team.executions,
    runs: input.kernel.runRepository,
    ...(input.terminalActivationReconciler
      ? { activationReconciler: input.terminalActivationReconciler }
      : {}),
  });
  const dispatcher = createRunDispatcher({
    runs: input.kernel.runRepository,
    executeRun,
    workerId: input.workerId,
    leaseDurationMs: input.leaseDurationMs,
    logger: input.logger,
    concurrency: input.concurrency,
    onIdleMaintenance: async () => {
      try {
        const recovered =
          (await input.kernel.runRepository.recoverExpiredRuns?.(
            new Date().toISOString(),
          )) ?? [];
        for (const item of recovered) {
          input.logger.log('warn', 'run.recovery.fail_closed', {
            run_id: item.runId,
            task_id: item.taskId,
          });
        }
      } catch (error) {
        input.logger.log('error', 'run.recovery.fail_closed_failed', {
          error_name: error instanceof Error ? error.name : 'UnknownError',
        });
      }
      try {
        const recovered = await input.team.executions.recoverExpiredTeamRuns(
          new Date().toISOString(),
        );
        for (const item of recovered) {
          input.logger.log('warn', 'team.recovery.fail_closed', {
            team_run_id: item.teamRunId,
            child_run_id: item.childRunId,
            team_task_kind: item.teamTaskKind,
            affected_child_run_count: item.affectedChildRunCount,
          });
        }
      } catch (error) {
        input.logger.log('error', 'team.recovery.fail_closed_failed', {
          error_name: error instanceof Error ? error.name : 'UnknownError',
        });
      }
      try {
        await input.team.activationReconciler.reconcilePendingRoots();
      } catch (error) {
        input.logger.log('error', 'team.wake_reconcile_failed', {
          error_name: error instanceof Error ? error.name : 'UnknownError',
        });
      }
    },
  });
  return { executeRun, dispatcher };
}
