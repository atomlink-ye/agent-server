import { expect, it, vi } from 'vitest';

import { materializeChatDeliveryFailure } from './materialize-chat-delivery-failure.js';

it('materializes an idempotent safe reply for a terminal delivery failure', async () => {
  const appendMessage = vi.fn(async () => ({}) as never);
  await materializeChatDeliveryFailure(
    { appendMessage },
    {
      dispatchId: 'dispatch-7',
      tenantId: 'tenant-a',
      conversationId: 'conversation-a',
      agentDefinitionId: 'agent-a',
      throughSequence: 8,
    },
  );

  expect(appendMessage).toHaveBeenCalledWith({
    author: expect.objectContaining({
      type: 'agent_definition',
      tenantId: 'tenant-a',
      conversationId: 'conversation-a',
      agentDefinitionId: 'agent-a',
      provider: null,
      turnMetadata: {
        kind: 'chat_activation_failure',
        dispatchId: 'dispatch-7',
        throughSequence: 8,
      },
    }),
    body: expect.stringContaining('execution service became unavailable'),
    deliveryId: 'chat-reply-failure:dispatch-7',
  });
  expect(JSON.stringify(appendMessage.mock.calls)).not.toContain(
    'RuntimeTurnExecutionError',
  );
});
