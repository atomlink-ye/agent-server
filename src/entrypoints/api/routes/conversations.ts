import type { Hono } from 'hono';
import { z } from 'zod';
import type { Conversation } from '../../../domain/chat/conversation.js';
import type { ChatMessage } from '../../../domain/chat/chat-message.js';
import type { ConversationRepository } from '../../../application/ports/conversation-repository.js';
import type { ChatDispatchRepository } from '../../../application/ports/chat-dispatch-repository.js';
import type { ConversationWorkEntitlementRepository } from '../../../application/ports/conversation-work-entitlement-repository.js';
import type { ManagedAgentDefinitionRead } from '../../../application/ports/agent-registry.js';
import { postConversationMessage } from '../../../application/chat/post-conversation-message.js';
import { enqueueChatDispatchForMessage } from '../../../application/chat/enqueue-chat-dispatch.js';
import { ServiceAccountAuthenticator } from '../../../application/control-plane/service-account-authenticator.js';
import {
  getAuthenticatedAccessContext,
  requireServiceAccountAccess,
} from '../authentication.js';
import { readBoundedJson } from '../read-bounded-json.js';
import type { ApiEnvironment } from '../../../platform/http-types.js';
import type { AppConfig } from '../../../shared/config.js';
import { HttpError } from '../../../contracts/http.js';

const BASE = '/api/v1/conversations';
const MAX_REQUEST_BYTES = 64 * 1024;

const createConversationSchema = z
  .object({
    agent_definition_id: z.string().trim().min(1).max(256),
  })
  .strict();

const messageSchema = z
  .object({
    body: z.string().trim().min(1).max(64 * 1024),
  })
  .strict();

const readSchema = z
  .object({
    through_sequence: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

export interface ConversationRouteDependencies {
  readonly config: AppConfig;
  readonly conversations: ConversationRepository;
  readonly dispatches: ChatDispatchRepository;
  readonly managedAgentDefinitions: ManagedAgentDefinitionRead;
  readonly workEntitlements?: ConversationWorkEntitlementRepository;
}

export function registerConversationRoutes(
  app: Hono<ApiEnvironment>,
  dependencies: ConversationRouteDependencies,
): void {
  const authenticator = new ServiceAccountAuthenticator(
    dependencies.config.serviceAccounts ?? [],
  );
  const auth = requireServiceAccountAccess(authenticator);
  app.use(BASE, auth);
  app.use(`${BASE}/*`, auth);

  app.get(BASE, async (c) => {
    const access = getAuthenticatedAccessContext(c);
    const conversations = await dependencies.conversations.listConversations({
      tenantId: access.tenantId,
      memberType: 'principal',
      memberId: access.principalId,
    });
    return c.json({ conversations: conversations.map(conversationResponse) });
  });

  app.post(BASE, async (c) => {
    const parsed = createConversationSchema.safeParse(
      await readBoundedJson(c.req.raw, MAX_REQUEST_BYTES),
    );
    if (!parsed.success) throw invalidRequest();
    const access = getAuthenticatedAccessContext(c);
    const definition = await dependencies.managedAgentDefinitions.findDefinition(
      {
        tenantId: access.tenantId,
        workspaceId: access.workspaceId,
        principalType: access.principalType,
        principalId: access.principalId,
      },
      parsed.data.agent_definition_id,
    );
    if (!definition) throw notFound();
    const runtime = await dependencies.conversations.getChatRuntime({
      tenantId: access.tenantId,
      agentDefinitionId: definition.id,
    });
    if (!runtime || runtime.status !== 'available')
      throw new HttpError(
        409,
        'chat_runtime_unavailable',
        'The requested agent is not available for chat.',
      );
    const conversation = await dependencies.conversations.findOrCreateDirect({
      tenantId: access.tenantId,
      principalId: access.principalId,
      principalType: access.principalType,
      agentDefinitionId: definition.id,
    });
    return c.json({ conversation: conversationResponse(conversation) }, 201);
  });

  app.get(`${BASE}/:conversationId`, async (c) => {
    const conversation = await requireConversation(c, dependencies);
    return c.json({ conversation: conversationResponse(conversation) });
  });

  app.get(`${BASE}/:conversationId/messages`, async (c) => {
    await requireConversation(c, dependencies);
    const access = getAuthenticatedAccessContext(c);
    const afterSequence = parseAfterSequence(c.req.query('after_sequence'));
    const messages = await dependencies.conversations.listMessages({
      tenantId: access.tenantId,
      conversationId: c.req.param('conversationId'),
      ...(afterSequence === undefined ? {} : { afterSequence }),
    });
    return c.json({ messages: messages.map(messageResponse) });
  });

  const enableWorkContext = (c: any) =>
    enableConversationWorkContext(c, dependencies);
  const revokeWorkContext = (c: any) =>
    revokeConversationWorkContext(c, dependencies);
  app.post(`${BASE}/:conversationId/work-context`, enableWorkContext);
  app.delete(`${BASE}/:conversationId/work-context`, revokeWorkContext);

  app.post(`${BASE}/:conversationId/messages`, async (c) => {
    const conversation = await requireConversation(c, dependencies);
    const parsed = messageSchema.safeParse(
      await readBoundedJson(c.req.raw, MAX_REQUEST_BYTES),
    );
    if (!parsed.success) throw invalidRequest();
    const access = getAuthenticatedAccessContext(c);
    const agentDefinitionId = deriveDirectAgentDefinitionId(
      conversation,
      access.principalId,
    );
    const runtime = await dependencies.conversations.getChatRuntime({
      tenantId: access.tenantId,
      agentDefinitionId,
    });
    if (!runtime)
      throw new HttpError(
        409,
        'chat_runtime_unavailable',
        'The requested agent is not available for chat.',
      );

    const message = await postConversationMessage(dependencies.conversations, {
      author: {
        type: 'principal',
        tenantId: access.tenantId,
        conversationId: conversation.id,
        principalType: access.principalType,
        principalId: access.principalId,
      },
      body: parsed.data.body,
    });
    const unread = await dependencies.conversations.getUnread({
      tenantId: access.tenantId,
      conversationId: conversation.id,
      principalType: access.principalType,
      principalId: access.principalId,
    });
    const dispatchEnqueued = await enqueueChatDispatchForMessage(
      dependencies.dispatches,
      {
        tenantId: access.tenantId,
        conversationId: conversation.id,
        agentDefinitionId: runtime.agentDefinitionId,
        lastReadSequence: unread.lastReadSequence,
        latestMessageSequence: message.sequence,
        latestMessageAuthorType: message.authorType,
      },
    );
    return c.json(
      {
        message: messageResponse(message),
        dispatch_enqueued: dispatchEnqueued,
      },
      202,
    );
  });

  app.get(`${BASE}/:conversationId/unread`, async (c) => {
    await requireConversation(c, dependencies);
    const unread = await unreadFor(c, dependencies);
    return c.json({
      last_read_sequence: unread.lastReadSequence,
      unread_count: unread.unreadCount,
    });
  });

  app.post(`${BASE}/:conversationId/read`, async (c) => {
    await requireConversation(c, dependencies);
    const parsed = readSchema.safeParse(
      await readBoundedJson(c.req.raw, MAX_REQUEST_BYTES),
    );
    if (!parsed.success) throw invalidRequest();
    const access = getAuthenticatedAccessContext(c);
    await dependencies.conversations.markRead({
      tenantId: access.tenantId,
      conversationId: c.req.param('conversationId'),
      principalType: access.principalType,
      principalId: access.principalId,
      throughSequence: parsed.data.through_sequence,
    });
    const unread = await unreadFor(c, dependencies);
    return c.json({
      last_read_sequence: unread.lastReadSequence,
      unread_count: unread.unreadCount,
    });
  });
}

async function requireConversation(
  c: any,
  dependencies: ConversationRouteDependencies,
): Promise<Conversation> {
  const access = getAuthenticatedAccessContext(c);
  const conversation = await dependencies.conversations.getConversation({
    tenantId: access.tenantId,
    conversationId: c.req.param('conversationId'),
    requesterMemberType: 'principal',
    requesterMemberId: access.principalId,
  });
  if (!conversation) throw notFound();
  return conversation;
}

async function unreadFor(
  c: any,
  dependencies: ConversationRouteDependencies,
): Promise<{ readonly lastReadSequence: number; readonly unreadCount: number }> {
  const access = getAuthenticatedAccessContext(c);
  return dependencies.conversations.getUnread({
    tenantId: access.tenantId,
    conversationId: c.req.param('conversationId'),
    principalType: access.principalType,
    principalId: access.principalId,
  });
}

function deriveDirectAgentDefinitionId(
  conversation: Conversation,
  principalId: string,
): string {
  const prefix = `direct:${conversation.tenantId}:${principalId}:`;
  if (
    conversation.kind !== 'direct' ||
    !conversation.directPairKey?.startsWith(prefix)
  )
    throw new HttpError(
      409,
      'conversation_agent_unavailable',
      'The conversation is not a supported direct agent conversation.',
    );
  const agentDefinitionId = conversation.directPairKey.slice(prefix.length);
  if (!agentDefinitionId)
    throw new HttpError(
      409,
      'conversation_agent_unavailable',
      'The conversation agent is unavailable.',
    );
  return agentDefinitionId;
}

function parseAfterSequence(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  if (!/^\d+$/.test(value)) throw invalidRequest();
  const sequence = Number(value);
  if (!Number.isSafeInteger(sequence)) throw invalidRequest();
  return sequence;
}

function invalidRequest(): HttpError {
  return new HttpError(400, 'invalid_request', 'The request is invalid.');
}

function notFound(): HttpError {
  return new HttpError(
    404,
    'not_found',
    'The requested conversation does not exist.',
  );
}

function workContextResponse(
  entitlement: import('../../../domain/chat/conversation-work-entitlement.js').ConversationWorkEntitlement,
) {
  return {
    conversation_id: entitlement.conversationId,
    workspace_id: entitlement.workspaceId,
    principal_type: entitlement.principalType,
    principal_id: entitlement.principalId,
    created_at: entitlement.createdAt,
    updated_at: entitlement.updatedAt,
  };
}

async function enableConversationWorkContext(
  c: any,
  dependencies: ConversationRouteDependencies,
) {
  if (!dependencies.workEntitlements)
    throw new HttpError(404, 'not_found', 'The requested route does not exist.');
  const conversation = await requireConversation(c, dependencies);
  if (conversation.kind !== 'direct')
    throw new HttpError(
      409,
      'conversation_work_context_unavailable',
      'Work context is available only for direct conversations.',
    );
  const access = getAuthenticatedAccessContext(c);
  const entitlement = await dependencies.workEntitlements.enable({
    tenantId: access.tenantId,
    conversationId: conversation.id,
    workspaceId: access.workspaceId,
    principalType: access.principalType,
    principalId: access.principalId,
  });
  if (!entitlement)
    throw new HttpError(
      409,
      'conversation_work_context_unavailable',
      'The conversation is not an eligible direct conversation for this service account.',
    );
  return c.json({ work_context: workContextResponse(entitlement) }, 200);
}

async function revokeConversationWorkContext(
  c: any,
  dependencies: ConversationRouteDependencies,
) {
  if (!dependencies.workEntitlements)
    throw new HttpError(404, 'not_found', 'The requested route does not exist.');
  await requireConversation(c, dependencies);
  const access = getAuthenticatedAccessContext(c);
  await dependencies.workEntitlements.revoke({
    tenantId: access.tenantId,
    conversationId: c.req.param('conversationId'),
    principalType: access.principalType,
    principalId: access.principalId,
  });
  return c.body(null, 204);
}

function conversationResponse(conversation: Conversation) {
  return {
    conversation_id: conversation.id,
    kind: conversation.kind,
    title: conversation.title,
    topic: conversation.topic,
    created_at: conversation.createdAt,
    updated_at: conversation.updatedAt,
    links: {
      self: `${BASE}/${conversation.id}`,
      messages: `${BASE}/${conversation.id}/messages`,
      unread: `${BASE}/${conversation.id}/unread`,
    },
  };
}

function messageResponse(message: ChatMessage) {
  return {
    message_id: message.id,
    conversation_id: message.conversationId,
    sequence: message.sequence,
    author_type: message.authorType,
    author_id: message.authorId,
    body: message.body,
    agent_definition_id: message.agentDefinitionId,
    agent_version_id: message.agentVersionId,
    runtime_epoch: message.runtimeEpoch,
    work_ref: message.workRef,
    created_at: message.createdAt,
  };
}
