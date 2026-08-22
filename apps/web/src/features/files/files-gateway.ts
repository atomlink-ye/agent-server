import { apiTransport } from '../../api/transport';

export type ContextScopeKind =
  | 'organization'
  | 'workspace'
  | 'agent'
  | 'agent_user'
  | 'conversation'
  | 'work';

export interface ContextScopeRequest {
  readonly scope: ContextScopeKind;
  readonly agentDefinitionId?: string;
  readonly conversationId?: string;
  readonly workId?: string;
}

export interface ContextFileSummary {
  readonly id: string;
  readonly path: string;
  readonly currentVersion: number;
  readonly contentSha256: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ContextFileDetail extends ContextFileSummary {
  readonly content: string;
}

export interface ContextFileListing {
  readonly access: 'read_only' | 'read_write';
  readonly scope: Record<string, unknown>;
  readonly entries: readonly ContextFileSummary[];
}

export async function loadContextFiles(
  request: ContextScopeRequest,
): Promise<ContextFileListing> {
  const payload = await json(`/api/context/files?${scopeParams(request)}`);
  const root = record(payload);
  const entries = root?.entries;
  if (
    !Array.isArray(entries) ||
    (root?.access !== 'read_only' && root?.access !== 'read_write')
  ) {
    throw new Error('Invalid Files response.');
  }
  const scope = record(root.scope);
  if (!scope) throw new Error('Invalid Files response.');
  return {
    access: root.access,
    scope,
    entries: entries.map(fileSummary),
  };
}

export async function loadContextFile(
  request: ContextScopeRequest,
  path: string,
): Promise<ContextFileDetail> {
  const payload = await json(
    `/api/context/file?${scopeParams(request)}&path=${encodeURIComponent(path)}`,
  );
  const entry = record(record(payload)?.entry);
  if (!entry) throw new Error('Invalid File response.');
  return { ...fileSummary(entry), content: text(entry.content) };
}

export async function promoteConversationToUser(input: {
  readonly agentDefinitionId: string;
  readonly conversationId: string;
  readonly sourcePath: string;
  readonly targetPath: string;
}): Promise<void> {
  await post('/api/context/promotions/conversation-to-user', {
    agent_definition_id: input.agentDefinitionId,
    conversation_id: input.conversationId,
    source_path: input.sourcePath,
    target_path: input.targetPath,
  });
}

export async function admitConversationToWork(input: {
  readonly conversationId: string;
  readonly workId: string;
  readonly sourcePath: string;
  readonly targetPath: string;
}): Promise<void> {
  await post('/api/context/admissions/conversation-to-work', {
    conversation_id: input.conversationId,
    work_id: input.workId,
    source_path: input.sourcePath,
    target_path: input.targetPath,
  });
}

export async function publishWorkResult(input: {
  readonly workId: string;
  readonly sourcePath: string;
  readonly targetPath: string;
}): Promise<void> {
  await post('/api/context/publications/work-result', {
    work_id: input.workId,
    source_path: input.sourcePath,
    target_path: input.targetPath,
  });
}

async function post(path: string, body: Record<string, unknown>): Promise<unknown> {
  return json(path, { method: 'POST', body: JSON.stringify(body) });
}
async function json(path: string, init: RequestInit = {}): Promise<unknown> {
  return apiTransport.request(path, init);
}
function scopeParams(request: ContextScopeRequest): string {
  const params = new URLSearchParams({ scope: request.scope });
  if (request.agentDefinitionId)
    params.set('agent_definition_id', request.agentDefinitionId);
  if (request.conversationId) params.set('conversation_id', request.conversationId);
  if (request.workId) params.set('work_id', request.workId);
  return params.toString();
}
function fileSummary(value: unknown): ContextFileSummary {
  const entry = record(value);
  if (!entry) throw new Error('Invalid File entry.');
  return {
    id: text(entry.id),
    path: text(entry.path),
    currentVersion: integer(entry.current_version),
    contentSha256: text(entry.content_sha256),
    createdAt: text(entry.created_at),
    updatedAt: text(entry.updated_at),
  };
}
function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid Context response.');
  return value;
}
function integer(value: unknown): number {
  if (!Number.isSafeInteger(value)) throw new Error('Invalid Context response.');
  return value as number;
}
