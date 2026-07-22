import type { Hono } from 'hono';

import { ServiceAccountAuthenticator } from '../../../application/control-plane/service-account-authenticator.js';
import {
  IdempotencyConflictError,
  InvokableNotFoundError,
  type InvokeTask,
  WorkspaceScopeMismatchError,
} from '../../../application/tasks/invoke-task.js';
import type { GetTask } from '../../../application/tasks/get-task.js';
import type { GetTaskTree } from '../../../application/tasks/get-task-tree.js';
import { HttpError } from '../../../contracts/http.js';
import type { TaskRecord } from '../../../application/ports/task-repository.js';
import {
  type GetTaskResponse,
  type GetTaskTreeResponse,
  InvokeTaskRequestSchema,
  type InvokeTaskResponse,
  MAX_TASK_REQUEST_BYTES,
} from '../../../contracts/tasks.js';
import type { AppConfig } from '../../../shared/config.js';
import {
  getAuthenticatedAccessContext,
  requireServiceAccountAccess,
} from '../authentication.js';
import type { ApiEnvironment } from '../http-types.js';

interface TaskRouteDependencies {
  readonly config: AppConfig;
  readonly invokeTask: InvokeTask;
  readonly getTask: GetTask;
  readonly getTaskTree: GetTaskTree;
}

const TASK_INVOKE_PATH = '/api/v1/tasks:invoke';

export function registerTaskRoutes(
  app: Hono<ApiEnvironment>,
  dependencies: TaskRouteDependencies,
): void {
  const authenticator = new ServiceAccountAuthenticator(
    dependencies.config.serviceAccounts ?? [],
  );

  app.use(TASK_INVOKE_PATH, requireServiceAccountAccess(authenticator));
  app.use('/api/v1/tasks/*', requireServiceAccountAccess(authenticator));

  app.post(TASK_INVOKE_PATH, async (context) => {
    const input = InvokeTaskRequestSchema.safeParse(
      await readBoundedJson(context.req.raw),
    );
    if (!input.success) {
      throw new HttpError(
        400,
        'invalid_request',
        'A published invokable reference and non-empty text input are required and no unknown fields are allowed.',
      );
    }

    try {
      const invocation = await dependencies.invokeTask.execute({
        invokable: {
          kind: input.data.invokable.kind,
          versionId: input.data.invokable.version_id,
        },
        input: { text: input.data.input.text },
        accessContext: getAuthenticatedAccessContext(context),
        ...(input.data.workspace_id !== undefined
          ? { workspaceId: input.data.workspace_id }
          : {}),
        ...(context.req.header('idempotency-key') !== null
          ? { idempotencyKey: context.req.header('idempotency-key') as string }
          : {}),
      });

      const response: InvokeTaskResponse = {
        task_id: invocation.task.task.id,
        status: 'queued',
        links: {
          self: `/api/v1/tasks/${invocation.task.task.id}`,
          tree: `/api/v1/tasks/${invocation.task.task.id}/tree`,
        },
      };
      return context.json(response, 202);
    } catch (error) {
      if (error instanceof IdempotencyConflictError) {
        throw new HttpError(409, error.code, error.message);
      }
      if (error instanceof WorkspaceScopeMismatchError) {
        throw new HttpError(403, error.code, error.message);
      }
      if (error instanceof InvokableNotFoundError) {
        throw new HttpError(404, error.code, error.message);
      }

      throw error;
    }
  });

  app.get('/api/v1/tasks/:taskId', async (context) => {
    const task = await dependencies.getTask.execute(
      context.req.param('taskId'),
      getAuthenticatedAccessContext(context),
    );
    if (!task) {
      throw new HttpError(
        404,
        'task_not_found',
        'The requested task does not exist.',
      );
    }

    const response: GetTaskResponse = toTaskResponse(task);
    return context.json(response, 200);
  });

  app.get('/api/v1/tasks/:taskId/tree', async (context) => {
    const tasks = await dependencies.getTaskTree.execute(
      context.req.param('taskId'),
      getAuthenticatedAccessContext(context),
    );
    if (!tasks) {
      throw new HttpError(
        404,
        'task_not_found',
        'The requested task does not exist.',
      );
    }

    const response: GetTaskTreeResponse = {
      root_task_id: tasks[0]?.task.rootTaskId ?? context.req.param('taskId'),
      tasks: tasks.map(toTaskResponse),
    };
    return context.json(response, 200);
  });
}

async function readBoundedJson(request: Request): Promise<unknown> {
  const declaredLength = Number.parseInt(
    request.headers.get('content-length') ?? '0',
    10,
  );
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_TASK_REQUEST_BYTES
  ) {
    throw new HttpError(
      413,
      'request_too_large',
      'The request body exceeds 64 KiB.',
    );
  }

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_TASK_REQUEST_BYTES) {
    throw new HttpError(
      413,
      'request_too_large',
      'The request body exceeds 64 KiB.',
    );
  }

  try {
    return JSON.parse(new TextDecoder().decode(bytes) || '{}') as unknown;
  } catch {
    throw new HttpError(
      400,
      'invalid_json',
      'The request body is not valid JSON.',
    );
  }
}

function toTaskResponse(taskRecord: TaskRecord): GetTaskResponse {
  return {
    task_id: taskRecord.task.id,
    status: taskRecord.task.status,
    invokable: {
      kind: taskRecord.task.invokableKind,
      version_id: taskRecord.task.invokableVersionId,
    },
    root_task_id: taskRecord.task.rootTaskId,
    parent_task_id: taskRecord.task.parentTaskId,
    parent_run_id: taskRecord.task.parentRunId,
    latest_run: taskRecord.latestRun
      ? {
          run_id: taskRecord.latestRun.runId,
          attempt: taskRecord.latestRun.attempt,
          status: taskRecord.latestRun.status,
          created_at: taskRecord.latestRun.createdAt,
          updated_at: taskRecord.latestRun.updatedAt,
        }
      : null,
    result: taskRecord.latestRun?.result ?? null,
    error: taskRecord.latestRun?.error ?? null,
    created_at: taskRecord.task.createdAt,
    updated_at: taskRecord.task.updatedAt,
  };
}
