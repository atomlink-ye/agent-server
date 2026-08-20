import 'server-only';

import {
  AgentServerError,
  createConversation,
  getConversation,
  listConversationMessages,
  listConversations,
  postConversationMessage,
  type AgentConversation,
  type AgentConversationMessage,
} from '@/lib/agent-server-client';

export type PublicConversation = Pick<
  AgentConversation,
  | 'conversation_id'
  | 'kind'
  | 'title'
  | 'topic'
  | 'created_at'
  | 'updated_at'
>;

export type PublicConversationMessage = Pick<
  AgentConversationMessage,
  | 'message_id'
  | 'conversation_id'
  | 'sequence'
  | 'author_type'
  | 'author_id'
  | 'body'
  | 'agent_definition_id'
  | 'agent_version_id'
  | 'runtime_epoch'
  | 'work_ref'
  | 'created_at'
>;

export class ConversationBffError extends Error {
  readonly status: number;
  readonly code: string;
  readonly body: unknown;
  readonly preserveBody: boolean;

  constructor(
    status: number,
    code: string,
    options: { readonly body?: unknown; readonly preserveBody?: boolean } = {},
  ) {
    super(code);
    this.name = 'ConversationBffError';
    this.status = status;
    this.code = code;
    this.body = options.body ?? null;
    this.preserveBody = options.preserveBody === true;
  }
}

const allowedConversationIds = new Map<string, Set<string>>();

export async function listConversationBff(sessionId: string | undefined) {
  const sessionKey = requireSession(sessionId);
  try {
    const upstream = await listConversations();
    if (!Array.isArray(upstream.conversations)) throw invalidUpstream();
    const conversations = upstream.conversations.map(sanitizeConversation);
    allowedConversationIds.set(
      sessionKey,
      new Set(conversations.map((conversation) => conversation.conversation_id)),
    );
    return { conversations };
  } catch (error) {
    throw sanitizeError(error);
  }
}

export async function createConversationBff(
  sessionId: string | undefined,
  agentDefinitionId: unknown,
) {
  const sessionKey = requireSession(sessionId);
  if (!isNonEmptyString(agentDefinitionId))
    throw new ConversationBffError(400, 'invalid_request');
  try {
    const upstream = await createConversation(agentDefinitionId);
    const conversation = sanitizeConversation(upstream.conversation);
    const allowed = allowedConversationIds.get(sessionKey) ?? new Set<string>();
    allowed.add(conversation.conversation_id);
    allowedConversationIds.set(sessionKey, allowed);
    return { conversation };
  } catch (error) {
    throw sanitizeCreateError(error);
  }
}

export async function readConversationBff(
  sessionId: string | undefined,
  conversationId: string,
) {
  requireAllowedConversation(sessionId, conversationId);
  try {
    const upstream = await getConversation(conversationId);
    return { conversation: sanitizeConversation(upstream.conversation) };
  } catch (error) {
    throw sanitizeError(error);
  }
}

export async function postConversationBff(
  sessionId: string | undefined,
  conversationId: string,
  body: unknown,
) {
  requireAllowedConversation(sessionId, conversationId);
  if (!isNonEmptyString(body))
    throw new ConversationBffError(400, 'invalid_request');
  try {
    const upstream = await postConversationMessage(conversationId, body);
    return {
      message: sanitizeMessage(upstream.message),
      dispatch_enqueued: upstream.dispatch_enqueued === true,
    };
  } catch (error) {
    throw sanitizeError(error);
  }
}

export async function readConversationMessagesBff(
  sessionId: string | undefined,
  conversationId: string,
) {
  requireAllowedConversation(sessionId, conversationId);
  try {
    const upstream = await listConversationMessages(conversationId);
    if (!Array.isArray(upstream.messages)) throw invalidUpstream();
    const messages = upstream.messages.map(sanitizeMessage);
    if (messages.some((message) => message.conversation_id !== conversationId))
      throw invalidUpstream();
    return { messages };
  } catch (error) {
    throw sanitizeError(error);
  }
}

export function conversationErrorResponse(error: unknown) {
  const bffError =
    error instanceof ConversationBffError
      ? error
      : new ConversationBffError(502, 'conversation_unavailable');
  if (bffError.preserveBody) {
    return {
      status: bffError.status,
      body: bffError.body,
    };
  }
  const messages: Record<string, string> = {
    invalid_request: 'The conversation request is invalid.',
    missing_session: 'A product session is required.',
    conversation_not_allowed: 'The requested conversation is unavailable.',
    conversation_unavailable: 'Conversations are unavailable.',
  };
  return {
    status: bffError.status,
    body: {
      error: {
        code: bffError.code,
        message: messages[bffError.code] ?? 'Conversations are unavailable.',
      },
    },
  };
}

function requireSession(sessionId: string | undefined): string {
  if (!isNonEmptyString(sessionId))
    throw new ConversationBffError(401, 'missing_session');
  return sessionId;
}

function requireAllowedConversation(
  sessionId: string | undefined,
  conversationId: string,
): void {
  const sessionKey = requireSession(sessionId);
  if (
    !isNonEmptyString(conversationId) ||
    !allowedConversationIds.get(sessionKey)?.has(conversationId)
  )
    throw new ConversationBffError(404, 'conversation_not_allowed');
}

function sanitizeError(error: unknown): ConversationBffError {
  if (error instanceof ConversationBffError) return error;
  if (error instanceof AgentServerError)
    return new ConversationBffError(
      error.status >= 400 && error.status < 500 ? error.status : 502,
      'conversation_unavailable',
    );
  return new ConversationBffError(502, 'conversation_unavailable');
}

function sanitizeCreateError(error: unknown): ConversationBffError {
  if (error instanceof ConversationBffError) return error;
  if (
    error instanceof AgentServerError &&
    error.status >= 400 &&
    error.status < 500 &&
    isJsonErrorEnvelope(error.body)
  ) {
    return new ConversationBffError(error.status, 'conversation_create_failed', {
      body: error.body,
      preserveBody: true,
    });
  }
  return new ConversationBffError(502, 'conversation_unavailable');
}

function isJsonErrorEnvelope(value: unknown): boolean {
  const record = asRecord(value);
  return record !== null && asRecord(record.error) !== null;
}

function sanitizeConversation(value: AgentConversation): PublicConversation {
  if (!value || typeof value.conversation_id !== 'string' || !value.conversation_id)
    throw invalidUpstream();
  if (value.kind !== 'direct' && value.kind !== 'group') throw invalidUpstream();
  if (!nullableString(value.title) || value.title === undefined) {
    if (value.title !== null) throw invalidUpstream();
  }
  if (!nullableString(value.topic) || value.topic === undefined) {
    if (value.topic !== null) throw invalidUpstream();
  }
  if (!isNonEmptyString(value.created_at) || !isNonEmptyString(value.updated_at))
    throw invalidUpstream();
  return {
    conversation_id: value.conversation_id,
    kind: value.kind,
    title: value.title,
    topic: value.topic,
    created_at: value.created_at,
    updated_at: value.updated_at,
  };
}

function sanitizeMessage(value: AgentConversationMessage): PublicConversationMessage {
  if (!value || !isNonEmptyString(value.message_id) || !isNonEmptyString(value.conversation_id))
    throw invalidUpstream();
  if (!Number.isSafeInteger(value.sequence) || value.sequence < 1) throw invalidUpstream();
  if (value.author_type !== 'principal' && value.author_type !== 'agent_definition')
    throw invalidUpstream();
  if (!isNonEmptyString(value.author_id) || !isNonEmptyString(value.body)) throw invalidUpstream();
  if (!nullableString(value.agent_definition_id) || value.agent_definition_id === undefined) {
    if (value.agent_definition_id !== null) throw invalidUpstream();
  }
  if (!nullableString(value.agent_version_id) || value.agent_version_id === undefined) {
    if (value.agent_version_id !== null) throw invalidUpstream();
  }
  if (value.runtime_epoch !== null && !Number.isSafeInteger(value.runtime_epoch)) throw invalidUpstream();
  if (!nullableString(value.work_ref) || value.work_ref === undefined) {
    if (value.work_ref !== null) throw invalidUpstream();
  }
  if (!isNonEmptyString(value.created_at)) throw invalidUpstream();
  return {
    message_id: value.message_id,
    conversation_id: value.conversation_id,
    sequence: value.sequence,
    author_type: value.author_type,
    author_id: value.author_id,
    body: value.body,
    agent_definition_id: value.agent_definition_id,
    agent_version_id: value.agent_version_id,
    runtime_epoch: value.runtime_epoch,
    work_ref: value.work_ref,
    created_at: value.created_at,
  };
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function invalidUpstream(): ConversationBffError {
  return new ConversationBffError(502, 'conversation_unavailable');
}
