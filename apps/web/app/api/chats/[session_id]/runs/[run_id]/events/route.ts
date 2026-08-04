import { NextResponse } from 'next/server';
import {
  AgentServerError,
  getAllRunEvents,
  getMessages,
} from '@/lib/agent-server-client';
import { requireSelectedWebSession } from '@/lib/selected-web-session';
import { safeRunEvent } from '@/lib/safe-run-events';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ session_id: string; run_id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const { session_id: sessionId, run_id: runId } = await context.params;
    if (!isUuid(runId)) return notFound();
    await requireSelectedWebSession(sessionId);
    const messages = await getMessages(sessionId);
    if (!messages.some((message) => message.run_id === runId))
      return notFound();
    return NextResponse.json({
      events: (await getAllRunEvents(runId))
        .map(safeRunEvent)
        .filter((event): event is NonNullable<typeof event> => event !== null),
    });
  } catch (error) {
    return safeError(error);
  }
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
function notFound() {
  return NextResponse.json(
    { error: 'The run was not found.' },
    { status: 404 },
  );
}
function safeError(error: unknown) {
  const status =
    error instanceof AgentServerError && [400, 404, 503].includes(error.status)
      ? error.status
      : 502;
  return NextResponse.json(
    {
      error:
        status === 404
          ? 'The run was not found.'
          : 'The run events are unavailable.',
    },
    { status },
  );
}
