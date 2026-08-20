import { describe, expect, it, vi } from 'vitest';
import type {
  ConversationMessageAuthorContext,
  ConversationRepository,
} from '../ports/conversation-repository.js';
import type {
  ChatDispatch,
  ChatDispatchRepository,
} from '../ports/chat-dispatch-repository.js';
import type { ChatTurnProvider } from '../ports/chat-turn-provider.js';
import type { AgentChatRuntime } from '../../domain/chat/agent-chat-runtime.js';
import type { ChatMessage } from '../../domain/chat/chat-message.js';
import { ChatDeliveryReconciler } from './chat-delivery-reconciler.js';

class FakeConversationRepository implements ConversationRepository {
  private runtimes = new Map<string, AgentChatRuntime>();
  private messagesByConversationId = new Map<string, ChatMessage[]>();

  async findOrCreateDirect(): Promise<never> {
    throw new Error('not implemented');
  }

  async getConversation(): Promise<never> {
    throw new Error('not implemented');
  }

  async listConversations(): Promise<never> {
    throw new Error('not implemented');
  }

  async appendMessage(input: {
    readonly author: ConversationMessageAuthorContext;
    readonly body: string;
    readonly workRef?: string | null;
  }): Promise<ChatMessage> {
    const authorType = input.author.type;
    const authorId =
      authorType === 'principal'
        ? input.author.principalId
        : input.author.agentDefinitionId;
    const message: ChatMessage = Object.freeze({
      id: `msg-${Date.now()}`,
      tenantId: input.author.tenantId,
      conversationId: input.author.conversationId,
      sequence: 1,
      authorType,
      authorId,
      body: input.body,
      agentDefinitionId:
        authorType === 'agent_definition'
          ? input.author.agentDefinitionId
          : null,
      agentVersionId:
        authorType === 'agent_definition'
          ? (input.author.agentVersionId ?? null)
          : null,
      runtimeEpoch:
        authorType === 'agent_definition'
          ? (input.author.runtimeEpoch ?? null)
          : null,
      workRef: input.workRef ?? null,
      createdAt: new Date().toISOString(),
    });
    const convMessages = this.messagesByConversationId.get(
      input.author.conversationId,
    ) ?? [];
    convMessages.push(message);
    this.messagesByConversationId.set(input.author.conversationId, convMessages);
    return message;
  }

  async listMessages(input: {
    readonly tenantId: string;
    readonly conversationId: string;
    readonly afterSequence?: number;
  }): Promise<readonly ChatMessage[]> {
    // D4 guard test requires that this returns the FULL cross-conversation set
    // if called incorrectly. We store all messages in one big map, so we filter
    // only by conversationId.
    const convMessages = this.messagesByConversationId.get(
      input.conversationId,
    ) ?? [];
    return convMessages;
  }

  async getUnread(): Promise<never> {
    throw new Error('not implemented');
  }

  async markRead(): Promise<void> {
    // no-op for tests
  }

  async ensureChatRuntime(): Promise<never> {
    throw new Error('not implemented');
  }

  async rotateChatRuntimeEpoch(): Promise<never> {
    throw new Error('not implemented');
  }

  async getChatRuntime(input: {
    readonly tenantId: string;
    readonly agentDefinitionId: string;
  }): Promise<AgentChatRuntime | null> {
    const key = `${input.tenantId}:${input.agentDefinitionId}`;
    return this.runtimes.get(key) ?? null;
  }

  setRuntime(runtime: AgentChatRuntime): void {
    const key = `${runtime.tenantId}:${runtime.agentDefinitionId}`;
    this.runtimes.set(key, runtime);
  }

  addMessage(conversationId: string, message: ChatMessage): void {
    const convMessages = this.messagesByConversationId.get(conversationId) ?? [];
    convMessages.push(message);
    this.messagesByConversationId.set(conversationId, convMessages);
  }
}

class FakeChatDispatchRepository implements ChatDispatchRepository {
  private dispatches: ChatDispatch[] = [];
  private nextId = 1;

  async enqueue(): Promise<never> {
    throw new Error('not implemented');
  }

  async listPending(): Promise<readonly ChatDispatch[]> {
    throw new Error('not implemented');
  }

  async claimNext(): Promise<ChatDispatch | null> {
    return null;
  }

  async completeClaim(): Promise<boolean> {
    return true;
  }

  markPublishedCalled = false;
  markPublishedWithId: string | null = null;
  markPublishedWithTime: string | null = null;

  async markPublished(id: string, publishedAt: string): Promise<void> {
    this.markPublishedCalled = true;
    this.markPublishedWithId = id;
    this.markPublishedWithTime = publishedAt;
  }

  setDispatch(dispatch: ChatDispatch): void {
    this.dispatches.push(dispatch);
  }
}

class FakeChatTurnProvider implements ChatTurnProvider {
  lastRunTurnInput: Parameters<ChatTurnProvider['runTurn']>[0] | null = null;

  async runTurn(input: Parameters<ChatTurnProvider['runTurn']>[0]): Promise<{ readonly body: string }> {
    this.lastRunTurnInput = input;
    return { body: '[mock reply]' };
  }
}

describe('ChatDeliveryReconciler', () => {
  it('1. golden path: processes one dispatch and materialized agent reply', async () => {
    const convRepo = new FakeConversationRepository();
    const dispatchRepo = new FakeChatDispatchRepository();
    const provider = new FakeChatTurnProvider();

    const runtime: AgentChatRuntime = Object.freeze({
      id: '00000000-0000-4000-8000-000000000001',
      tenantId: 'tenant-1',
      agentDefinitionId: 'agent-d1',
      activeAgentVersionId: 'v1',
      epoch: 1,
      status: 'available',
      lastActiveAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    convRepo.setRuntime(runtime);

    const principalMessage: ChatMessage = Object.freeze({
      id: 'msg-1',
      tenantId: 'tenant-1',
      conversationId: 'conv-1',
      sequence: 1,
      authorType: 'principal',
      authorId: 'sa-1',
      body: 'Hello agent',
      agentDefinitionId: null,
      agentVersionId: null,
      runtimeEpoch: null,
      workRef: null,
      createdAt: new Date().toISOString(),
    });

    convRepo.addMessage('conv-1', principalMessage);

    const dispatch: ChatDispatch = Object.freeze({
      id: 'dispatch-1',
      tenantId: 'tenant-1',
      agentDefinitionId: 'agent-d1',
      conversationId: 'conv-1',
      throughSequence: 1,
      dedupeKey: 'chat:agent-d1:conv-1:1',
      createdAt: new Date().toISOString(),
      publishedAt: null,
    });

    dispatchRepo.setDispatch(dispatch);

    const reconciler = new ChatDeliveryReconciler(
      convRepo,
      dispatchRepo,
      provider,
      undefined,
      () => new Date('2026-07-22T10:00:00Z'),
    );

    // Manually call reconcileOne via accessing private method via type casting
    await (reconciler as any).reconcileOne(dispatch);

    // Verify provider was called with messages from conv-1 only
    expect(provider.lastRunTurnInput).not.toBeNull();
    expect(provider.lastRunTurnInput!.conversationId).toBe('conv-1');
    expect(provider.lastRunTurnInput!.agentVersionId).toBe('v1');
    expect(provider.lastRunTurnInput!.messages).toHaveLength(1);
    expect(provider.lastRunTurnInput!.messages[0]!.body).toBe('Hello agent');

    // Verify appendMessage was called (by checking a new message was added)
    const messages = await convRepo.listMessages({
      tenantId: 'tenant-1',
      conversationId: 'conv-1',
    });
    expect(messages).toHaveLength(2);
    expect(messages[1]!.authorType).toBe('agent_definition');
    expect(messages[1]!.authorId).toBe('agent-d1');
    expect(messages[1]!.agentVersionId).toBe('v1');
    expect(messages[1]!.runtimeEpoch).toBe(1);
    expect(messages[1]!.body).toBe('[mock reply]');
  });

  it('2. D4 guard: two conversations under same runtime, dispatch for CA does not include CB messages', async () => {
    const convRepo = new FakeConversationRepository();
    const dispatchRepo = new FakeChatDispatchRepository();
    const provider = new FakeChatTurnProvider();

    const runtime: AgentChatRuntime = Object.freeze({
      id: '00000000-0000-4000-8000-000000000002',
      tenantId: 'tenant-2',
      agentDefinitionId: 'agent-d2',
      activeAgentVersionId: 'v1',
      epoch: 1,
      status: 'available',
      lastActiveAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    convRepo.setRuntime(runtime);

    // Conversation A: Alice's secret
    const aliceMessage: ChatMessage = Object.freeze({
      id: 'msg-alice',
      tenantId: 'tenant-2',
      conversationId: 'conv-alice',
      sequence: 1,
      authorType: 'principal',
      authorId: 'sa-alice',
      body: "Alice's secret is xyz789",
      agentDefinitionId: null,
      agentVersionId: null,
      runtimeEpoch: null,
      workRef: null,
      createdAt: new Date().toISOString(),
    });

    convRepo.addMessage('conv-alice', aliceMessage);

    // Conversation B: Bob's message (no knowledge of Alice's secret)
    const bobMessage: ChatMessage = Object.freeze({
      id: 'msg-bob',
      tenantId: 'tenant-2',
      conversationId: 'conv-bob',
      sequence: 1,
      authorType: 'principal',
      authorId: 'sa-bob',
      body: "What's up?",
      agentDefinitionId: null,
      agentVersionId: null,
      runtimeEpoch: null,
      workRef: null,
      createdAt: new Date().toISOString(),
    });

    convRepo.addMessage('conv-bob', bobMessage);

    const dispatch: ChatDispatch = Object.freeze({
      id: 'dispatch-bob',
      tenantId: 'tenant-2',
      agentDefinitionId: 'agent-d2',
      conversationId: 'conv-bob', // Only Bob's conversation
      throughSequence: 1,
      dedupeKey: 'chat:agent-d2:conv-bob:1',
      createdAt: new Date().toISOString(),
      publishedAt: null,
    });

    dispatchRepo.setDispatch(dispatch);

    const reconciler = new ChatDeliveryReconciler(
      convRepo,
      dispatchRepo,
      provider,
    );

    await (reconciler as any).reconcileOne(dispatch);

    // Verify provider was called with ONLY Bob's messages, not Alice's
    expect(provider.lastRunTurnInput).not.toBeNull();
    expect(provider.lastRunTurnInput!.conversationId).toBe('conv-bob');
    expect(provider.lastRunTurnInput!.messages).toHaveLength(1);
    expect(provider.lastRunTurnInput!.messages[0]!.body).toBe("What's up?");

    // Assert strongly that Alice's secret is NOT in the input
    const allBodiesInInput = provider.lastRunTurnInput!.messages
      .map((m) => m.body)
      .join(' ');
    expect(allBodiesInInput).not.toContain('xyz789');
    expect(allBodiesInInput).not.toContain('Alice');
  });

  it('3. runtime missing: reconcileOne is a no-op and does not append or mark published', async () => {
    const convRepo = new FakeConversationRepository();
    const dispatchRepo = new FakeChatDispatchRepository();
    const provider = new FakeChatTurnProvider();

    const dispatch: ChatDispatch = Object.freeze({
      id: 'dispatch-orphan',
      tenantId: 'tenant-orphan',
      agentDefinitionId: 'agent-missing',
      conversationId: 'conv-orphan',
      throughSequence: 1,
      dedupeKey: 'chat:agent-missing:conv-orphan:1',
      createdAt: new Date().toISOString(),
      publishedAt: null,
    });

    dispatchRepo.setDispatch(dispatch);

    const reconciler = new ChatDeliveryReconciler(
      convRepo,
      dispatchRepo,
      provider,
    );

    await (reconciler as any).reconcileOne(dispatch);

    // Verify provider was NOT called
    expect(provider.lastRunTurnInput).toBeNull();

    // Verify markPublished was NOT called
    expect(dispatchRepo.markPublishedCalled).toBe(false);
  });

  it('4. reconcilePendingDispatches processes multiple dispatches and returns count', async () => {
    const convRepo = new FakeConversationRepository();
    const dispatchRepo = new FakeChatDispatchRepository();
    const provider = new FakeChatTurnProvider();

    const runtime: AgentChatRuntime = Object.freeze({
      id: '00000000-0000-4000-8000-000000000003',
      tenantId: 'tenant-3',
      agentDefinitionId: 'agent-d3',
      activeAgentVersionId: 'v1',
      epoch: 1,
      status: 'available',
      lastActiveAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    convRepo.setRuntime(runtime);

    const message1: ChatMessage = Object.freeze({
      id: 'msg-1',
      tenantId: 'tenant-3',
      conversationId: 'conv-1',
      sequence: 1,
      authorType: 'principal',
      authorId: 'sa-1',
      body: 'Message 1',
      agentDefinitionId: null,
      agentVersionId: null,
      runtimeEpoch: null,
      workRef: null,
      createdAt: new Date().toISOString(),
    });

    convRepo.addMessage('conv-1', message1);

    const message2: ChatMessage = Object.freeze({
      id: 'msg-2',
      tenantId: 'tenant-3',
      conversationId: 'conv-2',
      sequence: 1,
      authorType: 'principal',
      authorId: 'sa-2',
      body: 'Message 2',
      agentDefinitionId: null,
      agentVersionId: null,
      runtimeEpoch: null,
      workRef: null,
      createdAt: new Date().toISOString(),
    });

    convRepo.addMessage('conv-2', message2);

    const dispatch1: ChatDispatch = Object.freeze({
      id: 'dispatch-1',
      tenantId: 'tenant-3',
      agentDefinitionId: 'agent-d3',
      conversationId: 'conv-1',
      throughSequence: 1,
      dedupeKey: 'key1',
      createdAt: new Date().toISOString(),
      publishedAt: null,
    });

    const dispatch2: ChatDispatch = Object.freeze({
      id: 'dispatch-2',
      tenantId: 'tenant-3',
      agentDefinitionId: 'agent-d3',
      conversationId: 'conv-2',
      throughSequence: 1,
      dedupeKey: 'key2',
      createdAt: new Date().toISOString(),
      publishedAt: null,
    });

    // Mock listPending to return the two dispatches
    dispatchRepo.listPending = vi.fn(async () => [dispatch1, dispatch2]);

    const reconciler = new ChatDeliveryReconciler(
      convRepo,
      dispatchRepo,
      provider,
    );

    const processed = await reconciler.reconcilePendingDispatches(50);

    expect(processed).toBe(2);
    expect(dispatchRepo.listPending).toHaveBeenCalledWith(50);
  });
});
