import type { Pool } from 'pg';

import type { AppConfig } from '../shared/config.js';
import type { Logger } from '../shared/observability/logger.js';
import { RuntimeReadinessProbe } from '../application/health/readiness.js';
import type { AppDependencies } from '../entrypoints/api/app.js';
import { createHttpApp } from '../entrypoints/api/app.js';
import type { TeamDriver } from '../application/teams/team-driver.js';
import type { RuntimeOwner } from './create-runtime-owner.js';
import type { KernelCapabilities } from './create-kernel-capabilities.js';
import type { MemoryModule } from './create-memory-capabilities.js';
import type { ResourceModule } from './create-resource-capabilities.js';
import type { WorkModule } from './create-work-capabilities.js';
import type { WorkOrganizationModule } from './create-work-organization-capabilities.js';
import type { ChannelComposition } from './create-channel-composition.js';
import type { TeamCapabilities } from './create-team-capabilities.js';
import { createApplicationLifecycle } from './create-application-lifecycle.js';
import { createWorkers, type WorkerSet } from './create-workers.js';
import type { PostgresRunDispatcher } from '../infrastructure/postgres/postgres-run-dispatcher.js';

export interface HostCompositionInput {
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly kernel: KernelCapabilities;
  readonly team: TeamCapabilities;
  readonly teamDriver: Pick<TeamDriver, 'decideCompletion'>;
  readonly taskConsumers: Pick<
    AppDependencies,
    'cancelTask' | 'getTask' | 'getTaskTree'
  >;
  readonly memory: MemoryModule;
  readonly resources: ResourceModule;
  readonly workModule?: Pick<WorkModule, 'installHttp'>;
  readonly workOrganizationModule?: Pick<WorkOrganizationModule, 'installHttp'>;
  readonly channels: Pick<ChannelComposition, 'workers'>;
  readonly chatWorker?: WorkerSet['chatWorker'];
  readonly workChatWorker?: WorkerSet['workChatWorker'];
  readonly runtime: Pick<RuntimeOwner, 'runtimeProvider' | 'runtimeMcpServer'>;
  readonly dispatcher: PostgresRunDispatcher;
  readonly pool: Pick<Pool, 'end'>;
  readonly activationReconciler: Pick<
    TeamCapabilities['activationReconciler'],
    'reconcilePendingRoots'
  >;
  readonly singleRunDebug?: boolean;
}

/** Composes host-facing HTTP, workers, and process lifecycle around capabilities. */
export async function createHostComposition(input: HostCompositionInput) {
  const app = createHttpApp({
    config: input.config,
    logger: input.logger,
    readiness: new RuntimeReadinessProbe({
      health: () => input.runtime.runtimeProvider.health(),
    }),
    runtime: input.runtime.runtimeProvider,
    submitRun: input.kernel.submitRun,
    getRun: input.kernel.getRun,
    invokeTask: input.kernel.invokeTask,
    getTask: input.taskConsumers.getTask,
    getTaskTree: input.taskConsumers.getTaskTree,
    teamExecutions: input.team.executions,
    teamDriver: input.teamDriver,
    teamMessages: input.team.messages,
    tasks: input.kernel.taskRepository,
    sessions: input.kernel.sessions,
    ...(input.kernel.conversations
      ? { conversations: input.kernel.conversations }
      : {}),
    ...(input.kernel.chatDispatches
      ? { chatDispatches: input.kernel.chatDispatches }
      : {}),
    ...(input.kernel.conversationWorkEntitlements
      ? {
          conversationWorkEntitlements:
            input.kernel.conversationWorkEntitlements,
        }
      : {}),
    submitSessionTurn: input.kernel.submitSessionTurn,
    events: input.kernel.events,
    cancelTask: input.taskConsumers.cancelTask,
    ...(input.workModule ? { workModule: input.workModule } : {}),
    ...(input.workOrganizationModule
      ? { workOrganizationModule: input.workOrganizationModule }
      : {}),
    memoryModule: input.memory,
    resourceModule: input.resources,
  });
  const workers = createWorkers({
    ...input.channels.workers,
    ...(input.chatWorker ? { chatWorker: input.chatWorker } : {}),
    ...(input.workChatWorker ? { workChatWorker: input.workChatWorker } : {}),
  });
  const lifecycle = createApplicationLifecycle({
    dispatcher: input.dispatcher,
    workers,
    runtimeProvider: input.runtime.runtimeProvider,
    runtimeEnabled: input.config.runtime?.adapter === 'paseo',
    runtimeMcpServer: input.runtime.runtimeMcpServer,
    pool: input.pool,
  });

  if (!input.singleRunDebug) {
    await input.activationReconciler.reconcilePendingRoots();
    await lifecycle.start();
  }

  return {
    app,
    close: () => lifecycle.stop(),
  };
}
