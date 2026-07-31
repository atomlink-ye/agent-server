import { NextResponse } from 'next/server';
import {
  AgentServerError,
  getMessages,
  postMessage,
} from '@/lib/agent-server-client';
import { readProductSessionId } from '@/lib/session-cookie';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const id = (await context.params).id;
    if ((await readProductSessionId()) !== id)
      return NextResponse.json(
        { error: 'The session was not found.' },
        { status: 404 },
      );
    return NextResponse.json({ messages: await getMessages(id) });
  } catch (error) {
    return safeError(error);
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const id = (await context.params).id;
    if ((await readProductSessionId()) !== id)
      return NextResponse.json(
        { error: 'The session was not found.' },
        { status: 404 },
      );
    const idempotencyKey = request.headers.get('idempotency-key');
    if (
      idempotencyKey === null ||
      idempotencyKey.trim().length === 0 ||
      idempotencyKey.length > 256
    )
      return NextResponse.json(
        { error: 'A valid idempotency key is required.' },
        { status: 400 },
      );
    let body: { text?: unknown };
    try {
      body = (await request.json()) as { text?: unknown };
    } catch {
      return NextResponse.json(
        { error: 'Message text is required.' },
        { status: 400 },
      );
    }
    if (typeof body.text !== 'string' || body.text.trim() === '')
      return NextResponse.json(
        { error: 'Message text is required.' },
        { status: 400 },
      );
    const result = await postMessage(id, body.text, idempotencyKey);
    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    return safeError(error);
  }
}

function safeError(error: unknown) {
  const status =
    error instanceof AgentServerError &&
    [400, 404, 409, 503].includes(error.status)
      ? error.status
      : 500;
  return NextResponse.json(
    {
      error:
        status === 503
          ? 'The chat service is unavailable.'
          : 'The message could not be completed.',
    },
    { status },
  );
}
