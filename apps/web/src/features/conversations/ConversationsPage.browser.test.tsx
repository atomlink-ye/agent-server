import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useParams,
} from 'react-router-dom';
import { expect, it, vi } from 'vitest';

import { AppShell } from '../../app/shell/AppShell';
import type {
  ChatCommands,
  ChatMessage,
  Conversation,
  ConversationId,
} from './components/contracts';
import { createAppStore } from '../../stores/app';
import { createConversationsStore } from '../../stores/conversations';
import { createMessagesStore } from '../../stores/messages';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

it('refreshes the selected transcript on its interval and stops transcript polling when selection clears', async () => {
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
          <AppShell
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
    // Conversation-list convergence remains active while the Conversations tab is visible.
    expect(vi.getTimerCount()).toBe(1);

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

it('keeps Direct Chat identity and Work origin in refresh-safe URLs', async () => {
  const conversationA = conversation('conversation-a');
  const conversationB = conversation('conversation-b');
  const commands: ChatCommands = {
    loadCoworkers: async () => [],
    loadConversations: async () => [conversationA, conversationB],
    createConversation: async () => conversationA,
    loadWorks: async () => [],
    loadMessages: async () => [],
    sendMessage: async () => message('conversation-a', 'message-a', 1, 'hello'),
  };

  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/" element={<RoutedShell commands={commands} />} />
            <Route
              path="/conversations/:conversationId"
              element={<RoutedShell commands={commands} />}
            />
            <Route path="/work" element={<RoutedShell commands={commands} />} />
            <Route
              path="/work/:workId"
              element={<RoutedShell commands={commands} />}
            />
          </Routes>
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(locationText(host)).toBe('/conversations/conversation-a');

    await act(async () => {
      findButton(host, 'conversation-b').click();
      await Promise.resolve();
    });
    expect(locationText(host)).toBe('/conversations/conversation-b');

    await act(async () => {
      findButton(host, 'Work').click();
      await Promise.resolve();
    });
    expect(locationText(host)).toBe('/work?from_conversation=conversation-b');

    await act(async () => {
      findButton(host, 'Conversations').click();
      await Promise.resolve();
    });
    expect(locationText(host)).toBe('/conversations/conversation-b');
  } finally {
    await act(async () => root.unmount());
    host.remove();
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
          <AppShell commands={commands} />
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

function RoutedShell({ commands }: { readonly commands: ChatCommands }) {
  const location = useLocation();
  const { conversationId, workId } = useParams<{
    conversationId?: string;
    workId?: string;
  }>();
  const query = new URLSearchParams(location.search);
  return (
    <>
      <AppShell
        commands={commands}
        routeConversationId={conversationId ?? null}
        returnConversationId={query.get('from_conversation')}
        selectedWorkId={workId ?? null}
      />
      <output data-testid="location">
        {location.pathname}
        {location.search}
      </output>
    </>
  );
}

function findButton(host: HTMLElement, label: string): HTMLButtonElement {
  const button = [...host.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes(label),
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${label}`);
  }
  return button;
}

function locationText(host: HTMLElement): string {
  const output = host.querySelector('[data-testid="location"]');
  if (!(output instanceof HTMLOutputElement)) {
    throw new Error('location output missing');
  }
  return output.textContent ?? '';
}

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
