import { NextResponse } from 'next/server';
import { AgentServerError } from '@/lib/agent-server-client';
import {
  BffError,
  openProjectStream,
  validTeamUuid,
} from '@/lib/agentic-team-bff';
import { safeRunEventStream } from '@/lib/safe-run-events';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
type Context = { params: Promise<{ run_id: string }> };
export async function GET(request: Request, context: Context) {
  const run = (await context.params).run_id;
  const task = new URL(request.url).searchParams.get('task') ?? undefined;
  if (!validTeamUuid(run) || (task && !validTeamUuid(task)))
    return fail(new BffError('not_found'));
  try {
    const upstream = await openProjectStream(task, run, {
      after: new URL(request.url).searchParams.get('after'),
      lastEventId: request.headers.get('last-event-id'),
      signal: request.signal,
    });
    if (!upstream.body) throw new AgentServerError(502, 'run_stream_empty');
    return new Response(safeRunEventStream(upstream.body), {
      status: 200,
      headers: {
        'content-type':
          upstream.headers.get('content-type') ?? 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      },
    });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    return fail(error);
  }
}
function fail(error: unknown) {
  const status =
    error instanceof AgentServerError && error.status === 503
      ? 503
      : error instanceof BffError && error.kind === 'bad_gateway'
        ? 502
        : 404;
  return NextResponse.json(
    {
      error:
        status === 503
          ? 'web_configuration_missing'
          : status === 502
            ? 'upstream_unavailable'
            : 'not_found',
    },
    { status },
  );
}
