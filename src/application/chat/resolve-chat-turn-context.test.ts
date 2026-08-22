import { describe, expect, it } from 'vitest';

import type { ChatMessage } from '../../domain/chat/chat-message.js';
import { ResolveChatTurnContext } from './resolve-chat-turn-context.js';

const runtime = {
  id: '00000000-0000-4000-8000-00000000c101',
  tenantId: 'tenant-n2',
  agentDefinitionId: 'agent-n2',
  activeAgentVersionId: 'version-n2',
  epoch: 3,
  status: 'available' as const,
  lastActiveAt: null,
  createdAt: '2026-08-22T00:00:00.000Z',
  updatedAt: '2026-08-22T00:00:00.000Z',
};

const messages: ChatMessage[] = [
  message(1, 'principal', 'principal-n2', 'old question'),
  message(2, 'agent_definition', 'agent-n2', 'old answer', {
    deliveryId: 'chat-reply:old',
  }),
  message(3, 'principal', 'principal-n2', 'new user delta'),
  message(4, 'agent_definition', 'agent-n2', 'Work W-1 completed', {
    deliveryId: 'wake-1',
    workRef: 'W-1',
  }),
];

describe('ResolveChatTurnContext', () => {
  it('selects only unconsumed durable delta events and keeps a bounded recovery snapshot', async () => {
    const resolver = new ResolveChatTurnContext(
      conversations(),
      { getRuntimeWatermark: async () => 2 },
      undefined,
      undefined,
      50,
    );

    const context = await resolver.execute(dispatch(4));

    expect(context?.turn).toEqual({
      modeHint: 'delta',
      fromSequenceExclusive: 2,
      throughSequence: 4,
    });
    expect(context?.messages.map((item) => item.sequence)).toEqual([3, 4]);
    expect(context?.recoveryMessages.map((item) => item.sequence)).toEqual([
      1, 2, 3, 4,
    ]);
    expect(context?.actor).toEqual({ type: 'service_account', id: 'principal-n2' });
  });

  it('starts a new epoch in bootstrap mode and never consumes beyond through-sequence', async () => {
    const resolver = new ResolveChatTurnContext(
      conversations([...messages, message(5, 'principal', 'principal-n2', 'future')]),
      { getRuntimeWatermark: async () => 0 },
    );

    const context = await resolver.execute(dispatch(4));

    expect(context?.turn.modeHint).toBe('bootstrap');
    expect(context?.messages.map((item) => item.sequence)).toEqual([1, 3, 4]);
    expect(context?.recoveryMessages.at(-1)?.sequence).toBe(4);
  });

  it('does not execute an activation already covered by the durable watermark', async () => {
    const resolver = new ResolveChatTurnContext(conversations(), {
      getRuntimeWatermark: async () => 4,
    });
    await expect(resolver.execute(dispatch(4))).resolves.toBeNull();
  });
});

function conversations(source: readonly ChatMessage[] = messages) {
  return {
    async getChatRuntime() {
      return runtime;
    },
    async listMessages(input: { afterSequence?: number }) {
      return source.filter((item) => item.sequence > (input.afterSequence ?? 0));
    },
    async findPrincipalMember(input: { principalId: string }) {
      return {
        memberId: input.principalId,
        memberType: 'principal' as const,
        memberPrincipalType: 'service_account' as const,
      };
    },
  } as any;
}

function dispatch(throughSequence: number) {
  return {
    id: '17',
    tenantId: 'tenant-n2',
    agentDefinitionId: 'agent-n2',
    conversationId: '00000000-0000-4000-8000-00000000c201',
    throughSequence,
    dedupeKey: `cause-${throughSequence}`,
    createdAt: '2026-08-22T00:00:00.000Z',
    publishedAt: null,
  } as const;
}

function message(
  sequence: number,
  authorType: 'principal' | 'agent_definition',
  authorId: string,
  body: string,
  extra: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    id: `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
    tenantId: 'tenant-n2',
    conversationId: '00000000-0000-4000-8000-00000000c201',
    sequence,
    authorType,
    authorId,
    body,
    agentDefinitionId: authorType === 'agent_definition' ? 'agent-n2' : null,
    agentVersionId: authorType === 'agent_definition' ? 'version-n2' : null,
    runtimeEpoch: authorType === 'agent_definition' ? 3 : null,
    provider: null,
    workRef: null,
    deliveryId: null,
    createdAt: `2026-08-22T00:00:0${sequence}.000Z`,
    ...extra,
  };
}
