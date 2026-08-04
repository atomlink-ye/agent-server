import { NextResponse } from 'next/server';
import {
  AgentServerError,
  getMessages,
  openRunEventStream,
} from '@/lib/agent-server-client';
import { requireSelectedWebSession } from '@/lib/selected-web-session';
import { readProductSessionId } from '@/lib/session-cookie';
import { safeRunEventStream } from '@/lib/safe-run-events';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const runId = (await context.params).id;
    const sessionId = await readProductSessionId();
    if (!sessionId)
      return safeError(new AgentServerError(404, 'run_not_found'));
    await requireSelectedWebSession(sessionId);
    const messages = await getMessages(sessionId);
    if (!messages.some((message) => message.run_id === runId))
      return safeError(new AgentServerError(404, 'run_not_found'));

    const upstream = await openRunEventStream(runId, {
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
    return safeError(error);
  }
}

function safeError(error: unknown) {
  const status =
    error instanceof AgentServerError && [404, 503].includes(error.status)
      ? error.status
      : 502;
  return NextResponse.json(
    {
      error:
        status === 404
          ? 'The run was not found.'
          : 'The run stream is unavailable.',
    },
    { status },
  );
}
