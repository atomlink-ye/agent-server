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

export type ProductSessionSummary = {
  session_id: string;
  title: string;
  preview: string | null;
  preview_role: 'user' | 'assistant' | null;
  last_message_at: string | null;
  created_at: string;
  status?: 'Working' | 'Completed' | 'Failed' | 'Ready';
};

export type RunEvent = {
  id: string;
  run_id: string;
  sequence: number;
  type: string;
  payload?: unknown;
  created_at: string;
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

function requireConfig(): { baseUrl: string; token: string } {
  if (!baseUrl || !token)
    throw new AgentServerError(503, 'web_configuration_missing');
  return {
    baseUrl: baseUrl.replace(/\/$/, ''),
    token,
  };
}

function requireChatConfig() {
  const config = requireConfig();
  if (!agentVersionId || !environmentVersionId)
    throw new AgentServerError(503, 'web_configuration_missing');
  return { ...config, agentVersionId, environmentVersionId };
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

export async function listSessions(workspaceId: string): Promise<{
  sessions: ProductSessionSummary[];
  next_cursor: string | null;
}> {
  if (!isUuid(workspaceId))
    throw new AgentServerError(500, 'web_configuration_missing');
  const query = new URLSearchParams({ workspace_id: workspaceId, limit: '20' });
  return request(`/api/v1/sessions?${query.toString()}`);
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
  const config = requireChatConfig();
  return request<ProductSession>('/api/v1/sessions', {
    method: 'POST',
    body: JSON.stringify({
      workspace_id: workspaceId,
      agent_version_id: config.agentVersionId,
      environment_version_id: config.environmentVersionId,
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

export async function getAllRunEvents(runId: string): Promise<RunEvent[]> {
  const events: RunEvent[] = [];
  let after = 0;
  for (;;) {
    const page = await request<{
      events: RunEvent[];
      next_cursor: number | null;
    }>(`/api/v1/runs/${encodeURIComponent(runId)}/events?after=${after}`);
    events.push(...page.events);
    if (page.next_cursor === null || page.events.length === 0) return events;
    after = page.next_cursor;
  }
}

export async function getRunEventsPage(runId: string, after: number) {
  return request<{ events: RunEvent[]; next_cursor: number | null }>(
    `/api/v1/runs/${encodeURIComponent(runId)}/events?after=${after}`,
  );
}

export async function listLearningProposals(workspaceId: string) {
  return request<unknown>(
    `/api/v1/learning-proposals?workspace_id=${encodeURIComponent(workspaceId)}`,
  );
}

export function getConfiguredWorkspaceId(): string | undefined {
  return configuredWorkspaceId;
}

export function getSelfLearningConfig() {
  return {
    workspaceId: process.env.WEB_WORKSPACE_ID,
    teamVersionId: process.env.WEB_SELF_LEARNING_TEAM_VERSION_ID,
    memoryStoreId: process.env.WEB_SELF_LEARNING_MEMORY_STORE_ID,
  };
}

export async function invokeTeamVersion(
  workspaceId: string,
  teamVersionId: string,
  text: string,
  idempotencyKey: string,
) {
  return request<unknown>('/api/v1/tasks:invoke', {
    method: 'POST',
    headers: { 'idempotency-key': idempotencyKey },
    body: JSON.stringify({
      workspace_id: workspaceId,
      invokable: { kind: 'team', version_id: teamVersionId },
      input: { text },
    }),
  });
}

export async function getTask(taskId: string) {
  return request<unknown>(`/api/v1/tasks/${encodeURIComponent(taskId)}`);
}
export async function getTaskTree(taskId: string) {
  return request<unknown>(`/api/v1/tasks/${encodeURIComponent(taskId)}/tree`);
}
export async function getTeamRunByTask(taskId: string) {
  return request<unknown>(
    `/api/v1/tasks/${encodeURIComponent(taskId)}/team-run`,
  );
}
export async function getTeamRunMembers(teamRunId: string) {
  return request<unknown>(
    `/api/v1/team-runs/${encodeURIComponent(teamRunId)}/members`,
  );
}
export async function getTeamRunTasks(teamRunId: string) {
  return request<unknown>(
    `/api/v1/team-runs/${encodeURIComponent(teamRunId)}/tasks`,
  );
}
export async function getLearningProposal(proposalId: string) {
  return request<unknown>(
    `/api/v1/learning-proposals/${encodeURIComponent(proposalId)}`,
  );
}
export async function reviewLearningProposal(
  proposalId: string,
  action: 'accept' | 'reject' | 'edit_and_accept',
  content?: string,
) {
  const path =
    action === 'accept'
      ? 'accept'
      : action === 'reject'
        ? 'reject'
        : 'edit-and-accept';
  return request<unknown>(
    `/api/v1/learning-proposals/${encodeURIComponent(proposalId)}/${path}`,
    {
      method: 'POST',
      body: JSON.stringify(action === 'edit_and_accept' ? { content } : {}),
    },
  );
}
export async function getMemory(storeId: string, memoryId: string) {
  return request<unknown>(
    `/api/v1/memory-stores/${encodeURIComponent(storeId)}/memories/${encodeURIComponent(memoryId)}`,
  );
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
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
