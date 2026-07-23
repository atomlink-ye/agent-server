import type { Hono } from 'hono';
import { HttpError } from '../../../contracts/http.js';
import {
  MessageCreateSchema,
  SessionCreateSchema,
  WorkspaceCreateSchema,
} from '../../../contracts/sessions.js';
import type { SessionRepository } from '../../../application/ports/session-repository.js';
import {
  getAuthenticatedAccessContext,
  requireServiceAccountAccess,
} from '../authentication.js';
import type { ApiEnvironment } from '../http-types.js';
import type { AppConfig } from '../../../shared/config.js';
import { ServiceAccountAuthenticator } from '../../../application/control-plane/service-account-authenticator.js';
const json = async (c: any) => {
  try {
    return await c.req.json();
  } catch {
    throw new HttpError(
      400,
      'invalid_json',
      'The request body is not valid JSON.',
    );
  }
};
export function registerSessionRoutes(
  app: Hono<ApiEnvironment>,
  d: { config: AppConfig; sessions: SessionRepository },
) {
  const auth = requireServiceAccountAccess(
    new ServiceAccountAuthenticator(d.config.serviceAccounts ?? []),
  );
  app.use('/api/v1/workspaces', auth);
  app.use('/api/v1/workspaces/*', auth);
  app.use('/api/v1/sessions', auth);
  app.use('/api/v1/sessions/*', auth);
  app.post('/api/v1/workspaces', async (c) => {
    const p = WorkspaceCreateSchema.safeParse(await json(c));
    if (!p.success)
      throw new HttpError(
        400,
        'invalid_request',
        'A workspace name is required.',
      );
    const w = await d.sessions.createWorkspace(
      p.data.name,
      getAuthenticatedAccessContext(c),
    );
    return c.json(
      {
        workspace_id: w.id,
        name: w.name,
        created_at: w.createdAt,
        updated_at: w.updatedAt,
        links: { self: `/api/v1/workspaces/${w.id}` },
      },
      201,
    );
  });
  app.get('/api/v1/workspaces/:id', async (c) => {
    const w = await d.sessions.getWorkspace(
      String(c.req.param('id')),
      getAuthenticatedAccessContext(c),
    );
    if (!w)
      throw new HttpError(
        404,
        'workspace_not_found',
        'The requested workspace does not exist.',
      );
    return c.json({
      workspace_id: w.id,
      name: w.name,
      created_at: w.createdAt,
      updated_at: w.updatedAt,
      links: { self: `/api/v1/workspaces/${w.id}` },
    });
  });
  app.post('/api/v1/sessions', async (c) => {
    const p = SessionCreateSchema.safeParse(await json(c));
    if (!p.success)
      throw new HttpError(
        400,
        'invalid_request',
        'A workspace and published agent version are required.',
      );
    try {
      const s = await d.sessions.createSession({
        workspaceId: p.data.workspace_id,
        agentVersionId: p.data.agent_version_id,
        owner: getAuthenticatedAccessContext(c),
      });
      return c.json(
        {
          session_id: s.id,
          workspace_id: s.workspaceId,
          generation: s.generation,
          status: s.status,
          created_at: s.createdAt,
          updated_at: s.updatedAt,
          links: {
            self: `/api/v1/sessions/${s.id}`,
            messages: `/api/v1/sessions/${s.id}/messages`,
          },
        },
        201,
      );
    } catch {
      throw new HttpError(
        404,
        'workspace_not_found',
        'The requested workspace does not exist.',
      );
    }
  });
  const get = async (c: any) => {
    const s = await d.sessions.getSession(
      String(c.req.param('id')),
      getAuthenticatedAccessContext(c),
    );
    if (!s)
      throw new HttpError(
        404,
        'session_not_found',
        'The requested session does not exist.',
      );
    return s;
  };
  app.get('/api/v1/sessions/:id', async (c) => {
    const s = await get(c);
    return c.json({
      session_id: s.id,
      workspace_id: s.workspaceId,
      generation: s.generation,
      status: s.status,
      created_at: s.createdAt,
      updated_at: s.updatedAt,
      links: {
        self: `/api/v1/sessions/${s.id}`,
        messages: `/api/v1/sessions/${s.id}/messages`,
      },
    });
  });
  app.get('/api/v1/sessions/:id/messages', async (c) => {
    await get(c);
    const m = await d.sessions.listMessages(
      String(c.req.param('id')),
      getAuthenticatedAccessContext(c),
    );
    return c.json({ messages: m ?? [] });
  });
  app.post('/api/v1/sessions/:id/messages', async (c) => {
    await get(c);
    const p = MessageCreateSchema.safeParse(await json(c));
    if (!p.success)
      throw new HttpError(400, 'invalid_request', 'Message text is required.');
    const m = await d.sessions.postMessage(
      String(c.req.param('id')),
      p.data.text,
      c.req.header('idempotency-key') ??
        `request:${String(c.get('requestId'))}`,
      getAuthenticatedAccessContext(c),
    );
    return c.json(
      {
        message_id: m.id,
        session_id: m.sessionId,
        generation: m.generation,
        sequence: m.sequence,
        role: m.role,
        text: m.text,
        task_id: m.taskId,
        run_id: m.runId,
        status: m.status,
        created_at: m.createdAt,
        links: { self: `/api/v1/sessions/${m.sessionId}/messages` },
      },
      202,
    );
  });
  app.post('/api/v1/sessions/:sessionId:reset', async (c) => {
    const key = c.req.header('idempotency-key');
    if (key !== undefined && (key.trim().length === 0 || key.length > 256))
      throw new HttpError(
        400,
        'invalid_request',
        'Idempotency-Key must be non-empty and at most 256 characters.',
      );
    const s = await d.sessions.reset(
      c.req.path.split('/sessions/')[1]?.split(':reset')[0] ?? '',
      getAuthenticatedAccessContext(c),
      key ?? `request:${String(c.get('requestId'))}`,
    );
    if (!s)
      throw new HttpError(
        404,
        'session_not_found',
        'The requested session does not exist.',
      );
    return c.json(
      {
        session_id: s.id,
        generation: s.generation,
        status: s.status,
        updated_at: s.updatedAt,
        links: { self: `/api/v1/sessions/${s.id}` },
      },
      200,
    );
  });
}
