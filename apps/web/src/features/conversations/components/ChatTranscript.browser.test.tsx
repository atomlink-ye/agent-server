import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

import { ChatTranscript } from './ChatTranscript';
import type { ChatMessage, ConversationId } from './contracts';
import type { ConversationMessagesState } from '../stores/messages';

vi.mock('../conversations-gateway', async () => {
  const actual = await vi.importActual<
    typeof import('../conversations-gateway')
  >('../conversations-gateway');
  return { ...actual, loadWorkCard: vi.fn(async () => null) };
});

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const conversationId = '11111111-1111-4111-8111-111111111111' as ConversationId;

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

async function render(messages: readonly ChatMessage[]): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <ChatTranscript
        conversationId={conversationId}
        hasConversations
        state={
          {
            status: 'ready',
            messages,
            error: null,
          } as unknown as ConversationMessagesState
        }
        onRetry={() => undefined}
        onOpenWork={() => undefined}
      />,
    );
  });
  return host;
}

function message(
  overrides: Partial<ChatMessage> & Pick<ChatMessage, 'body' | 'authorType'>,
): ChatMessage {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    conversationId,
    sequence: 1,
    authorId: 'svc_local',
    workRef: null,
    createdAt: '2026-08-24T00:00:00.000Z',
    ...overrides,
  } as ChatMessage;
}

it('renders an Agent reply as markdown structure rather than its syntax', async () => {
  const host = await render([
    message({
      authorType: 'agent_definition',
      body: 'Started **W-1** with `start_work`.\n\n- one\n- two\n',
    }),
  ]);

  expect(host.querySelector('strong')?.textContent).toBe('W-1');
  expect(host.querySelector('code')?.textContent).toBe('start_work');
  expect(host.querySelectorAll('li')).toHaveLength(2);
  // The point of the fix: the asterisks and backticks must not survive as text.
  expect(host.textContent).not.toContain('**');
  expect(host.textContent).not.toContain('`');
});

it('leaves a principal message as the text they actually typed', async () => {
  const host = await render([
    message({ authorType: 'principal', body: 'use **exactly** these stars' }),
  ]);

  expect(host.querySelector('strong')).toBeNull();
  expect(host.textContent).toContain('**exactly**');
});

it('refuses raw HTML in an Agent reply', async () => {
  const host = await render([
    message({
      authorType: 'agent_definition',
      body: 'before <img src=x onerror="alert(1)"> after\n\n<script>alert(2)</script>',
    }),
  ]);

  expect(host.querySelector('img')).toBeNull();
  expect(host.querySelector('script')).toBeNull();
  expect(host.textContent).toContain('before');
  expect(host.textContent).toContain('after');
});
