import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client, EventDispatcher, WSClient } from '@larksuiteoapi/node-sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  normalizeLarkEvent,
  createSingleConsumerLock,
  CARD_ACTION_WS_REQUIRES_REAL_SMOKE,
  createLarkCardCallbackResponse,
} from './normalize-lark-event.js';

async function fixture(name: string): Promise<unknown> {
  return JSON.parse(
    await readFile(resolve('tests/fixtures/lark', name), 'utf8'),
  ) as unknown;
}

function capturedEnvelope(raw: unknown): unknown {
  const value = raw as Record<string, unknown>;
  return {
    schema: '2.0',
    header: { event_id: value.event_id, event_type: value.event_type },
    event: value,
  };
}

describe('Lark SDK compatibility boundary', () => {
  it('imports the pinned SDK surface', () => {
    expect(Client).toBeDefined();
    expect(WSClient).toBeDefined();
    expect(EventDispatcher).toBeDefined();
  });

  it('normalizes message IDs, mentions, and tolerates unknown fields', async () => {
    const raw = await fixture('message-receive-v1.json');
    expect(
      (raw as { event: { message: { message_type: string } } }).event.message
        .message_type,
    ).toBe('text');
    const event = normalizeLarkEvent(raw);
    expect(event).toMatchObject({
      kind: 'message',
      providerEventId: 'evt_message_001',
      externalMessageId: 'om_message_001',
      chatId: 'oc_chat_001',
      rootId: 'om_root_001',
      threadId: 'omt_thread_001',
      replyToId: 'om_parent_001',
      senderId: 'ou_sender_001',
      text: 'hello bot',
      mentions: [{ openId: 'ou_bot_001', userId: 'user_bot_001' }],
    });
  });

  it('uses message_id as the deduplication key', async () => {
    const event = normalizeLarkEvent(await fixture('message-receive-v1.json'));
    expect(event.deduplicationKey).toBe('om_message_001');
    expect(event).not.toHaveProperty('token');
    expect(event).not.toHaveProperty('app_id');
    expect(event).not.toHaveProperty('tenant_key');
    expect(event).not.toHaveProperty('callback_token');
    expect(event).not.toHaveProperty('unknown_provider_field');
  });

  it('normalizes card operator, chat, and action callback input', async () => {
    const raw = await fixture('captured-card-action-trigger.json');
    const event = normalizeLarkEvent(capturedEnvelope(raw));
    expect(event).toMatchObject({
      kind: 'card_action',
      providerEventId: 'evt_card_placeholder',
      operatorId: 'ou_operator_placeholder',
      chatId: 'oc_chat_placeholder',
      cardMessageId: 'om_card_placeholder',
      action: {
        action: 'accept',
        token: 'opaque-token-placeholder',
      },
    });
    expect(event).not.toHaveProperty('token');
    expect(event).not.toHaveProperty('app_id');
    expect(event).not.toHaveProperty('tenant_key');
    expect(event).not.toHaveProperty('callback_token');
    expect(event).not.toHaveProperty('unknown_event_field');
  });

  it('returns the typed card callback response through the pinned dispatcher and WS ack', async () => {
    const raw = await fixture('captured-card-action-trigger.json');
    const envelope = capturedEnvelope(raw);
    const callback = createLarkCardCallbackResponse({
      toast: { type: 'success', content: 'accepted' },
    });
    const dispatcher = new EventDispatcher({});
    dispatcher.register({
      'card.action.trigger': () => {
        const event = normalizeLarkEvent(capturedEnvelope(raw));
        expect(event.kind).toBe('card_action');
        return callback;
      },
    });
    await expect(
      dispatcher.invoke(envelope, { needCheck: false }),
    ).resolves.toEqual(callback);

    const sent: unknown[] = [];
    const client = new WSClient({
      appId: 'cli_0123456789abcdef',
      appSecret: 'not-a-real-secret',
      autoReconnect: false,
    });
    (client as any).sendMessage = (frame: unknown) => sent.push(frame);
    (client as any).eventDispatcher = dispatcher;
    const invoke = (client as any).handleEventData({
      headers: [
        { key: 'type', value: 'event' },
        { key: 'message_id', value: 'message-card-1' },
        { key: 'sum', value: '1' },
        { key: 'seq', value: '0' },
        { key: 'trace_id', value: 'trace-card-1' },
      ],
      payload: new TextEncoder().encode(JSON.stringify(envelope)),
      method: 1,
    });
    await invoke;
    const ack = sent[0] as { payload: Uint8Array };
    const ackPayload = JSON.parse(new TextDecoder().decode(ack.payload)) as {
      data?: string;
    };
    expect(
      JSON.parse(Buffer.from(ackPayload.data!, 'base64').toString()),
    ).toEqual(callback);
    client.close();
  });

  it('does not acknowledge a blocked durable handler in the pinned SDK WS path', async () => {
    let release!: () => void;
    const committed = new Promise<void>((resolveCommit) => {
      release = resolveCommit;
    });
    const dispatcher = new EventDispatcher({});
    dispatcher.register({
      async ['im.message.receive_v1']() {
        await committed;
        return { committed: true };
      },
    });
    const sent: unknown[] = [];
    const client = new WSClient({
      appId: 'cli_0123456789abcdef',
      appSecret: 'not-a-real-secret',
      autoReconnect: false,
    });
    (client as any).sendMessage = (frame: unknown) => sent.push(frame);
    (client as any).eventDispatcher = dispatcher;
    const invoke = (client as any).handleEventData({
      headers: [
        { key: 'type', value: 'event' },
        { key: 'message_id', value: 'message-1' },
        { key: 'sum', value: '1' },
        { key: 'seq', value: '0' },
        { key: 'trace_id', value: 'trace-1' },
      ],
      payload: new TextEncoder().encode(
        JSON.stringify(await fixture('message-receive-v1.json')),
      ),
      method: 1,
    });
    await Promise.resolve();
    expect(sent).toHaveLength(0);
    release();
    await invoke;
    expect(sent).toHaveLength(1);
    const ack = sent[0] as { payload: Uint8Array };
    const ackPayload = JSON.parse(new TextDecoder().decode(ack.payload)) as {
      data?: string;
    };
    expect(
      JSON.parse(Buffer.from(ackPayload.data!, 'base64').toString()),
    ).toEqual({
      committed: true,
    });
    client.close();
  });

  it('records that card action WS delivery still needs real agent-test smoke', () => {
    expect(CARD_ACTION_WS_REQUIRES_REAL_SMOKE).toBe(true);
  });

  it('allows only one process-local consumer and closes gracefully', async () => {
    const lock = createSingleConsumerLock();
    const first = lock.acquire();
    expect(() => lock.acquire()).toThrow();
    first.release();
    expect(() => lock.acquire()).not.toThrow();
    lock.close();
    expect(() => lock.acquire()).toThrow();
  });

  it('shares one lock per App/connection key and protects newer owners from stale release', () => {
    const firstHandle = createSingleConsumerLock('app-fixed/connection-fixed');
    const secondHandle = createSingleConsumerLock('app-fixed/connection-fixed');
    const first = firstHandle.acquire();
    expect(() => secondHandle.acquire()).toThrow();
    first.release();
    const second = secondHandle.acquire();
    first.release();
    expect(() =>
      createSingleConsumerLock('app-fixed/connection-fixed').acquire(),
    ).toThrow();
    second.release();
    second.release();
    expect(() => firstHandle.acquire()).not.toThrow();
    firstHandle.close();
    secondHandle.close();
  });

  it.each(['image', 'post', 'file'])(
    'rejects %s messages before parsing content',
    (messageType) => {
      expect(() =>
        normalizeLarkEvent({
          header: {
            event_id: 'evt-unsupported',
            event_type: 'im.message.receive_v1',
          },
          event: {
            message: {
              message_id: 'msg-unsupported',
              chat_id: 'chat',
              message_type: messageType,
              content: '{not-json',
            },
            sender: { sender_id: { open_id: 'sender' } },
          },
        }),
      ).toThrow(`unsupported message type ${messageType}`);
    },
  );

  it('rejects arbitrary and oversized card callback content', () => {
    expect(() => createLarkCardCallbackResponse({ arbitrary: true })).toThrow();
    expect(() =>
      createLarkCardCallbackResponse({
        toast: { type: 'success', content: 'x'.repeat(257) },
      }),
    ).toThrow();
  });

  it('rejects envelopes without required provider identifiers and bounded fields', () => {
    expect(() =>
      normalizeLarkEvent({
        header: { event_type: 'im.message.receive_v1' },
        event: {},
      }),
    ).toThrow();
    expect(() =>
      normalizeLarkEvent({
        header: { event_id: 'evt', event_type: 'im.message.receive_v1' },
        event: {
          message: {
            message_id: 'msg',
            chat_id: 'chat',
            message_type: 'text',
            content: JSON.stringify({ text: 'x'.repeat(8193) }),
          },
          sender: { sender_id: { open_id: 'sender' } },
        },
      }),
    ).toThrow();
    expect(() =>
      normalizeLarkEvent({
        header: { event_id: 'evt', event_type: 'card.action.trigger' },
        event: {
          operator: { operator_id: { open_id: 'operator' } },
          context: { open_chat_id: 'chat', open_message_id: 'message' },
          action: { value: { action: 'x'.repeat(8193) } },
        },
      }),
    ).toThrow();
  });

  it('proves the pinned WS lifecycle surface and graceful reconnect cancellation', () => {
    vi.useFakeTimers();
    expect(typeof WSClient.prototype.start).toBe('function');
    expect(typeof WSClient.prototype.close).toBe('function');
    expect(typeof (WSClient.prototype as any).reConnect).toBe('function');
    const client = new WSClient({
      appId: 'cli_0123456789abcdef',
      appSecret: 'not-a-real-secret',
    });
    const callback = vi.fn();
    (client as any).onReconnecting = callback;
    (client as any).reconnectInterval = setTimeout(callback, 1_000);
    client.close();
    vi.runAllTimers();
    expect(callback).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('anchors acknowledgement and lifecycle claims to the installed 1.71.1 bundle', async () => {
    const source = await readFile(
      resolve('node_modules/@larksuiteoapi/node-sdk/lib/index.js'),
      'utf8',
    );
    const eventHandler = source.slice(
      source.indexOf('handleEventData(data)'),
      source.indexOf(
        'sendMessage(data)',
        source.indexOf('handleEventData(data)'),
      ),
    );
    expect(eventHandler).toContain('yield ((_a = this.eventDispatcher)');
    expect(eventHandler).toContain(
      'respPayload.data = Buffer.from(JSON.stringify(result)).toString("base64")',
    );
    expect(eventHandler).toContain('this.sendMessage(Object.assign');
    expect(source).toContain('this.onReconnecting = onReconnecting');
    expect(source).toContain(
      "safeInvoke('onReconnecting', this.onReconnecting)",
    );
    expect(source).toContain("safeInvoke('onReconnected', this.onReconnected)");
    expect(source).toContain('clearTimeout(this.reconnectInterval)');
  });
});
