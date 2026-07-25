import { describe, expect, it } from 'vitest';
import { normalizeLarkEvent } from './normalize-lark-event.js';
import { MAX_CARD_ACTION_TOKEN_BYTES } from './normalize-lark-event.js';

const base = {
  header: { event_id: 'event-card', event_type: 'card.action.trigger' },
  event: {
    operator: { operator_id: { open_id: 'operator' } },
    action: { tag: 'button', value: '{"action":"accept","token":"token"}' },
    context: { open_chat_id: 'chat', open_message_id: 'message' },
    card: { content: 'must not be retained' },
  },
};

describe('Lark card action normalization', () => {
  it('normalizes the bounded action and opaque token only', () => {
    expect(normalizeLarkEvent(base)).toEqual({
      kind: 'card_action',
      providerEventId: 'event-card',
      deduplicationKey: 'event-card',
      operatorId: 'operator',
      chatId: 'chat',
      cardMessageId: 'message',
      action: { action: 'accept', token: 'token' },
    });
  });

  it.each([
    ['malformed JSON', '{bad'],
    ['unknown action', '{"action":"approve","token":"token"}'],
    ['blank token', '{"action":"reject","token":" "}'],
    ['extra field', '{"action":"reject","token":"token","id":"x"}'],
  ])('rejects %s', (_label, value) => {
    const input = structuredClone(base);
    input.event.action.value = value;
    expect(() => normalizeLarkEvent(input)).toThrow('invalid Lark card action');
  });

  it('rejects non-button actions, missing IDs, and oversized tokens', () => {
    const nonButton = structuredClone(base);
    nonButton.event.action.tag = 'select_static';
    expect(() => normalizeLarkEvent(nonButton)).toThrow();
    const missingId = structuredClone(base);
    (missingId.event.context as Record<string, unknown>).open_message_id =
      undefined;
    expect(() => normalizeLarkEvent(missingId)).toThrow();
    const oversized = structuredClone(base);
    oversized.event.action.value = JSON.stringify({
      action: 'accept',
      token: 'x'.repeat(2049),
    });
    expect(() => normalizeLarkEvent(oversized)).toThrow();
  });

  it('uses the renderer callback-token UTF-8 byte bound exactly', () => {
    const exact = structuredClone(base);
    exact.event.action.value = JSON.stringify({
      action: 'accept',
      token: 'é'.repeat(Math.floor(MAX_CARD_ACTION_TOKEN_BYTES / 2)),
    });
    expect(() => normalizeLarkEvent(exact)).not.toThrow();
    const over = structuredClone(base);
    over.event.action.value = JSON.stringify({
      action: 'accept',
      token: 'é'.repeat(Math.floor(MAX_CARD_ACTION_TOKEN_BYTES / 2) + 1),
    });
    expect(() => normalizeLarkEvent(over)).toThrow();
  });

  it.each([
    [
      'provider event',
      (input: typeof base, value: string) => {
        input.header.event_id = value;
      },
    ],
    [
      'operator ID',
      (input: typeof base, value: string) => {
        input.event.operator.operator_id.open_id = value;
      },
    ],
    [
      'chat ID',
      (input: typeof base, value: string) => {
        input.event.context.open_chat_id = value;
      },
    ],
    [
      'Card message ID',
      (input: typeof base, value: string) => {
        input.event.context.open_message_id = value;
      },
    ],
  ])('rejects %s over the 512-byte identifier bound', (_label, mutate) => {
    const input = structuredClone(base);
    mutate(input, 'é'.repeat(257));
    expect(() => normalizeLarkEvent(input)).toThrow();
  });

  it('accepts a multibyte identifier at exactly 512 UTF-8 bytes', () => {
    const input = structuredClone(base);
    input.event.context.open_chat_id = 'é'.repeat(256);
    expect(() => normalizeLarkEvent(input)).not.toThrow();
  });
});
