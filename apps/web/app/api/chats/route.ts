import { NextResponse } from 'next/server';
import {
  AgentServerError,
  createSession,
  getConfiguredWorkspaceId,
  getMessages,
  listSessions,
} from '@/lib/agent-server-client';
import { writeProductSessionId } from '@/lib/session-cookie';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const workspaceId = getConfiguredWorkspaceId();
    if (!workspaceId)
      return NextResponse.json(
        { error: 'The Web Workspace is not configured.' },
        { status: 503 },
      );
    const page = await listSessions(workspaceId);
    const sessions = await Promise.all(
      page.sessions.map(async (session) => ({
        ...session,
        status: await statusForSession(session.session_id),
      })),
    );
    return NextResponse.json({ ...page, sessions });
  } catch (error) {
    return safeError(error);
  }
}

export async function POST(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'New Chat does not accept request fields.' },
        { status: 400 },
      );
    }
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).length > 0
    )
      return NextResponse.json(
        { error: 'New Chat does not accept request fields.' },
        { status: 400 },
      );
    const workspaceId = getConfiguredWorkspaceId();
    if (!workspaceId)
      return NextResponse.json(
        { error: 'The Web Workspace is not configured.' },
        { status: 503 },
      );
    const session = await createSession(workspaceId);
    await writeProductSessionId(session.session_id);
    return NextResponse.json(
      { session, messages: await getMessages(session.session_id) },
      { status: 201 },
    );
  } catch (error) {
    return safeError(error);
  }
}

async function statusForSession(sessionId: string) {
  const messages = await getMessages(sessionId);
  const latestUser = [...messages]
    .reverse()
    .find((message) => message.role === 'user');
  if (!latestUser) return 'Ready' as const;
  if (['failed', 'cancelled', 'timed_out'].includes(latestUser.status))
    return 'Failed' as const;
  if (
    messages.some(
      (message) =>
        message.role === 'assistant' && message.task_id === latestUser.task_id,
    )
  )
    return 'Completed' as const;
  return 'Working' as const;
}

function safeError(error: unknown) {
  const status =
    error instanceof AgentServerError &&
    [400, 404, 409, 503].includes(error.status)
      ? error.status
      : 502;
  return NextResponse.json(
    {
      error:
        status === 503
          ? 'The chat service is unavailable.'
          : 'Chats are unavailable.',
    },
    { status },
  );
}
