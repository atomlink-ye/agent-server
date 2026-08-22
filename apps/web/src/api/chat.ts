import type {
  ChatCommands,
  ChatMessage,
  Conversation,
  ConversationId,
  Coworker,
  WorkListItem,
  WorkListProductState,
} from '../components/chat/contracts';

export type WorkProductState = 'running' | 'needs_you' | 'complete' | 'problem';

export type WorkResultCaptureStatus =
  | 'present'
  | 'not_present'
  | 'redacted'
  | 'not_captured';

export interface WorkChatCard {
  readonly workId: string;
  readonly workRef: string;
  readonly title: string;
  readonly availability: 'available' | 'unavailable';
  readonly productState: WorkProductState | null;
  readonly problemKind: 'failed' | 'cancelled' | 'not_captured' | null;
  readonly attentionReason: 'completion_approval_pending' | 'not_captured' | null;
  readonly resultSummary: string | null;
  readonly resultCaptureStatus: WorkResultCaptureStatus;
}

export class ChatApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ChatApiError';
    this.status = status;
    this.code = code;
  }
}

export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: 'same-origin',
      headers: {
        accept: 'application/json',
        ...(init.body === undefined
          ? {}
          : { 'content-type': 'application/json' }),
        ...init.headers,
      },
    });
  } catch {
    throw new ChatApiError(0, 'network_error', 'The service is unavailable.');
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const error = asRecord(payload)?.error;
    const details = asRecord(error);
    throw new ChatApiError(
      response.status,
      stringValue(details?.code) ?? 'request_failed',
      stringValue(details?.message) ?? 'The request could not be completed.',
    );
  }

  if (payload === null) {
    throw new ChatApiError(
      502,
      'invalid_response',
      'The service returned an invalid response.',
    );
  }
  return payload as T;
}

export async function loadCoworkers(): Promise<readonly Coworker[]> {
  const payload = asRecord(await request<unknown>('/api/agents'));
  const values = payload?.items;
  if (!Array.isArray(values)) throw invalidResponse();
  return values.map(normalizeCoworker);
}

export async function loadConversations(): Promise<readonly Conversation[]> {
  const payload = asRecord(await request<unknown>('/api/conversations'));
  const values = payload?.conversations;
  if (!Array.isArray(values)) throw invalidResponse();
  return values.map(normalizeConversation);
}

export async function createConversation(
  agentDefinitionId: string,
): Promise<Conversation> {
  const payload = asRecord(
    await request<unknown>('/api/conversations', {
      method: 'POST',
      body: JSON.stringify({ agent_definition_id: agentDefinitionId }),
    }),
  );
  const conversation = payload?.conversation;
  if (!conversation) throw invalidResponse();
  return normalizeConversation(conversation);
}

export async function loadWorks(): Promise<readonly WorkListItem[]> {
  const payload = asRecord(await request<unknown>('/api/works'));
  const values = payload?.works;
  if (!Array.isArray(values)) throw invalidResponse();
  return values.map(normalizeWorkListItem);
}

export async function loadMessages(
  conversationId: ConversationId,
): Promise<readonly ChatMessage[]> {
  const payload = asRecord(
    await request<unknown>(
      `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
    ),
  );
  const values = payload?.messages;
  if (!Array.isArray(values)) throw invalidResponse();
  const messages = values.map(normalizeMessage);
  if (messages.some((message) => message.conversationId !== conversationId)) {
    throw invalidResponse();
  }
  return messages.sort(compareMessages);
}

export async function sendMessage(
  conversationId: ConversationId,
  body: string,
): Promise<ChatMessage> {
  const payload = asRecord(
    await request<unknown>(
      `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
      {
        method: 'POST',
        body: JSON.stringify({ body }),
      },
    ),
  );
  const message = payload?.message;
  if (!message) throw invalidResponse();
  return normalizeMessage(message);
}

export async function loadWorkCard(workId: string): Promise<WorkChatCard> {
  if (!isUuid(workId))
    throw new ChatApiError(400, 'invalid_request', 'This Work is unavailable.');
  const card = asRecord(
    await request<unknown>(
      `/api/works/${encodeURIComponent(workId)}/chat-card`,
    ),
  );
  const normalized = normalizeWorkCard(card);
  if (normalized.workId !== workId || !isUuid(normalized.workId)) {
    throw invalidResponse();
  }
  return normalized;
}

export const chatCommands: ChatCommands = {
  loadCoworkers,
  loadConversations,
  createConversation,
  loadWorks,
  loadMessages,
  sendMessage,
};

function normalizeCoworker(value: unknown): Coworker {
  const record = asRecord(value);
  return {
    id: requiredString(record?.id),
    displayName: requiredString(record?.display_name),
    roleLabel: nullableString(record?.role_label),
    summary: nullableString(record?.summary),
    activeAgentVersionId: requiredString(record?.active_agent_version_id),
    runtimeStatus: requiredCoworkerRuntimeStatus(record?.runtime_status),
  };
}

function normalizeConversation(value: unknown): Conversation {
  const record = asRecord(value);
  return {
    id: requiredString(record?.conversation_id),
    kind: requiredConversationKind(record?.kind),
    title: nullableString(record?.title),
    directAgent: normalizeDirectAgent(record?.direct_agent),
    updatedAt: requiredString(record?.updated_at),
  };
}

function normalizeDirectAgent(value: unknown): Conversation['directAgent'] {
  if (value === null) return null;
  const record = asRecord(value);
  if (!record) throw invalidResponse();
  return {
    agentDefinitionId: requiredString(record.agent_definition_id),
    displayName: nullableString(record.display_name),
  };
}

function normalizeWorkListItem(value: unknown): WorkListItem {
  const record = asRecord(value);
  return {
    id: requiredString(record?.id),
    title: requiredString(record?.title),
    productState: requiredWorkListProductState(record?.product_state),
    updatedAt: requiredString(record?.updated_at),
    latestRunSummary: normalizeLatestRunSummary(record?.latest_run_summary),
  };
}

function normalizeLatestRunSummary(
  value: unknown,
): WorkListItem['latestRunSummary'] {
  if (value === null || value === undefined) return null;
  const record = asRecord(value);
  if (!record) throw invalidResponse();
  return {
    id: requiredString(record.id),
    updatedAt: requiredString(record.updated_at),
    resultSummary: nullableString(record.result_summary),
    resultCaptureStatus: requiredString(record.result_capture_status),
  };
}

function normalizeMessage(value: unknown): ChatMessage {
  const record = asRecord(value);
  return {
    id: requiredString(record?.message_id),
    conversationId: requiredString(record?.conversation_id),
    sequence: requiredNumber(record?.sequence),
    authorType: requiredAuthorType(record?.author_type),
    authorId: requiredString(record?.author_id),
    body: requiredString(record?.body),
    workRef: nullableString(record?.work_ref),
    createdAt: requiredString(record?.created_at),
  };
}

function normalizeWorkCard(
  value: Record<string, unknown> | null,
): WorkChatCard {
  if (!value) throw invalidResponse();
  const rawProductState = value.productState;
  const resultCaptureStatus = value.resultCaptureStatus;
  if (!isResultCaptureStatus(resultCaptureStatus)) {
    throw invalidResponse();
  }
  const productState =
    rawProductState === 'not_captured'
      ? null
      : isWorkProductState(rawProductState)
        ? rawProductState
        : (() => {
            throw invalidResponse();
          })();
  return {
    workId: requiredString(value.workId),
    workRef: requiredString(value.workRef),
    title: requiredString(value.title),
    availability: productState === null ? 'unavailable' : 'available',
    productState,
    problemKind: nullableEnum(value.problemKind, [
      'failed',
      'cancelled',
      'not_captured',
    ]),
    attentionReason: nullableEnum(value.attentionReason, [
      'completion_approval_pending',
      'not_captured',
    ]),
    resultSummary: nullableString(value.resultSummary),
    resultCaptureStatus,
  };
}

function compareMessages(left: ChatMessage, right: ChatMessage): number {
  return left.sequence - right.sequence || left.id.localeCompare(right.id);
}

function invalidResponse(): ChatApiError {
  return new ChatApiError(
    502,
    'invalid_response',
    'The service returned an invalid response.',
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function requiredString(value: unknown): string {
  const result = stringValue(value);
  if (!result) throw invalidResponse();
  return result;
}

function requiredNumber(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1)
    throw invalidResponse();
  return value as number;
}

function nullableString(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value === 'string') return value;
  throw invalidResponse();
}

function requiredCoworkerRuntimeStatus(
  value: unknown,
): Coworker['runtimeStatus'] {
  if (
    value === 'available' ||
    value === 'draining' ||
    value === 'unavailable'
  ) {
    return value;
  }
  throw invalidResponse();
}

function requiredAuthorType(value: unknown): ChatMessage['authorType'] {
  if (value === 'principal' || value === 'agent_definition') return value;
  throw invalidResponse();
}

function requiredConversationKind(value: unknown): Conversation['kind'] {
  if (value === 'direct' || value === 'group') return value;
  throw invalidResponse();
}

function requiredWorkListProductState(value: unknown): WorkListProductState {
  if (
    value === 'running' ||
    value === 'needs_you' ||
    value === 'complete' ||
    value === 'problem' ||
    value === 'not_captured'
  ) {
    return value;
  }
  throw invalidResponse();
}

function nullableEnum<T extends string>(
  value: unknown,
  values: readonly T[],
): T | null {
  if (value === null) return null;
  if (typeof value === 'string' && values.includes(value as T))
    return value as T;
  throw invalidResponse();
}

function isWorkProductState(value: unknown): value is WorkProductState {
  return (
    value === 'running' ||
    value === 'needs_you' ||
    value === 'complete' ||
    value === 'problem'
  );
}

function isResultCaptureStatus(
  value: unknown,
): value is WorkResultCaptureStatus {
  return (
    value === 'present' ||
    value === 'not_present' ||
    value === 'redacted' ||
    value === 'not_captured'
  );
}
