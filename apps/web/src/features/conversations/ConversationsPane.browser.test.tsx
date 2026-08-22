import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

import { ConversationsPane } from './ConversationsPane';
import type {
  ChatCommands,
  Conversation,
  Coworker,
} from './contracts';
import { createAppStore } from './stores/app';
import { createConversationsStore } from './stores/conversations';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const coworker: Coworker = {
  id: '11111111-1111-4111-8111-111111111111',
  displayName: 'Research Analyst',
  roleLabel: 'Researcher',
  summary: 'Investigates markets and evidence.',
  activeAgentVersionId: '22222222-2222-4222-8222-222222222222',
  runtimeStatus: 'available',
};

it('opens Direct Chat from the Coworker roster without exposing AgentDefinition IDs', async () => {
  const direct = directConversation(
    '33333333-3333-4333-8333-333333333333',
    coworker,
  );
  const createConversation = vi.fn(async () => direct);
  const commands = commandsFor({
    loadCoworkers: async () => [coworker],
    createConversation,
  });
  const appStore = createAppStore();
  const conversationsStore = createConversationsStore({ selectionStore: appStore });
  const { host, root } = renderPane(commands, appStore, conversationsStore);

  try {
    const newConversation = findButton(host, 'New conversation');
    await act(async () => {
      newConversation.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('Choose a coworker');
    expect(host.textContent).toContain('Research Analyst');
    expect(host.textContent).not.toContain('Agent definition ID');
    expect(host.querySelector('#new-conversation-agent-definition')).toBeNull();

    const coworkerButton = findButton(host, 'Research Analyst');
    await act(async () => {
      coworkerButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(createConversation).toHaveBeenCalledTimes(1);
    expect(createConversation).toHaveBeenCalledWith(coworker.id);
    expect(appStore.getSnapshot().selectedConversationId).toBe(direct.id);
    expect(conversationsStore.getSnapshot().conversations).toContainEqual(direct);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it('reloads the Coworker roster on every picker open and reuses an existing Direct Chat', async () => {
  const direct = directConversation(
    '33333333-3333-4333-8333-333333333334',
    coworker,
  );
  const loadCoworkers = vi.fn(async () => [coworker]);
  const createConversation = vi.fn(async () => direct);
  const commands = commandsFor({ loadCoworkers, createConversation });
  const appStore = createAppStore();
  const conversationsStore = createConversationsStore({ selectionStore: appStore });
  conversationsStore.hydrate([direct]);
  const { host, root } = renderPane(commands, appStore, conversationsStore);

  try {
    await act(async () => {
      findButton(host, 'New conversation').click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(loadCoworkers).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain('Research Analyst · Researcher · Open');

    await act(async () => {
      findButton(host, 'Cancel').click();
      findButton(host, 'New conversation').click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(loadCoworkers).toHaveBeenCalledTimes(2);

    await act(async () => {
      findButton(host, 'Research Analyst').click();
      await Promise.resolve();
    });
    expect(createConversation).not.toHaveBeenCalled();
    expect(appStore.getSnapshot().selectedConversationId).toBe(direct.id);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it('searches Direct Chat by the Coworker display identity shown in the list', async () => {
  const research = directConversation(
    '33333333-3333-4333-8333-333333333335',
    coworker,
  );
  const opsCoworker: Coworker = {
    ...coworker,
    id: '11111111-1111-4111-8111-111111111112',
    displayName: 'Operations Partner',
  };
  const operations = directConversation(
    '33333333-3333-4333-8333-333333333336',
    opsCoworker,
  );
  const commands = commandsFor();
  const appStore = createAppStore();
  const conversationsStore = createConversationsStore({ selectionStore: appStore });
  conversationsStore.hydrate([research, operations]);
  const { host, root } = renderPane(commands, appStore, conversationsStore);

  try {
    expect(host.textContent).toContain('Research Analyst');
    expect(host.textContent).toContain('Operations Partner');
    const input = host.querySelector('#conversation-search');
    if (!(input instanceof HTMLInputElement)) throw new Error('search input missing');

    await act(async () => {
      setInputValue(input, 'research');
    });

    expect(host.textContent).toContain('Research Analyst');
    expect(host.textContent).not.toContain('Operations Partner');
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

function commandsFor(
  overrides: Partial<ChatCommands> = {},
): ChatCommands {
  return {
    loadCoworkers: async () => [],
    loadConversations: async () => [],
    createConversation: async () => {
      throw new Error('unexpected create');
    },
    loadWorks: async () => [],
    loadMessages: async () => [],
    sendMessage: async () => {
      throw new Error('not used');
    },
    ...overrides,
  };
}

function directConversation(id: string, agent: Coworker): Conversation {
  return {
    id,
    kind: 'direct',
    title: null,
    directAgent: {
      agentDefinitionId: agent.id,
      displayName: agent.displayName,
    },
    updatedAt: '2026-08-22T00:00:00.000Z',
  };
}

function renderPane(
  commands: ChatCommands,
  appStore: ReturnType<typeof createAppStore>,
  conversationsStore: ReturnType<typeof createConversationsStore>,
) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <ConversationsPane
        commands={commands}
        appStore={appStore}
        conversationsStore={conversationsStore}
      />,
    );
  });
  return { host, root };
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
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
