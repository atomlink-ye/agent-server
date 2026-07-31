import 'server-only';

const baseUrl = process.env.AGENT_SERVER_BASE_URL;
const token = process.env.AGENT_SERVER_SERVICE_TOKEN;
const agentVersionId = process.env.WEB_AGENT_VERSION_ID;
const environmentVersionId = process.env.WEB_ENVIRONMENT_VERSION_ID;
const workspaceName = process.env.WEB_WORKSPACE_NAME ?? 'Web Chat MVE';
const configuredWorkspaceId = process.env.WEB_WORKSPACE_ID;

export type ProductMessage = {
  id: string;
  session_id: string;
  generation: number;
  sequence: number;
  role: 'user' | 'assistant';
  text: string;
  task_id: string;
  run_id: string | null;
  status: string;
  created_at: string;
};

export type ProductSession = {
  session_id: string;
  workspace_id: string;
  generation: number;
  status: string;
  environment_version_id: string;
};

export type SubmittedMessage = ProductMessage & {
  task_id: string;
  run_id: string;
};

export class AgentServerError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code = 'agent_server_error') {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function requireConfig(): {
  baseUrl: string;
  token: string;
  agentVersionId: string;
  environmentVersionId: string;
} {
  if (!baseUrl || !token || !agentVersionId || !environmentVersionId) {
    throw new AgentServerError(500, 'web_configuration_missing');
  }
  return {
    baseUrl: baseUrl.replace(/\/$/, ''),
    token,
    agentVersionId,
    environmentVersionId,
  };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const config = requireConfig();
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}${path}`, {
      ...init,
      cache: 'no-store',
      headers: {
        authorization: `Bearer ${config.token}`,
        'content-type': 'application/json',
        ...init.headers,
      },
    });
  } catch {
    throw new AgentServerError(503, 'agent_server_unavailable');
  }
  if (!response.ok) {
    let code = 'agent_server_error';
    try {
      const body = (await response.json()) as { error?: { code?: string } };
      if (body.error?.code) code = body.error.code;
    } catch {
      /* Keep the safe generic code. */
    }
    throw new AgentServerError(response.status, code);
  }
  return (await response.json()) as T;
}

export async function getSession(sessionId: string): Promise<ProductSession> {
  return request<ProductSession>(
    `/api/v1/sessions/${encodeURIComponent(sessionId)}`,
  );
}

export async function getMessages(
  sessionId: string,
): Promise<ProductMessage[]> {
  const response = asRecord(
    await request<unknown>(
      `/api/v1/sessions/${encodeURIComponent(sessionId)}/messages`,
    ),
  );
  if (!Array.isArray(response.messages))
    throw new AgentServerError(502, 'agent_server_invalid_messages');
  return response.messages.map((message) => normalizeMessage(message));
}

export async function createWorkspace(): Promise<{ workspace_id: string }> {
  return request<{ workspace_id: string }>('/api/v1/workspaces', {
    method: 'POST',
    body: JSON.stringify({ name: workspaceName }),
  });
}

export async function createSession(
  workspaceId: string,
): Promise<ProductSession> {
  return request<ProductSession>('/api/v1/sessions', {
    method: 'POST',
    body: JSON.stringify({
      workspace_id: workspaceId,
      agent_version_id: requireConfig().agentVersionId,
      environment_version_id: requireConfig().environmentVersionId,
    }),
  });
}

export async function postMessage(
  sessionId: string,
  text: string,
  idempotencyKey: string,
): Promise<SubmittedMessage> {
  const response = await request<unknown>(
    `/api/v1/sessions/${encodeURIComponent(sessionId)}/messages`,
    {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey },
      body: JSON.stringify({ text }),
    },
  );
  return normalizeSubmittedMessage(response);
}

export async function openRunEventStream(
  runId: string,
  input: {
    readonly after: string | null;
    readonly lastEventId: string | null;
    readonly signal: AbortSignal;
  },
): Promise<Response> {
  const config = requireConfig();
  const query = new URLSearchParams();
  if (input.after !== null) query.set('after', input.after);
  const upstreamUrl = `${config.baseUrl}/api/v1/runs/${encodeURIComponent(runId)}/events/stream${query.size ? `?${query}` : ''}`;
  let response: Response;
  try {
    response = await fetch(upstreamUrl, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${config.token}`,
        accept: 'text/event-stream',
        ...(input.lastEventId !== null
          ? { 'last-event-id': input.lastEventId }
          : {}),
      },
      cache: 'no-store',
      signal: input.signal,
    });
  } catch (error) {
    if (input.signal.aborted) throw error;
    throw new AgentServerError(503, 'agent_server_unavailable');
  }
  if (!response.ok)
    throw new AgentServerError(response.status, 'run_stream_unavailable');
  if (!response.body) throw new AgentServerError(502, 'run_stream_empty');
  return response;
}

export function getConfiguredWorkspaceId(): string | undefined {
  return configuredWorkspaceId;
}

function normalizeMessage(value: unknown): ProductMessage {
  const message = asRecord(value);
  return {
    id: requiredString(message.id, 'id'),
    session_id: requiredString(message.sessionId, 'session_id'),
    generation: requiredNumber(message.generation, 'generation'),
    sequence: requiredNumber(message.sequence, 'sequence'),
    role: requiredRole(message.role),
    text: requiredString(message.text, 'text'),
    task_id: requiredString(message.taskId, 'task_id'),
    run_id: nullableString(message.runId, 'run_id'),
    status: requiredString(message.status, 'status'),
    created_at: requiredString(message.createdAt, 'created_at'),
  };
}

function normalizeSubmittedMessage(value: unknown): SubmittedMessage {
  const message = asRecord(value);
  const normalized = {
    id: requiredString(message.message_id, 'message_id'),
    session_id: requiredString(message.session_id, 'session_id'),
    generation: requiredNumber(message.generation, 'generation'),
    sequence: requiredNumber(message.sequence, 'sequence'),
    role: requiredRole(message.role),
    text: requiredString(message.text, 'text'),
    task_id: requiredString(message.task_id, 'task_id'),
    run_id: requiredString(message.run_id, 'run_id'),
    status: requiredString(message.status, 'status'),
    created_at: requiredString(message.created_at, 'created_at'),
  } satisfies SubmittedMessage;
  return normalized;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new AgentServerError(502, 'agent_server_invalid_message');
  return value as Record<string, unknown>;
}
function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0)
    throw new AgentServerError(502, `agent_server_invalid_${field}`);
  return value;
}
function nullableString(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  return requiredString(value, field);
}
function requiredNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value))
    throw new AgentServerError(502, `agent_server_invalid_${field}`);
  return value;
}
function requiredRole(value: unknown): ProductMessage['role'] {
  if (value === 'user' || value === 'assistant') return value;
  throw new AgentServerError(502, 'agent_server_invalid_role');
}
