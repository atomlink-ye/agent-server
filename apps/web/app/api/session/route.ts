import { NextResponse } from 'next/server';
import {
  AgentServerError,
  createSession,
  getConfiguredWorkspaceId,
  getMessages,
  getSession,
  listSessions,
} from '@/lib/agent-server-client';
import {
  readProductSessionId,
  writeProductSessionId,
} from '@/lib/session-cookie';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const configuredWorkspaceId = getConfiguredWorkspaceId();
    if (!configuredWorkspaceId)
      return NextResponse.json(
        { error: 'The Web Workspace is not configured.' },
        { status: 503 },
      );
    const existingId = await readProductSessionId();
    if (existingId) {
      try {
        const session = await getSession(existingId);
        if (session.workspace_id === configuredWorkspaceId)
          return NextResponse.json({
            session,
            messages: await getMessages(existingId),
          });
      } catch (error) {
        if (!(error instanceof AgentServerError) || error.status !== 404)
          throw error;
      }
    }
    const listed = await listSessions(configuredWorkspaceId);
    for (const item of listed.sessions) {
      try {
        const session = await getSession(item.session_id);
        if (session.workspace_id !== configuredWorkspaceId) continue;
        await writeProductSessionId(session.session_id);
        return NextResponse.json({
          session,
          messages: await getMessages(session.session_id),
        });
      } catch (error) {
        if (error instanceof AgentServerError && error.status === 404) continue;
        throw error;
      }
    }
    if (listed.sessions.length > 0)
      throw new AgentServerError(503, 'web_session_unavailable');
    const session = await createSession(configuredWorkspaceId);
    await writeProductSessionId(session.session_id);
    return NextResponse.json({
      session,
      messages: await getMessages(session.session_id),
    });
  } catch (error) {
    const status =
      error instanceof AgentServerError &&
      [400, 404, 409, 503].includes(error.status)
        ? error.status
        : 500;
    return NextResponse.json({ error: 'The chat is not ready.' }, { status });
  }
}
