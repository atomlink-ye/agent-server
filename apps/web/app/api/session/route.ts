import { NextResponse } from 'next/server';
import {
  AgentServerError,
  createSession,
  createWorkspace,
  getConfiguredWorkspaceId,
  getMessages,
  getSession,
} from '@/lib/agent-server-client';
import {
  readProductSessionId,
  writeProductSessionId,
} from '@/lib/session-cookie';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const existingId = await readProductSessionId();
    if (existingId) {
      try {
        return NextResponse.json({
          session: await getSession(existingId),
          messages: await getMessages(existingId),
        });
      } catch (error) {
        if (
          !(error instanceof AgentServerError) ||
          ![400, 404].includes(error.status)
        )
          throw error;
      }
    }
    const workspaceId =
      getConfiguredWorkspaceId() ?? (await createWorkspace()).workspace_id;
    const session = await createSession(workspaceId);
    await writeProductSessionId(session.session_id);
    return NextResponse.json({
      session,
      messages: await getMessages(session.session_id),
    });
  } catch (error) {
    const status =
      error instanceof AgentServerError && error.status === 503 ? 503 : 500;
    return NextResponse.json({ error: 'The chat is not ready.' }, { status });
  }
}
