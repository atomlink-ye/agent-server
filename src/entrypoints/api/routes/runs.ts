import type { Hono } from 'hono';

import { ServiceAccountAuthenticator } from '../../../application/control-plane/service-account-authenticator.js';
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
import type { AppConfig } from '../../../shared/config.js';
import {
  getAuthenticatedAccessContext,
  requireServiceAccountAccess,
} from '../authentication.js';
import type { ApiEnvironment } from '../http-types.js';
import type { RunEventRepository } from '../../../application/ports/run-events.js';

interface RunRouteDependencies {
  readonly config: AppConfig;
  readonly runtime: AgentRuntimePort;
  readonly submitRun: SubmitRun;
  readonly getRun: GetRun;
  readonly events?: RunEventRepository;
}

export function registerRunRoutes(
  app: Hono<ApiEnvironment>,
  dependencies: RunRouteDependencies,
): void {
  const authenticator = new ServiceAccountAuthenticator(
    dependencies.config.serviceAccounts ?? [],
  );

  app.use('/api/v1/runs', requireServiceAccountAccess(authenticator));
  app.use('/api/v1/runs/*', requireServiceAccountAccess(authenticator));

  app.post('/api/v1/runs', async (context) => {
    const accessContext = getAuthenticatedAccessContext(context);
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
            accessContext,
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
          accessContext,
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
    const run = await dependencies.getRun.execute(
      context.req.param('runId'),
      getAuthenticatedAccessContext(context),
    );
    if (!run) {
      throw new HttpError(
        404,
        'run_not_found',
        'The requested run does not exist.',
      );
    }
    return context.json(toRunResponse(run), 200);
  });

  app.get('/api/v1/runs/:runId/events', async (context) => {
    const runId = context.req.param('runId');
    if (
      !(await dependencies.getRun.execute(
        runId,
        getAuthenticatedAccessContext(context),
      ))
    )
      throw new HttpError(
        404,
        'run_not_found',
        'The requested run does not exist.',
      );
    if (!dependencies.events)
      throw new HttpError(
        404,
        'run_not_found',
        'The requested run does not exist.',
      );
    const raw =
      context.req.query('after') ?? context.req.query('cursor') ?? '0';
    const after = Number(raw);
    if (!Number.isSafeInteger(after) || after < 0)
      throw new HttpError(
        400,
        'invalid_cursor',
        'Cursor must be a nonnegative integer.',
      );
    const page = await dependencies.events.list(runId, after);
    return context.json(
      {
        events: page.events.map(toEventResponse),
        next_cursor: page.nextCursor,
      },
      200,
    );
  });
  app.get('/api/v1/runs/:runId/events/stream', async (context) => {
    const runId = context.req.param('runId');
    const accessContext = getAuthenticatedAccessContext(context);
    if (
      !(await dependencies.getRun.execute(runId, accessContext)) ||
      !dependencies.events
    )
      throw new HttpError(
        404,
        'run_not_found',
        'The requested run does not exist.',
      );
    const header = context.req.header('last-event-id');
    const raw = context.req.query('after') ?? header ?? '0';
    let cursor = Number(raw);
    if (!Number.isSafeInteger(cursor) || cursor < 0)
      throw new HttpError(
        400,
        'invalid_cursor',
        'Cursor must be a nonnegative integer.',
      );
    const cursorEvent =
      cursor > 0
        ? (await dependencies.events.list(runId, cursor - 1, 1)).events.find(
            (event) => event.sequence === cursor,
          )
        : undefined;
    const cursorIsTerminal = Boolean(
      cursorEvent &&
      ['succeeded', 'failed', 'cancelled', 'timed_out'].includes(
        cursorEvent.type,
      ),
    );
    let stopStream: () => void = () => undefined;
    return new Response(
      new ReadableStream({
        cancel() {
          stopStream();
        },
        async start(controller) {
          const encoder = new TextEncoder();
          let stopped = false;
          const stop = () => {
            stopped = true;
          };
          stopStream = stop;
          context.req.raw.signal.addEventListener('abort', stop, {
            once: true,
          });
          try {
            if (cursorIsTerminal) return;
            for (;;) {
              if (stopped) return;
              const page = await dependencies.events!.list(runId, cursor);
              for (const event of page.events) {
                if (stopped) return;
                cursor = event.sequence;
                controller.enqueue(
                  encoder.encode(
                    `id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(toEventResponse(event))}\n\n`,
                  ),
                );
              }
              if (
                page.events.some((event) =>
                  ['succeeded', 'failed', 'cancelled', 'timed_out'].includes(
                    event.type,
                  ),
                )
              )
                break;
              await waitForStreamPoll(context.req.raw.signal, stop);
            }
          } finally {
            context.req.raw.signal.removeEventListener('abort', stop);
            if (!stopped) controller.close();
          }
        },
      }),
      {
        headers: {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        },
      },
    );
  });
}

async function waitForStreamPoll(
  signal: AbortSignal,
  stop: () => void,
): Promise<void> {
  if (signal.aborted) {
    stop();
    return;
  }
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 100);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        stop();
        resolve();
      },
      { once: true },
    );
  });
}

function toEventResponse(
  event: import('../../../application/ports/run-events.js').RunEvent,
) {
  return {
    id: String(event.sequence),
    run_id: event.runId,
    sequence: event.sequence,
    type: event.type,
    payload: event.payload,
    created_at: event.createdAt,
  };
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
