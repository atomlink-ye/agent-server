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
  'conversation_id' | 'kind' | 'title' | 'direct_agent' | 'topic' | 'created_at' | 'updated_at'
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

export async function listConversationBff() {
  try {
    const upstream = await listConversations();
    if (!Array.isArray(upstream.conversations)) throw invalidUpstream();
    const conversations = upstream.conversations.map(sanitizeConversation);
    return { conversations };
  } catch (error) {
    throw sanitizeError(error);
  }
}

export async function createConversationBff(agentDefinitionId: unknown) {
  if (!isNonEmptyString(agentDefinitionId)) throw new ConversationBffError(400, 'invalid_request');
  try {
    const upstream = await createConversation(agentDefinitionId);
    const conversation = sanitizeConversation(upstream.conversation);
    return { conversation };
  } catch (error) {
    throw sanitizeCreateError(error);
  }
}

export async function readConversationBff(conversationId: string) {
  requireConversationId(conversationId);
  try {
    const upstream = await getConversation(conversationId);
    return { conversation: sanitizeConversation(upstream.conversation) };
  } catch (error) {
    throw sanitizeError(error);
  }
}

export async function postConversationBff(conversationId: string, body: unknown) {
  requireConversationId(conversationId);
  if (!isNonEmptyString(body)) throw new ConversationBffError(400, 'invalid_request');
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

export async function readConversationMessagesBff(conversationId: string) {
  requireConversationId(conversationId);
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

function requireConversationId(conversationId: string): void {
  if (!isNonEmptyString(conversationId)) throw new ConversationBffError(400, 'invalid_request');
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
    error.hasJsonBody === true
  ) {
    return new ConversationBffError(error.status, 'conversation_create_failed', {
      body: error.body,
      preserveBody: true,
    });
  }
  return new ConversationBffError(502, 'conversation_unavailable');
}

function sanitizeConversation(value: AgentConversation): PublicConversation {
  if (!value || typeof value.conversation_id !== 'string' || !value.conversation_id)
    throw invalidUpstream();
  if (value.kind !== 'direct' && value.kind !== 'group') throw invalidUpstream();
  if (value.direct_agent !== null) {
    if (
      !value.direct_agent ||
      !isNonEmptyString(value.direct_agent.agent_definition_id) ||
      !nullableString(value.direct_agent.display_name)
    ) {
      throw invalidUpstream();
    }
  }
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
    direct_agent: value.direct_agent,
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
  if (value.runtime_epoch !== null && !Number.isSafeInteger(value.runtime_epoch))
    throw invalidUpstream();
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

function invalidUpstream(): ConversationBffError {
  return new ConversationBffError(502, 'conversation_unavailable');
}
