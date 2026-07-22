import type { Hono } from 'hono';

import type { AgentRuntimePort } from '../../../application/ports/agent-runtime.js';
import { IdempotencyConflictError } from '../../../application/tasks/admit-root-task.js';
import type { GetRun } from '../../../application/runs/get-run.js';
import type { SubmitRun } from '../../../application/runs/submit-run.js';
import { HttpError } from '../../../contracts/http.js';
import {
  CreateRunRequestSchema,
  type CreateRunResponse,
  type GetRunResponse,
  MAX_RUN_REQUEST_BYTES,
} from '../../../contracts/runs.js';
import type { Run, RunUsage } from '../../../domain/runs/run.js';
import type { ApiEnvironment } from '../http-types.js';

interface RunRouteDependencies {
  readonly runtime: AgentRuntimePort;
  readonly submitRun: SubmitRun;
  readonly getRun: GetRun;
}

export function registerRunRoutes(
  app: Hono<ApiEnvironment>,
  dependencies: RunRouteDependencies,
): void {
  app.post('/api/v1/runs', async (context) => {
    const input = CreateRunRequestSchema.safeParse(
      await readBoundedJson(context.req.raw),
    );
    if (!input.success) {
      throw new HttpError(
        400,
        'invalid_request',
        'A non-empty prompt is required and no unknown fields are allowed.',
      );
    }

    const idempotencyKey = context.req.header('idempotency-key') ?? undefined;
    let submission;

    try {
      submission = idempotencyKey
        ? await dependencies.submitRun.replayIfAccepted(
            input.data.prompt,
            idempotencyKey,
          )
        : null;

      if (!submission) {
        const health = await dependencies.runtime.health();
        if (!health.ready) {
          throw new HttpError(
            503,
            'runtime_unavailable',
            'The Paseo OpenCode runtime is not ready.',
          );
        }

        submission = await dependencies.submitRun.execute(
          input.data.prompt,
          idempotencyKey,
        );
      }
    } catch (error) {
      if (error instanceof IdempotencyConflictError) {
        throw new HttpError(409, error.code, error.message);
      }

      throw error;
    }

    const response: CreateRunResponse = {
      run_id: submission.run.id,
      status: 'queued',
      links: { self: `/api/v1/runs/${submission.run.id}` },
    };
    return context.json(response, 202);
  });

  app.get('/api/v1/runs/:runId', async (context) => {
    const run = await dependencies.getRun.execute(context.req.param('runId'));
    if (!run) {
      throw new HttpError(
        404,
        'run_not_found',
        'The requested run does not exist.',
      );
    }
    return context.json(toRunResponse(run), 200);
  });
}

async function readBoundedJson(request: Request): Promise<unknown> {
  const declaredLength = Number.parseInt(
    request.headers.get('content-length') ?? '0',
    10,
  );
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_RUN_REQUEST_BYTES
  ) {
    throw new HttpError(
      413,
      'request_too_large',
      'The request body exceeds 64 KiB.',
    );
  }

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_RUN_REQUEST_BYTES) {
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

function toRunResponse(run: Run): GetRunResponse {
  return {
    run_id: run.id,
    status: run.status,
    runtime: run.runtime ?? null,
    result: run.result ?? null,
    usage: run.usage ? toUsageResponse(run.usage) : null,
    error: run.error ?? null,
    created_at: run.createdAt,
    updated_at: run.updatedAt,
  };
}

function toUsageResponse(
  usage: RunUsage,
): NonNullable<GetRunResponse['usage']> {
  return {
    ...(usage.inputTokens !== undefined
      ? { input_tokens: usage.inputTokens }
      : {}),
    ...(usage.cachedInputTokens !== undefined
      ? { cached_input_tokens: usage.cachedInputTokens }
      : {}),
    ...(usage.outputTokens !== undefined
      ? { output_tokens: usage.outputTokens }
      : {}),
    ...(usage.totalCostUsd !== undefined
      ? { total_cost_usd: usage.totalCostUsd }
      : {}),
    ...(usage.contextWindowMaxTokens !== undefined
      ? { context_window_max_tokens: usage.contextWindowMaxTokens }
      : {}),
    ...(usage.contextWindowUsedTokens !== undefined
      ? { context_window_used_tokens: usage.contextWindowUsedTokens }
      : {}),
  };
}
