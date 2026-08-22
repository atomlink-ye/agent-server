import { describe, expect, it } from 'vitest';

import { MaterializeChatReply } from './materialize-chat-reply.js';

describe('MaterializeChatReply', () => {
  it('advances the watermark only after the durable reply is appended', async () => {
    const events: string[] = [];
    const materialize = new MaterializeChatReply(
      {
        async appendMessage(input: any) {
          events.push(`append:${input.deliveryId}`);
          return { id: 'reply-message', sequence: 5 } as any;
        },
      },
      {
        async advanceRuntimeWatermark(input: any) {
          events.push(`watermark:${input.throughSequence}`);
          return input.throughSequence;
        },
      },
    );

    const result = await materialize.execute(context(), {
      body: 'done',
      provider: 'scripted',
      mode: 'delta',
    });

    expect(events).toEqual(['append:chat-reply:dispatch-7', 'watermark:4']);
    expect(result.watermark).toBe(4);
  });

  it('does not advance the watermark when reply materialization fails', async () => {
    let watermarkCalls = 0;
    const materialize = new MaterializeChatReply(
      {
        async appendMessage() {
          throw new Error('durable append failed');
        },
      },
      {
        async advanceRuntimeWatermark() {
          watermarkCalls += 1;
          return 4;
        },
      },
    );

    await expect(
      materialize.execute(context(), {
        body: 'must not consume',
        provider: 'scripted',
        mode: 'delta',
      }),
    ).rejects.toThrow('durable append failed');
    expect(watermarkCalls).toBe(0);
  });
});

function context() {
  return {
    dispatch: {
      id: 'dispatch-7',
      tenantId: 'tenant-n2',
      agentDefinitionId: 'agent-n2',
      conversationId: 'conversation-n2',
      throughSequence: 4,
      dedupeKey: 'cause-4',
      causes: [],
      createdAt: '2026-08-22T00:00:00.000Z',
      publishedAt: null,
    },
    runtime: {
      id: 'runtime-n2',
      tenantId: 'tenant-n2',
      agentDefinitionId: 'agent-n2',
      activeAgentVersionId: 'version-n2',
      epoch: 2,
      status: 'available',
      lastActiveAt: null,
      createdAt: '2026-08-22T00:00:00.000Z',
      updatedAt: '2026-08-22T00:00:00.000Z',
    },
    watermark: 2,
    turn: {
      modeHint: 'delta',
      fromSequenceExclusive: 2,
      throughSequence: 4,
    },
    triggerMessage: {
      id: 'trigger-4',
      tenantId: 'tenant-n2',
      conversationId: 'conversation-n2',
      sequence: 4,
      authorType: 'principal',
      authorId: 'principal-n2',
      body: 'continue',
      agentDefinitionId: null,
      agentVersionId: null,
      runtimeEpoch: null,
      provider: null,
      workRef: null,
      deliveryId: null,
      createdAt: '2026-08-22T00:00:04.000Z',
    },
    messages: [],
    recoveryMessages: [],
    workEntitlement: null,
  } as any;
}
