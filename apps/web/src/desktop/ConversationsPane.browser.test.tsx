import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

import { ConversationsPane } from './ConversationsPane';
import type {
  ChatCommands,
  Conversation,
  Coworker,
} from '../components/chat/contracts';
import { createAppStore } from '../stores/app';
import { createConversationsStore } from '../stores/conversations';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

it('opens Direct Chat from the Coworker roster without exposing AgentDefinition IDs', async () => {
  const coworker: Coworker = {
    id: '11111111-1111-4111-8111-111111111111',
    displayName: 'Research Analyst',
    roleLabel: 'Researcher',
    summary: 'Investigates markets and evidence.',
    activeAgentVersionId: '22222222-2222-4222-8222-222222222222',
    runtimeStatus: 'available',
  };
  const direct: Conversation = {
    id: '33333333-3333-4333-8333-333333333333',
    kind: 'direct',
    title: null,
    directAgent: {
      agentDefinitionId: coworker.id,
      displayName: coworker.displayName,
    },
    updatedAt: '2026-08-22T00:00:00.000Z',
  };
  const createConversation = vi.fn(async () => direct);
  const commands: ChatCommands = {
    loadCoworkers: async () => [coworker],
    loadConversations: async () => [],
    createConversation,
    loadWorks: async () => [],
    loadMessages: async () => [],
    sendMessage: async () => {
      throw new Error('not used');
    },
  };
  const appStore = createAppStore();
  const conversationsStore = createConversationsStore({ selectionStore: appStore });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);

  try {
    await act(async () => {
      root.render(
        <ConversationsPane
          commands={commands}
          appStore={appStore}
          conversationsStore={conversationsStore}
        />,
      );
    });

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

function findButton(host: HTMLElement, label: string): HTMLButtonElement {
  const button = [...host.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes(label),
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${label}`);
  }
  return button;
}
