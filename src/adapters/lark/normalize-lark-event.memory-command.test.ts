import { describe, expect, it } from 'vitest';
import { normalizeLarkEvent } from './normalize-lark-event.js';

const envelope = (text: string) => ({
  header: { event_id: 'event-1', event_type: 'im.message.receive_v1' },
  event: {
    message: {
      message_id: 'message-1',
      chat_id: 'chat',
      message_type: 'text',
      content: JSON.stringify({ text }),
      root_id: 'root',
      thread_id: 'thread',
      parent_id: 'reply',
      mentions: [{ id: { open_id: 'ou_bot_001' }, name: 'bot' }],
    },
    sender: { sender_id: { open_id: 'user' } },
  },
});

describe('Lark memory commands', () => {
  it('normalizes the bounded review grammar without losing thread identity', () => {
    expect(
      normalizeLarkEvent(
        envelope(
          'bot /memory edit-and-accept 123e4567-e89b-12d3-a456-426614174000 revised',
        ),
      ),
    ).toMatchObject({
      kind: 'command',
      externalMessageId: 'message-1',
      rootId: 'root',
      threadId: 'thread',
      replyToId: 'reply',
      action: {
        name: 'memory_review',
        decision: 'edit_and_accept',
        proposalId: '123e4567-e89b-12d3-a456-426614174000',
        content: 'revised',
      },
    });
  });

  it('does not treat arbitrary prefaced text as a command', () => {
    expect(
      normalizeLarkEvent(
        envelope('please /memory accept 123e4567-e89b-12d3-a456-426614174000'),
      ),
    ).toMatchObject({ kind: 'message' });
  });

  it('does not accept another mentioned user as the configured bot prefix', () => {
    const event = envelope(
      'other /memory accept 123e4567-e89b-12d3-a456-426614174000',
    );
    event.event.message.mentions = [
      { id: { open_id: 'other-user' }, name: 'other' },
      { id: { open_id: 'configured-bot' }, name: 'bot' },
    ];
    expect(
      normalizeLarkEvent(event, { botOpenId: 'configured-bot' }).kind,
    ).toBe('message');
  });

  it('recognizes exact commands and rejects extra grammar', () => {
    expect(
      normalizeLarkEvent(
        envelope('/memory reject 123e4567-e89b-12d3-a456-426614174000'),
      ).kind,
    ).toBe('command');
    expect(
      (
        normalizeLarkEvent(
          envelope('/memory accept 123e4567-e89b-12d3-a456-426614174000 extra'),
        ) as any
      ).action.decision,
    ).toBe('invalid');
    expect(
      (
        normalizeLarkEvent(
          envelope(
            `/memory edit-and-accept 123e4567-e89b-12d3-a456-426614174000 ${'x'.repeat(4097)}`,
          ),
        ) as any
      ).action.decision,
    ).toBe('invalid');
  });
});
