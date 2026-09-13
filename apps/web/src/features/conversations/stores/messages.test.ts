import { expect, it } from 'vitest';

import type { ChatMessage, ConversationId } from '../contracts';
import { createMessagesStore } from './messages';

const conversationId = '11111111-1111-4111-8111-111111111111' as ConversationId;

it('preserves a successful send when a stale initial load finishes later', async () => {
  const store = createMessagesStore();
  let resolveLoad!: (messages: readonly ChatMessage[]) => void;
  const load = store.load(
    conversationId,
    () =>
      new Promise((resolve) => {
        resolveLoad = resolve;
      }),
  );
  const sent: ChatMessage = {
    id: '22222222-2222-4222-8222-222222222222',
    conversationId,
    sequence: 1,
    authorType: 'principal',
    authorId: 'principal',
    body: '刚发送的 message must remain',
    workRef: null,
    createdAt: '2026-09-13T00:00:00.000Z',
  };
  store.append(conversationId, sent);

  resolveLoad([]);
  await load;

  expect(store.getConversation(conversationId).messages).toEqual([sent]);
});

it('serializes rapid sends until the active request completes', () => {
  const store = createMessagesStore();
  for (let index = 0; index < 20; index += 1) {
    expect(store.beginSend(conversationId, `message ${index}`)).toBe(true);
    expect(store.beginSend(conversationId, `duplicate ${index}`)).toBe(false);
    store.append(conversationId, {
      id: `33333333-3333-4333-8333-${String(index).padStart(12, '0')}`,
      conversationId,
      sequence: index + 1,
      authorType: 'principal',
      authorId: 'principal',
      body: `message ${index}`,
      workRef: null,
      createdAt: `2026-09-13T00:00:${String(index).padStart(2, '0')}.000Z`,
    });
    store.completeSend(conversationId);
  }
  expect(
    store.getConversation(conversationId).messages.map(({ body }) => body),
  ).toEqual(Array.from({ length: 20 }, (_, index) => `message ${index}`));
});
