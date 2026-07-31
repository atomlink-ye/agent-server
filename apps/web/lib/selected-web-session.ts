import 'server-only';

import {
  AgentServerError,
  getConfiguredWorkspaceId,
  getSession,
  type ProductSession,
} from '@/lib/agent-server-client';
import { readProductSessionId } from '@/lib/session-cookie';

export async function requireSelectedWebSession(
  sessionId: string,
): Promise<ProductSession> {
  if (!isUuid(sessionId)) throw notFound();
  const configuredWorkspaceId = getConfiguredWorkspaceId();
  if (!configuredWorkspaceId)
    throw new AgentServerError(503, 'web_workspace_missing');
  if ((await readProductSessionId()) !== sessionId) throw notFound();
  const session = await getSession(sessionId);
  if (session.workspace_id !== configuredWorkspaceId) throw notFound();
  return session;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function notFound() {
  return new AgentServerError(404, 'session_not_found');
}
