import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import { Hono } from 'hono';

import type { ReadinessProbe } from '../../application/health/readiness.js';
import type { CreateMemoryProposal } from '../../application/memory/create-memory-proposal.js';
import type { ListMemoryEntries } from '../../application/memory/list-memory-entries.js';
import type { ListMemoryProposals } from '../../application/memory/list-memory-proposals.js';
import type { ReviewMemoryProposal } from '../../application/memory/review-memory-proposal.js';
import type { AgentRuntimePort } from '../../application/ports/agent-runtime.js';
import type { GetRun } from '../../application/runs/get-run.js';
import type { SubmitRun } from '../../application/runs/submit-run.js';
import type { GetTask } from '../../application/tasks/get-task.js';
import type { GetTaskTree } from '../../application/tasks/get-task-tree.js';
import type { InvokeTask } from '../../application/tasks/invoke-task.js';
import { HttpError, type ErrorResponse } from '../../contracts/http.js';
import type { AppConfig } from '../../shared/config.js';
import type { Logger } from '../../shared/observability/logger.js';
import type { ApiEnvironment } from './http-types.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerRunRoutes } from './routes/runs.js';
import { registerTaskRoutes } from './routes/tasks.js';
import { registerWorkspaceMemoryRoutes } from './routes/workspace-memory.js';

export interface AppDependencies {
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly readiness: ReadinessProbe;
  readonly runtime: AgentRuntimePort;
  readonly submitRun: SubmitRun;
  readonly getRun: GetRun;
  readonly invokeTask: InvokeTask;
  readonly getTask: GetTask;
  readonly getTaskTree: GetTaskTree;
  readonly createMemoryProposal: CreateMemoryProposal;
  readonly listMemoryProposals: ListMemoryProposals;
  readonly reviewMemoryProposal: ReviewMemoryProposal;
  readonly listMemoryEntries: ListMemoryEntries;
  readonly version?: string;
}

export function createApp(dependencies: AppDependencies): Hono<ApiEnvironment> {
  const app = new Hono<ApiEnvironment>();
  const version = dependencies.version ?? '0.1.0';

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
  registerRunRoutes(app, dependencies);
  registerTaskRoutes(app, dependencies);
  registerWorkspaceMemoryRoutes(app, dependencies);

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

function errorResponse(
  code: string,
  message: string,
  requestId: string,
): ErrorResponse {
  return { error: { code, message, request_id: requestId } };
}
