import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import { Hono } from 'hono';

import type { ReadinessProbe } from '../../application/health/readiness.js';
import type { ExecutionRuntimeService } from '../../application/runtime/execution-plane-runtime-facade.js';
import type { GetRun } from '../../application/runs/get-run.js';
import type { SubmitRun } from '../../application/runs/submit-run.js';
import type { GetTask } from '../../application/tasks/get-task.js';
import type { GetTaskTree } from '../../application/tasks/get-task-tree.js';
import type { InvokeTask } from '../../application/tasks/invoke-task.js';
import { HttpError, type ErrorResponse } from '../../contracts/http.js';
import type { AppConfig } from '../../shared/config.js';
import type { Logger } from '../../shared/observability/logger.js';
import type { ApiEnvironment } from '../../platform/http-types.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerRunRoutes } from './routes/runs.js';
import { registerTaskRoutes } from './routes/tasks.js';
import type { SessionRepository } from '../../application/ports/session-repository.js';
import type { SubmitSessionTurn } from '../../application/sessions/submit-session-turn.js';
import type { RunEventRepository } from '../../application/ports/run-events.js';
import type { CancelTask } from '../../application/tasks/cancel-task.js';
import { registerSessionRoutes } from './routes/sessions.js';
import type { TeamExecutionRepository } from '../../application/ports/team-execution-repository.js';
import type { TeamMessageRepository } from '../../application/ports/team-message-repository.js';
import type { TaskRepository } from '../../application/ports/task-repository.js';
import { registerTeamRunRoutes } from './routes/team-runs.js';
import { registerCollaborationRunRoutes } from './routes/collaboration-runs.js';
import { ProjectAgenticTeam } from '../../application/teams/project-agentic-team.js';
import type { TeamDriver } from '../../application/teams/team-driver.js';
import type { WorkModule } from '../../modules/work/work-module.js';
import type { MemoryModule } from '../../modules/memory/memory-module.js';
import type { ResourceModule } from '../../modules/resource/resource-module.js';
import {
  composePlatform,
  type PlatformContribution,
  type PlatformHttpInstaller,
  type PlatformRuntimeRegistry,
} from '../../platform/composition-shell.js';
import { requireServiceAccountAccess } from './authentication.js';
import { getAuthenticatedAccessContext } from '../../platform/access-context.js';
import { ServiceAccountAuthenticator } from '../../application/control-plane/service-account-authenticator.js';
import type { ConversationRepository } from '../../application/ports/conversation-repository.js';
import type { ChatDispatchRepository } from '../../application/ports/chat-dispatch-repository.js';
import type { ConversationWorkEntitlementRepository } from '../../application/ports/conversation-work-entitlement-repository.js';
import { registerConversationRoutes } from './routes/conversations.js';

export interface AppDependencies {
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly readiness: ReadinessProbe;
  readonly runtime: ExecutionRuntimeService;
  readonly submitRun: SubmitRun;
  readonly getRun: GetRun;
  readonly invokeTask: InvokeTask;
  readonly getTask: GetTask;
  readonly getTaskTree: GetTaskTree;
  readonly teamExecutions: TeamExecutionRepository;
  readonly teamDriver: Pick<TeamDriver, 'decideCompletion'>;
  readonly teamMessages: TeamMessageRepository;
  readonly tasks: TaskRepository;
  readonly sessions: SessionRepository;
  readonly conversations?: ConversationRepository;
  readonly chatDispatches?: ChatDispatchRepository;
  readonly conversationWorkEntitlements?: ConversationWorkEntitlementRepository;
  readonly submitSessionTurn: SubmitSessionTurn;
  readonly events: RunEventRepository;
  readonly cancelTask: CancelTask;
  readonly version?: string;
  readonly workModule?: Pick<WorkModule, 'installHttp'>;
  readonly memoryModule: Pick<MemoryModule, 'installHttp'>;
  readonly resourceModule: Pick<
    ResourceModule,
    'installHttp' | 'managedAgentDefinitions'
  >;
  readonly installPlatformHttp?: PlatformHttpInstaller;
}

export function createApp(dependencies: AppDependencies): Hono<ApiEnvironment> {
  const app = new Hono<ApiEnvironment>();
  const version = dependencies.version ?? '0.1.0';
  // These declarations gate only the Direct Chat/Product Work composition.
  // Generic /runs, /tasks, Sessions, and Team execution remain composed below.
  const directChatPlane = dependencies.config.directChatPlane;
  const productWorkPlane = dependencies.config.productWorkPlane;

  app.use('*', async (context, next) => {
    const requestId = context.req.header('x-request-id') ?? randomUUID();
    const startedAt = performance.now();
    context.set('requestId', requestId);
    context.set('accessContext', null);
    context.header('x-request-id', requestId);

    await next();

    dependencies.logger.log('info', 'http.request.completed', {
      request_id: requestId,
      method: context.req.method,
      path: context.req.path,
      status: context.res.status,
      duration_ms: Math.round((performance.now() - startedAt) * 100) / 100,
    });
  });

  registerHealthRoutes(app, {
    config: dependencies.config,
    readiness: dependencies.readiness,
    version,
  });
  const platformAuthenticator = new ServiceAccountAuthenticator(
    dependencies.config.serviceAccounts ?? [],
  );
  dependencies.installPlatformHttp?.(app, {
    logger: dependencies.logger,
    authenticate: requireServiceAccountAccess(platformAuthenticator),
    accessContext: getAuthenticatedAccessContext,
    safeError: errorResponse,
    notFound: (requestId) =>
      errorResponse(
        'route_not_found',
        'The requested route does not exist.',
        requestId,
      ),
  });
  registerRunRoutes(app, dependencies);
  registerTaskRoutes(app, dependencies);
  if (productWorkPlane !== 'absent')
    dependencies.workModule?.installHttp(app, dependencies.config, {
      teamDriver: dependencies.teamDriver,
      teamExecutions: dependencies.teamExecutions,
    });
  dependencies.memoryModule.installHttp(app, dependencies.config);
  dependencies.resourceModule.installHttp(app, dependencies.config);
  registerTeamRunRoutes(app, {
    config: dependencies.config,
    teamExecutions: dependencies.teamExecutions,
    projectAgenticTeam: new ProjectAgenticTeam(
      dependencies.teamExecutions,
      dependencies.teamMessages,
      dependencies.tasks,
    ),
    teamDriver: dependencies.teamDriver,
  });
  registerCollaborationRunRoutes(app, {
    config: dependencies.config,
    teamExecutions: dependencies.teamExecutions,
    teamMessages: dependencies.teamMessages,
  });
  registerSessionRoutes(app, {
    ...dependencies,
    sessions: dependencies.sessions,
    submitSessionTurn: dependencies.submitSessionTurn,
  });
  const managedAgentDefinitions =
    dependencies.resourceModule.managedAgentDefinitions;
  if (
    directChatPlane !== 'absent' &&
    dependencies.conversations &&
    dependencies.chatDispatches
  ) {
    if (!managedAgentDefinitions)
      throw new Error(
        'conversation_routes_require_managed_agent_definition_read',
      );
    registerConversationRoutes(app, {
      config: dependencies.config,
      conversations: dependencies.conversations,
      dispatches: dependencies.chatDispatches,
      managedAgentDefinitions,
      ...(productWorkPlane !== 'absent' &&
      dependencies.conversationWorkEntitlements
        ? { workEntitlements: dependencies.conversationWorkEntitlements }
        : {}),
    });
  }

  app.notFound((context) => {
    return context.json(
      errorResponse(
        'route_not_found',
        'The requested route does not exist.',
        context.get('requestId'),
      ),
      404,
    );
  });

  app.onError((error, context) => {
    const requestId = context.get('requestId');
    if (error instanceof HttpError) {
      return context.json(
        errorResponse(error.code, error.message, requestId),
        error.status,
      );
    }

    dependencies.logger.log('error', 'http.request.failed', {
      request_id: requestId,
      error_name: error.name,
    });
    return context.json(
      errorResponse(
        'internal_error',
        'The request could not be completed.',
        requestId,
      ),
      500,
    );
  });

  return app;
}

export function composePlatformApp(
  dependencies: Omit<AppDependencies, 'installPlatformHttp'>,
  contributions: readonly PlatformContribution[],
  runtimeRegistry: PlatformRuntimeRegistry,
  starts: readonly (() =>
    | void
    | (() => Promise<void> | void)
    | Promise<void | (() => Promise<void> | void)>)[] = [],
) {
  let shell: ReturnType<typeof composePlatform> | undefined;
  const app = createApp({
    ...dependencies,
    installPlatformHttp(hono, concerns) {
      shell = composePlatform(contributions, concerns, starts);
      shell.installHttp(hono);
    },
  });
  if (!shell) throw new Error('platform_shell_not_installed');
  const platform = shell;
  platform.contributeRuntime(runtimeRegistry);
  return {
    app,
    start: () => platform.start(),
    stop: () => platform.stop(),
  };
}

function errorResponse(
  code: string,
  message: string,
  requestId: string,
): ErrorResponse {
  return { error: { code, message, request_id: requestId } };
}
