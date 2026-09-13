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
import { page } from 'vitest/browser';

import { AppShell } from '../../app/shell/AppShell';
import { ConversationsPage } from './ConversationsPage';
import { CONVERSATION_NOT_FOUND_CODE } from '@atomlink-ye/agent-server/product-contract';
import type {
  ChatCommands,
  ChatMessage,
  Conversation,
  ConversationId,
} from './contracts';
import { createAppStore } from './stores/app';
import { createConversationsStore } from './stores/conversations';
import { createMessagesStore } from './stores/messages';
import { setLocale } from '../../i18n';
import '../../index.css';

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

it('scrolls the real Conversations shell list and transcript at desktop size', async () => {
  expect(window.innerWidth).toBe(1440);
  expect(window.innerHeight).toBe(900);

  const conversations = Array.from({ length: 48 }, (_, index) => ({
    ...conversation(`conversation-${index}`),
    updatedAt: new Date(Date.UTC(2026, 7, 21, 0, 47 - index)).toISOString(),
    title:
      index === 47 ? 'Final real Conversation' : `Long Conversation ${index}`,
    directAgent: {
      agentDefinitionId: `agent-${index}`,
      displayName:
        index === 47 ? 'Final real Conversation' : `Long Conversation ${index}`,
    },
  }));
  const selected = conversations[0]!;
  const messages = Array.from({ length: 48 }, (_, index) =>
    message(
      selected.id,
      `message-${index}`,
      index + 1,
      index === 47 ? 'Final real conversation message' : `Message ${index}`,
    ),
  );
  const commands: ChatCommands = {
    loadCoworkers: async () => [],
    loadConversations: async () => conversations,
    createConversation: async () => selected,
    loadMessages: async (conversationId) =>
      conversationId === selected.id ? messages : [],
    sendMessage: async () => messages[0]!,
  };

  const host = document.createElement('div');
  host.style.height = '900px';
  host.style.width = '100%';
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[`/conversations/${selected.id}`]}>
          <Routes>
            <Route
              path="/conversations/:conversationId"
              element={<RoutedShell commands={commands} />}
            />
          </Routes>
        </MemoryRouter>,
      );
      for (let turn = 0; turn < 6; turn += 1)
        await new Promise((resolve) => setTimeout(resolve, 0));
    });

    for (const locale of ['en', 'zh-CN'] as const) {
      await act(async () => setLocale(locale));
      expect(host.querySelectorAll('[data-typography-surface]')).toHaveLength(
        2,
      );
      const paneHeading = host.querySelector<HTMLElement>('.pane-heading h1');
      expect(paneHeading).not.toBeNull();
      expect(parseFloat(getComputedStyle(paneHeading!).fontSize)).toBe(
        locale === 'zh-CN' ? 18 : 20,
      );
      const metadata = host.querySelector<HTMLElement>('.eyebrow');
      expect(metadata).not.toBeNull();
      expect(
        parseFloat(getComputedStyle(metadata!).fontSize),
      ).toBeGreaterThanOrEqual(12);
    }

    const listRegion = host.querySelector<HTMLElement>('.sidebar-section');
    expect(listRegion).not.toBeNull();
    expectScrollable(listRegion!);
    const finalConversation = [
      ...listRegion!.querySelectorAll('.conversation-item'),
    ].at(-1)!;
    expect(finalConversation.textContent).toContain('Final real Conversation');
    expectFullyVisible(finalConversation, listRegion!);

    const transcript = host.querySelector<HTMLElement>('.chat-transcript');
    expect(transcript).not.toBeNull();
    expectScrollable(transcript!);
    const finalMessage = [...transcript!.querySelectorAll('article')].at(-1)!;
    expect(finalMessage.textContent).toContain(
      'Final real conversation message',
    );
    expectFullyVisible(finalMessage, transcript!);

    await page.screenshot({
      path: '../../../../../.local/conversations-app-shell-scroll-desktop.png',
    });
  } finally {
    await act(async () => root.unmount());
    host.remove();
    setLocale('en');
  }
});

it('keeps Direct Chat identity and Work origin in refresh-safe URLs', async () => {
  const conversationA = conversation('conversation-a');
  const conversationB = conversation('conversation-b');
  const commands: ChatCommands = {
    loadCoworkers: async () => [],
    loadConversations: async () => [conversationA, conversationB],
    createConversation: async () => conversationA,
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

it('reports a missing selected Conversation without Retry or a composer', async () => {
  const commands: ChatCommands = {
    loadCoworkers: async () => [],
    loadConversations: async () => [],
    createConversation: async () => conversation('created'),
    loadMessages: async () => [],
    sendMessage: async () => message('created', 'message', 1, 'hello'),
  };
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/conversations/missing']}>
          <ConversationsPage
            commands={commands}
            routeConversationId="missing"
          />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.textContent).toContain(
      'The selected Conversation is unavailable.',
    );
    expect(host.textContent).toContain('Back to Conversations');
    expect(host.textContent).not.toContain('No conversations yet.');
    expect(
      [...host.querySelectorAll('button')].some(
        (button) => button.textContent === 'Retry',
      ),
    ).toBe(false);
    expect(host.querySelector('textarea')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it('keeps the conversation rail and pane aligned across roster states', async () => {
  let resolve: ((value: readonly Conversation[]) => void) | undefined;
  let reject: ((reason?: unknown) => void) | undefined;
  const commands: ChatCommands = {
    loadCoworkers: async () => [],
    loadConversations: () =>
      new Promise<readonly Conversation[]>((next, fail) => {
        resolve = next;
        reject = fail;
      }),
    createConversation: async () => conversation('created'),
    loadMessages: async () => [],
    sendMessage: async () => message('created', 'message', 1, 'hello'),
  };
  const appStore = createAppStore();
  const conversationsStore = createConversationsStore({
    selectionStore: appStore,
  });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <ConversationsPage
            commands={commands}
            appStore={appStore}
            conversationsStore={conversationsStore}
          />
        </MemoryRouter>,
      );
      await Promise.resolve();
    });
    expect(
      host.textContent?.match(/Loading conversations…/g) ?? [],
    ).toHaveLength(2);

    await act(async () => reject?.(new Error('offline')));
    expect(
      host.textContent?.match(/Unable to load conversations\./g) ?? [],
    ).toHaveLength(2);

    await act(async () => {
      resolve = undefined;
      await conversationsStore.load(async () => []);
    });
    expect(host.textContent).toContain('No conversations yet.');
    expect(host.textContent).toContain('Ready when you are');
    expect(host.textContent).toContain('Meet your Coworkers');
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it('reports a selected Conversation whose message read returns 404 without Retry or a composer', async () => {
  const selected = conversation('conversation-a');
  const commands: ChatCommands = {
    loadCoworkers: async () => [],
    loadConversations: async () => [selected],
    createConversation: async () => selected,
    loadMessages: async () =>
      Promise.reject({
        status: 404,
        code: CONVERSATION_NOT_FOUND_CODE,
      }),
    sendMessage: async () => message(selected.id, 'message', 1, 'hello'),
  };
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[`/conversations/${selected.id}`]}>
          <ConversationsPage
            commands={commands}
            routeConversationId={selected.id}
          />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.textContent).toContain('This Conversation is unavailable.');
    expect(host.textContent).toContain('Back to Conversations');
    expect(
      [...host.querySelectorAll('button')].some(
        (button) => button.textContent === 'Retry',
      ),
    ).toBe(false);
    expect(host.querySelector('textarea')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it('keeps Retry for a selected Conversation message transport failure', async () => {
  const selected = conversation('conversation-error');
  const commands: ChatCommands = {
    loadCoworkers: async () => [],
    loadConversations: async () => [selected],
    createConversation: async () => selected,
    loadMessages: async () =>
      Promise.reject({
        status: 500,
        requestPath: `/api/conversations/${selected.id}/messages`,
      }),
    sendMessage: async () => message(selected.id, 'message', 1, 'hello'),
  };
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <ConversationsPage
            commands={commands}
            routeConversationId={selected.id}
          />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.textContent).toContain('Unable to load messages.');
    expect(
      [...host.querySelectorAll('button')].some(
        (button) => button.textContent === 'Retry',
      ),
    ).toBe(true);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it('shows selected Conversation message loading', async () => {
  const selected = conversation('conversation-loading');
  const commands: ChatCommands = {
    loadCoworkers: async () => [],
    loadConversations: async () => [selected],
    createConversation: async () => selected,
    loadMessages: async () => new Promise<readonly ChatMessage[]>(() => {}),
    sendMessage: async () => message(selected.id, 'message', 1, 'hello'),
  };
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <ConversationsPage
            commands={commands}
            routeConversationId={selected.id}
          />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.textContent).toContain('Loading messages…');
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
    loadMessages: async () => [],
    sendMessage: async () => message('conversation-a', 'message-a', 1, 'hello'),
  };
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    expect(input).toBe('/api/works');
    return {
      ok: true,
      status: 200,
      json: async () => ({
        works: [
          {
            id: workId,
            tenant_id: 'tenant-a',
            workspace_id: '22222222-2222-4222-8222-222222222222',
            definition_id: '33333333-3333-4333-8333-333333333333',
            definition_version_id: '44444444-4444-4444-8444-444444444444',
            title: 'Competitor Research',
            origin: 'created',
            archived_at: null,
            created_at: '2026-08-21T00:00:00.000Z',
            updated_at: '2026-08-21T00:00:00.000Z',
            product_state: 'needs_you',
            latest_run_summary: null,
          },
        ],
        next_cursor: null,
      }),
    } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);

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
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const rail = host.querySelector('.rail');
    expect(rail).not.toBeNull();
    expect(rail?.textContent).toContain('Conversations');
    expect(rail?.textContent).toContain('Work');
    expect(host.querySelector('.sidebar.work-pane')).not.toBeNull();
    expect(host.querySelector('.work-main-content')).not.toBeNull();
    expect(host.querySelector('.work-main')).not.toBeNull();
    expect(host.textContent).toContain('Choose Work');
    expect(host.textContent).toContain('Competitor Research');
    expect(host.querySelector('.work-product-nav')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
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

function expectScrollable(region: HTMLElement): void {
  expect(['auto', 'scroll']).toContain(getComputedStyle(region).overflowY);
  expect(region.scrollHeight).toBeGreaterThan(region.clientHeight);
  region.scrollTop = region.scrollHeight;
  expect(region.scrollTop).toBeGreaterThan(0);
}

function expectFullyVisible(item: Element, region: HTMLElement): void {
  const itemRect = item.getBoundingClientRect();
  const regionRect = region.getBoundingClientRect();
  expect(itemRect.top).toBeGreaterThanOrEqual(regionRect.top - 1);
  expect(itemRect.bottom).toBeLessThanOrEqual(regionRect.bottom + 1);
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
