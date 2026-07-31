import type { Hono } from 'hono';
import { HttpError } from '../../../contracts/http.js';
import {
  MessageCreateSchema,
  SessionCreateSchema,
  WorkspaceCreateSchema,
} from '../../../contracts/sessions.js';
import type { SessionRepository } from '../../../application/ports/session-repository.js';
import type { SubmitSessionTurn } from '../../../application/sessions/submit-session-turn.js';
import {
  getAuthenticatedAccessContext,
  requireServiceAccountAccess,
} from '../authentication.js';
import type { ApiEnvironment } from '../http-types.js';
import type { AppConfig } from '../../../shared/config.js';
import { ServiceAccountAuthenticator } from '../../../application/control-plane/service-account-authenticator.js';
import {
  SessionCreationError,
  SessionListQueryError,
} from '../../../application/sessions/session-errors.js';
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
  d: {
    config: AppConfig;
    sessions: SessionRepository;
    submitSessionTurn: SubmitSessionTurn;
  },
) {
  const auth = requireServiceAccountAccess(
    new ServiceAccountAuthenticator(d.config.serviceAccounts ?? []),
  );
  app.use('/api/v1/workspaces', auth);
  app.use('/api/v1/workspaces/*', auth);
  app.use('/api/v1/sessions', auth);
  app.use('/api/v1/sessions/*', auth);
  app.get('/api/v1/sessions', async (c) => {
    const query = parseSessionListQuery(c.req.url);
    const owner = getAuthenticatedAccessContext(c);
    const workspace = await d.sessions.getWorkspace(query.workspaceId, owner);
    if (!workspace)
      throw new HttpError(
        404,
        'workspace_not_found',
        'The requested workspace does not exist.',
      );
    try {
      const page = await d.sessions.listSessions(owner, query);
      return c.json({
        sessions: page.items.map((item) => ({
          session_id: item.sessionId,
          title: item.title,
          preview: item.preview,
          preview_role: item.previewRole,
          last_message_at: item.lastMessageAt,
          created_at: item.createdAt,
        })),
        next_cursor: page.nextCursor,
      });
    } catch (error) {
      if (error instanceof SessionListQueryError)
        throw new HttpError(
          400,
          error.code,
          error.code === 'invalid_limit'
            ? 'The requested session list limit is invalid.'
            : 'The requested session list cursor is invalid.',
        );
      throw error;
    }
  });
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
        ...(p.data.environment_version_id
          ? { environmentVersionId: p.data.environment_version_id }
          : {}),
        requireEnvironment: true,
      });
      return c.json(
        {
          session_id: s.id,
          workspace_id: s.workspaceId,
          generation: s.generation,
          status: s.status,
          environment_version_id: s.environmentVersionId,
          created_at: s.createdAt,
          updated_at: s.updatedAt,
          links: {
            self: `/api/v1/sessions/${s.id}`,
            messages: `/api/v1/sessions/${s.id}/messages`,
          },
        },
        201,
      );
    } catch (error) {
      if (
        error instanceof SessionCreationError &&
        error.code === 'environment_required'
      )
        throw new HttpError(
          409,
          'environment_required',
          'A published environment version is required.',
        );
      if (
        error instanceof SessionCreationError &&
        error.code === 'environment_version_not_found'
      )
        throw new HttpError(
          404,
          'environment_version_not_found',
          'The requested environment version does not exist.',
        );
      if (
        error instanceof SessionCreationError &&
        error.code === 'agent_version_not_found'
      )
        throw new HttpError(
          404,
          'agent_version_not_found',
          'The requested agent version does not exist.',
        );
      if (
        error instanceof SessionCreationError &&
        error.code === 'workspace_not_found'
      )
        throw new HttpError(
          404,
          'workspace_not_found',
          'The requested workspace does not exist.',
        );
      throw error;
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
      environment_version_id: s.environmentVersionId,
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
    const m = await d.submitSessionTurn.execute({
      sessionId: String(c.req.param('id')),
      text: p.data.text,
      idempotencyKey:
        c.req.header('idempotency-key') ??
        `request:${String(c.get('requestId'))}`,
      owner: getAuthenticatedAccessContext(c),
      origin: {
        channel: 'api',
        requestId: String(c.get('requestId')),
      },
    });
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

function parseSessionListQuery(url: string): {
  readonly workspaceId: string;
  readonly limit: number;
  readonly cursor: string | null;
} {
  const params = new URL(url).searchParams;
  for (const key of params.keys())
    if (key !== 'workspace_id' && key !== 'limit' && key !== 'cursor')
      throw new HttpError(
        400,
        'invalid_request',
        'The query parameters are invalid.',
      );
  const workspaceValues = params.getAll('workspace_id');
  if (workspaceValues.length !== 1 || !isCanonicalUuid(workspaceValues[0]!))
    throw new HttpError(
      400,
      'invalid_request',
      'Exactly one valid workspace_id is required.',
    );
  const limitValues = params.getAll('limit');
  if (limitValues.length > 1)
    throw new HttpError(
      400,
      'invalid_request',
      'The query parameters are invalid.',
    );
  const cursorValues = params.getAll('cursor');
  if (cursorValues.length > 1)
    throw new HttpError(
      400,
      'invalid_request',
      'The query parameters are invalid.',
    );
  if (cursorValues[0] === '')
    throw new HttpError(
      400,
      'invalid_cursor',
      'The requested session list cursor is invalid.',
    );
  const rawLimit = limitValues[0];
  if (rawLimit === undefined)
    return {
      workspaceId: workspaceValues[0]!,
      limit: 20,
      cursor: cursorValues[0] ?? null,
    };
  if (!/^(?:0|[1-9][0-9]*)$/.test(rawLimit))
    throw new HttpError(
      400,
      'invalid_limit',
      'The requested session list limit is invalid.',
    );
  const limit = Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)
    throw new HttpError(
      400,
      'invalid_limit',
      'The requested session list limit is invalid.',
    );
  return {
    workspaceId: workspaceValues[0]!,
    limit,
    cursor: cursorValues[0] ?? null,
  };
}

function isCanonicalUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
