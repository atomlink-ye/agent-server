import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';

import { ChatShell } from './ChatShell';
import type {
  ChatCommands,
  ChatMessage,
  Conversation,
  ConversationId,
} from '../components/chat/contracts';
import { createAppStore } from '../stores/app';
import { createConversationsStore } from '../stores/conversations';
import { createMessagesStore } from '../stores/messages';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

it('refreshes the selected transcript on its interval and stops when selection changes or clears', async () => {
  vi.useFakeTimers();
  const conversationA = conversation('conversation-a');
  const conversationB = conversation('conversation-b');
  const appStore = createAppStore(conversationA.id);
  const conversationsStore = createConversationsStore({
    selectionStore: appStore,
  });
  const messagesStore = createMessagesStore();
  conversationsStore.hydrate([conversationA, conversationB]);

  const initialA = message(conversationA.id, 'message-a-1', 1, 'Initial A');
  const refreshedA = message(conversationA.id, 'message-a-2', 2, 'Refreshed A');
  const initialB = message(conversationB.id, 'message-b-1', 1, 'Initial B');
  const refreshedB = message(conversationB.id, 'message-b-2', 2, 'Refreshed B');
  const requests: ConversationId[] = [];
  const loadMessages = vi.fn(async (conversationId: ConversationId) => {
    requests.push(conversationId);
    const requestNumber = requests.filter((id) => id === conversationId).length;
    if (conversationId === conversationA.id)
      return requestNumber === 1 ? [initialA] : [initialA, refreshedA];
    return requestNumber === 1 ? [initialB] : [initialB, refreshedB];
  });
  const commands: ChatCommands = {
    loadCoworkers: async () => [],
    loadConversations: async () => [conversationA, conversationB],
    createConversation: async () => conversationA,
    loadWorks: async () => [],
    loadMessages,
    sendMessage: async () => initialA,
  };

  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <ChatShell
            commands={commands}
            appStore={appStore}
            conversationsStore={conversationsStore}
            messagesStore={messagesStore}
          />
        </MemoryRouter>,
      );
      await Promise.resolve();
    });
    expect(requests).toEqual([conversationA.id]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(requests).toEqual([conversationA.id, conversationA.id]);
    expect(messagesStore.getConversation(conversationA.id).messages).toEqual([
      initialA,
      refreshedA,
    ]);

    await act(async () => {
      appStore.select(conversationB.id);
      await Promise.resolve();
    });
    expect(requests).toEqual([
      conversationA.id,
      conversationA.id,
      conversationB.id,
    ]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(requests).toEqual([
      conversationA.id,
      conversationA.id,
      conversationB.id,
      conversationB.id,
    ]);
    expect(messagesStore.getConversation(conversationB.id).messages).toEqual([
      initialB,
      refreshedB,
    ]);

    await act(async () => {
      appStore.clearSelection();
      await Promise.resolve();
    });
    expect(vi.getTimerCount()).toBe(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(requests).toHaveLength(4);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.useRealTimers();
  }
});

it('renders Work as a sibling tab inside the same Cumora-style shell', async () => {
  const workId = '11111111-1111-4111-8111-111111111111';
  const commands: ChatCommands = {
    loadCoworkers: async () => [],
    loadConversations: async () => [],
    createConversation: async () => conversation('conversation-a'),
    loadWorks: async () => [
      {
        id: workId,
        title: 'Competitor Research',
        productState: 'running',
        updatedAt: '2026-08-21T00:00:00.000Z',
        latestRunSummary: null,
      },
    ],
    loadMessages: async () => [],
    sendMessage: async () => message('conversation-a', 'message-a', 1, 'hello'),
  };

  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/work']}>
          <ChatShell commands={commands} />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const rail = host.querySelector('.rail');
    expect(rail).not.toBeNull();
    expect(rail?.textContent).toContain('Conversations');
    expect(rail?.textContent).toContain('Work');
    expect(host.querySelector('.work-pane')).not.toBeNull();
    expect(host.querySelector('.work-main')).not.toBeNull();
    expect(host.textContent).toContain('Choose a Work item');
    expect(host.textContent).toContain('Competitor Research');
    expect(host.querySelector('.work-product-nav')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

function conversation(id: ConversationId): Conversation {
  return {
    id,
    kind: 'direct',
    title: id,
    directAgent: {
      agentDefinitionId: `${id}-agent`,
      displayName: id,
    },
    updatedAt: '2026-08-21T00:00:00.000Z',
  };
}

function message(
  conversationId: ConversationId,
  id: string,
  sequence: number,
  body: string,
): ChatMessage {
  return {
    id,
    conversationId,
    sequence,
    authorType: 'agent_definition',
    authorId: 'agent-1',
    body,
    workRef: null,
    createdAt: '2026-08-21T00:00:00.000Z',
  };
}
