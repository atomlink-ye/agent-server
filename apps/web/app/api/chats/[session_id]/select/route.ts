import { NextResponse } from 'next/server';
import {
  AgentServerError,
  getConfiguredWorkspaceId,
  getMessages,
  getSession,
} from '@/lib/agent-server-client';
import { writeProductSessionId } from '@/lib/session-cookie';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ session_id: string }> };

export async function POST(_request: Request, context: Context) {
  try {
    const sessionId = (await context.params).session_id;
    if (!isUuid(sessionId))
      return NextResponse.json(
        { error: 'The chat was not found.' },
        { status: 404 },
      );
    const workspaceId = getConfiguredWorkspaceId();
    if (!workspaceId)
      return NextResponse.json(
        { error: 'The Web Workspace is not configured.' },
        { status: 503 },
      );
    const session = await getSession(sessionId);
    if (session.workspace_id !== workspaceId)
      return NextResponse.json(
        { error: 'The chat was not found.' },
        { status: 404 },
      );
    const messages = await getMessages(sessionId);
    await writeProductSessionId(sessionId);
    return NextResponse.json({ session, messages });
  } catch (error) {
    return safeError(error);
  }
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
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
          ? 'The chat was not found.'
          : 'The chat could not be selected.',
    },
    { status },
  );
}
