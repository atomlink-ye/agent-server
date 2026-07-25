import { Domain, EventDispatcher } from '@larksuiteoapi/node-sdk';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  createLarkWebsocketReceiver,
  larkWebsocketDomain,
} from './lark-websocket-receiver.js';
import type { LarkCanaryEnabledConfig } from '../../shared/config.js';
import type { ChannelIngress } from '../../domain/channels/channel-event.js';

const config: LarkCanaryEnabledConfig = {
  enabled: true,
  connectionKey: 'connection-1',
  appId: 'cli_0123456789abcdef',
  domain: 'feishu',
  appSecret: 'secret',
  botOpenId: 'ou_bot_001',
  allowedChatId: 'chat',
  allowedOpenId: 'user',
  tenantId: 'tenant',
  workspaceId: 'workspace',
  serviceAccountId: 'service-account',
  publishedAgentVersionId: 'agent-version',
  policyVersion: 'policy',
};

const raw = {
  schema: '2.0',
  header: { event_id: 'event-1', event_type: 'im.message.receive_v1' },
  event: {
    message: {
      message_id: 'message-1',
      chat_id: 'chat',
      message_type: 'text',
      content: JSON.stringify({ text: 'hello' }),
      root_id: 'root-1',
      thread_id: 'thread-1',
      parent_id: 'parent-1',
      mentions: [{ id: { open_id: 'ou_bot_001', user_id: 'bot' } }],
    },
    sender: { sender_id: { open_id: 'user' } },
  },
};

function fakeClient() {
  let dispatcher!: EventDispatcher;
  return {
    client: {
      start: vi.fn(async (input: { eventDispatcher: EventDispatcher }) => {
        dispatcher = input.eventDispatcher;
      }),
      close: vi.fn(),
    },
    dispatch: async (event: unknown) =>
      dispatcher.invoke(
        typeof event === 'object' && event !== null && 'event_type' in event
          ? {
              event: {
                type: (event as Record<string, unknown>).event_type,
                ...event,
              },
            }
          : event,
        { needCheck: false },
      ),
  };
}

describe('Lark websocket receiver', () => {
  it.each([
    ['feishu', Domain.Feishu],
    ['lark', Domain.Lark],
  ] as const)('maps %s to the SDK domain enum', (configured, expected) => {
    expect(larkWebsocketDomain(configured)).toBe(expected);
  });

  it('persists a normalized message before the low-level handler resolves', async () => {
    const transport = fakeClient();
    const insertIngress = vi.fn().mockResolvedValue({
      record: {} as ChannelIngress,
      inserted: true,
    });
    const receiver = createLarkWebsocketReceiver({
      config,
      repository: { insertIngress },
      clientFactory: () => transport.client,
      idFactory: () => 'ingress-1',
    });

    await receiver.start();
    await transport.dispatch(raw);

    expect(insertIngress).toHaveBeenCalledWith({
      id: 'ingress-1',
      connectionKey: 'connection-1',
      kind: 'message',
      externalKey: 'message-1',
      providerEventId: 'event-1',
      externalMessageId: 'message-1',
      chatId: 'chat',
      rootMessageId: 'root-1',
      threadId: 'thread-1',
      replyToId: 'parent-1',
      externalActorId: 'user',
      botMentionVerified: true,
      text: 'hello',
      normalizationVersion: 'lark-message-v1',
    });
    await receiver.stop();
    expect(transport.client.close).toHaveBeenCalledOnce();
  });

  it('commits a command before acknowledging the provider event', async () => {
    const transport = fakeClient();
    let release!: () => void;
    const inserted = new Promise<void>((resolve) => (release = resolve));
    const insertIngress = vi.fn().mockImplementation(async () => {
      await inserted;
      return { record: {} as ChannelIngress, inserted: true };
    });
    const receiver = createLarkWebsocketReceiver({
      config,
      repository: { insertIngress },
      clientFactory: () => transport.client,
      idFactory: () => 'command-ingress',
    });
    await receiver.start();
    const command = structuredClone(raw);
    command.event.message.content = JSON.stringify({
      text: 'bot /memory reject 123e4567-e89b-12d3-a456-426614174000',
    });
    command.event.message.mentions = [
      { id: { open_id: 'ou_bot_001', user_id: 'bot' }, name: 'bot' } as any,
    ];
    let settled = false;
    const dispatch = transport.dispatch(command).then(() => (settled = true));
    await Promise.resolve();
    expect(insertIngress).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'command' }),
    );
    expect(settled).toBe(false);
    release();
    await dispatch;
    await receiver.stop();
  });

  it('registers Card callbacks and commits card ingress before acknowledgement', async () => {
    const transport = fakeClient();
    let release!: () => void;
    const committed = new Promise<void>((resolve) => (release = resolve));
    const insertIngress = vi.fn().mockImplementation(async () => {
      await committed;
      return { record: {} as ChannelIngress, inserted: true };
    });
    const receiver = createLarkWebsocketReceiver({
      config,
      repository: { insertIngress },
      clientFactory: () => transport.client,
      idFactory: () => 'card-ingress',
    });
    await receiver.start();
    const callback = transport.dispatch({
      schema: '2.0',
      header: { event_id: 'card-event', event_type: 'card.action.trigger' },
      event: {
        operator: { operator_id: { open_id: 'operator' } },
        action: { tag: 'button', value: '{"action":"accept","token":"t"}' },
        context: { open_chat_id: 'chat', open_message_id: 'card-message' },
        card: { type: 'template' },
      },
    });
    await vi.waitFor(() => expect(insertIngress).toHaveBeenCalled(), {
      timeout: 1000,
    });
    expect(insertIngress).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'card_action',
        externalKey: expect.any(String),
        externalMessageId: 'card-message',
        externalActorId: 'operator',
        action: {
          action: 'accept',
          digest:
            'e3b98a4da31a127d4bde6e43033f66ba274cab0eb7eb1c70ec41402bf6273dd8',
        },
      }),
    );
    let acknowledged = false;
    void callback.then(() => (acknowledged = true));
    await Promise.resolve();
    expect(acknowledged).toBe(false);
    release();
    await expect(callback).resolves.toEqual({
      toast: { type: 'success', content: 'Received' },
    });
    await receiver.stop();
  });

  it('uses distinct bounded identities for different clicks and replays exactly', async () => {
    const transport = fakeClient();
    const insertIngress = vi.fn().mockResolvedValue({
      record: {} as ChannelIngress,
      inserted: true,
    });
    const receiver = createLarkWebsocketReceiver({
      config,
      repository: { insertIngress },
      clientFactory: () => transport.client,
      idFactory: () => 'card-ingress',
    });
    await receiver.start();
    const event = (action: string, token: string) => ({
      schema: '2.0',
      header: {
        event_id: `provider-${action}`,
        event_type: 'card.action.trigger',
      },
      event: {
        operator: { open_id: 'operator' },
        action: {
          action_tag: 'button',
          value: JSON.stringify({ action, token }),
        },
        context: { open_chat_id: 'chat', open_message_id: 'card-message' },
      },
    });
    await transport.dispatch(event('accept', 'token-a'));
    await transport.dispatch(event('reject', 'token-b'));
    await transport.dispatch(event('accept', 'token-a'));
    expect(insertIngress).toHaveBeenCalledTimes(3);
    expect(insertIngress.mock.calls[0]![0].externalKey).not.toBe(
      insertIngress.mock.calls[1]![0].externalKey,
    );
    expect(insertIngress.mock.calls[0]![0].externalKey).toBe(
      insertIngress.mock.calls[2]![0].externalKey,
    );
    expect(insertIngress.mock.calls[0]![0].action).not.toEqual({
      action: 'accept',
      token: 'token-a',
    });
    await receiver.stop();
  });

  it('dispatches the flattened captured SDK callback at the production boundary', async () => {
    const transport = fakeClient();
    const insertIngress = vi
      .fn()
      .mockResolvedValue({ record: {} as ChannelIngress, inserted: true });
    const receiver = createLarkWebsocketReceiver({
      config,
      repository: { insertIngress },
      clientFactory: () => transport.client,
      idFactory: () => 'captured-card-ingress',
    });
    await receiver.start();
    const captured = JSON.parse(
      await readFile(
        resolve('tests/fixtures/lark/captured-card-action-trigger.json'),
        'utf8',
      ),
    ) as Record<string, unknown>;
    await transport.dispatch(captured);
    expect(insertIngress).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'card_action',
        externalMessageId: 'om_card_placeholder',
        externalActorId: 'ou_operator_placeholder',
        action: expect.objectContaining({
          action: 'accept',
          digest: expect.any(String),
        }),
      }),
    );
    const persisted = insertIngress.mock.calls[0]![0];
    expect(persisted).not.toHaveProperty('card');
    expect(persisted).not.toHaveProperty('create_time');
    await receiver.stop();
  });

  it('converges duplicate delivery and holds one process-local connection lock', async () => {
    const firstTransport = fakeClient();
    const secondTransport = fakeClient();
    const repository = {
      insertIngress: vi.fn().mockResolvedValue({
        record: {} as ChannelIngress,
        inserted: false,
      }),
    };
    const first = createLarkWebsocketReceiver({
      config,
      repository,
      clientFactory: () => firstTransport.client,
      idFactory: () => 'ingress-1',
    });
    const second = createLarkWebsocketReceiver({
      config,
      repository,
      clientFactory: () => secondTransport.client,
    });

    await first.start();
    await expect(second.start()).rejects.toThrow('another consumer');
    await firstTransport.dispatch(raw);
    await firstTransport.dispatch(raw);
    expect(repository.insertIngress).toHaveBeenCalledTimes(2);
    await first.stop();
    await second.start();
    await second.stop();
  });

  it('closes a client when startup fails and releases the connection lock', async () => {
    const failedClient = fakeClient();
    failedClient.client.start.mockRejectedValueOnce(
      new Error('network secret'),
    );
    const receiver = createLarkWebsocketReceiver({
      config,
      repository: { insertIngress: vi.fn() },
      clientFactory: () => failedClient.client,
    });

    await expect(receiver.start()).rejects.toThrow('network secret');
    expect(failedClient.client.close).toHaveBeenCalledOnce();

    const replacement = fakeClient();
    const replacementReceiver = createLarkWebsocketReceiver({
      config,
      repository: { insertIngress: vi.fn() },
      clientFactory: () => replacement.client,
    });
    await expect(replacementReceiver.start()).resolves.toBeUndefined();
    await replacementReceiver.stop();
  });
});
