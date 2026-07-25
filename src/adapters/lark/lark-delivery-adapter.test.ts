import { describe, expect, it, vi } from 'vitest';
import { createLarkDeliveryAdapter } from './lark-delivery-adapter.js';

const config = {
  enabled: true as const,
  connectionKey: 'connection',
  appId: 'app',
  appSecret: 'secret',
  domain: 'feishu' as const,
  botOpenId: 'bot',
  allowedChatId: 'chat',
  allowedOpenId: 'user',
  tenantId: 'tenant',
  workspaceId: 'workspace',
  serviceAccountId: 'service',
  publishedAgentVersionId: 'agent',
  policyVersion: 'policy',
};

describe('LarkDeliveryAdapter', () => {
  it('replies in the target thread with exact text content and stable uuid', async () => {
    const reply = vi.fn().mockResolvedValue({
      code: 0,
      data: { message_id: 'provider-message-1' },
    });
    const adapter = createLarkDeliveryAdapter(config, () => ({
      im: { message: { reply } },
    }));

    await expect(
      adapter.deliver({
        kind: 'text',
        targetId: 'target-1',
        text: 'hello',
        providerRequestId: 'request-1',
      }),
    ).resolves.toEqual({
      result: 'delivered',
      providerMessageId: 'provider-message-1',
    });
    expect(reply).toHaveBeenCalledWith({
      path: { message_id: 'target-1' },
      data: {
        msg_type: 'text',
        content: JSON.stringify({ text: 'hello' }),
        reply_in_thread: true,
        uuid: 'request-1',
      },
    });
  });

  it('replies with an interactive Card', async () => {
    const reply = vi.fn().mockResolvedValue({
      code: 0,
      data: { message_id: 'card-message' },
    });
    const adapter = createLarkDeliveryAdapter(config, () => ({
      im: { message: { reply } },
    }));
    await expect(
      adapter.deliver({
        kind: 'card_reply',
        targetId: 'source-message',
        cardJson: '{"schema":"2.0"}',
        providerRequestId: 'request-1',
      }),
    ).resolves.toEqual({
      result: 'delivered',
      providerMessageId: 'card-message',
    });
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          msg_type: 'interactive',
          content: '{"schema":"2.0"}',
          reply_in_thread: true,
          uuid: 'request-1',
        }),
      }),
    );
  });

  it.each([{ code: 0 }, { code: 0, data: {} }])(
    'does not mark a Card reply without a provider message ID as delivered',
    async (response) => {
      const reply = vi.fn().mockResolvedValue(response);
      const adapter = createLarkDeliveryAdapter(config, () => ({
        im: { message: { reply } },
      }));
      await expect(
        adapter.deliver({
          kind: 'card_reply',
          targetId: 'source-message',
          cardJson: '{"schema":"2.0"}',
          providerRequestId: 'request',
        }),
      ).resolves.toEqual({
        result: 'unknown',
        safeErrorCode: 'invalid_provider_response',
      });
    },
  );

  it('does not accept an empty provider message ID for replies', async () => {
    const adapter = createLarkDeliveryAdapter(config, () => ({
      im: {
        message: {
          reply: vi
            .fn()
            .mockResolvedValue({ code: 0, data: { message_id: '' } }),
        },
      },
    }));
    await expect(
      adapter.deliver({
        kind: 'text',
        targetId: 'target',
        text: 'text',
        providerRequestId: 'request',
      }),
    ).resolves.toEqual({
      result: 'unknown',
      safeErrorCode: 'invalid_provider_response',
    });
  });

  it('patches a complete Card without inventing a provider message ID', async () => {
    const patch = vi.fn().mockResolvedValue({ code: 0 });
    const adapter = createLarkDeliveryAdapter(config, () => ({
      im: { message: { reply: vi.fn(), patch } },
    }));
    await expect(
      adapter.deliver({
        kind: 'card_patch',
        targetId: 'card-message',
        cardJson: '{"schema":"2.0","body":[]}',
        providerRequestId: 'request-1',
      }),
    ).resolves.toEqual({ result: 'delivered' });
    expect(patch).toHaveBeenCalledWith({
      path: { message_id: 'card-message' },
      data: { content: '{"schema":"2.0","body":[]}' },
    });
  });

  it.each([{ code: 0, data: {} }, { code: 0 }])(
    'treats successful patch response without a message ID as delivered',
    async (response) => {
      const patch = vi.fn().mockResolvedValue(response);
      const adapter = createLarkDeliveryAdapter(config, () => ({
        im: { message: { reply: vi.fn(), patch } },
      }));
      await expect(
        adapter.deliver({
          kind: 'card_patch',
          targetId: 'card-message',
          cardJson: '{"schema":"2.0"}',
          providerRequestId: 'request',
        }),
      ).resolves.toEqual({ result: 'delivered' });
    },
  );

  it.each([230020, 230049])('maps provider retry code %s', async (code) => {
    const adapter = createLarkDeliveryAdapter(config, () => ({
      im: { message: { reply: vi.fn().mockResolvedValue({ code }) } },
    }));
    await expect(
      adapter.deliver({
        kind: 'text',
        targetId: 'target',
        text: 'text',
        providerRequestId: 'request',
      }),
    ).resolves.toEqual({
      result: 'retryable_failure',
      safeErrorCode: `provider_${code}`,
    });
  });

  it('maps permanent provider failures and unknown transport failures without raw errors', async () => {
    const permanent = createLarkDeliveryAdapter(config, () => ({
      im: { message: { reply: vi.fn().mockResolvedValue({ code: 999999 }) } },
    }));
    await expect(
      permanent.deliver({
        kind: 'text',
        targetId: 'target',
        text: 'text',
        providerRequestId: 'request',
      }),
    ).resolves.toEqual({
      result: 'permanent_failure',
      safeErrorCode: 'provider_rejected',
    });
    const unknown = createLarkDeliveryAdapter(config, () => ({
      im: {
        message: {
          reply: vi.fn().mockRejectedValue(new Error('secret transport')),
        },
      },
    }));
    await expect(
      unknown.deliver({
        kind: 'text',
        targetId: 'target',
        text: 'text',
        providerRequestId: 'request',
      }),
    ).resolves.toEqual({
      result: 'unknown',
      safeErrorCode: 'transport_unknown',
    });
  });

  it.each([429, 500, 503])('maps HTTP %s as retryable', async (statusCode) => {
    const adapter = createLarkDeliveryAdapter(config, () => ({
      im: { message: { reply: vi.fn().mockRejectedValue({ statusCode }) } },
    }));
    await expect(
      adapter.deliver({
        kind: 'text',
        targetId: 'target',
        text: 'text',
        providerRequestId: 'request',
      }),
    ).resolves.toEqual({
      result: 'retryable_failure',
      safeErrorCode: `http_${statusCode}`,
    });
  });
});
