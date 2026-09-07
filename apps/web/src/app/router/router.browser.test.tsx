import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { expect, it } from 'vitest';

import { AppProviders } from '../providers';
import { AppRouter } from './index';
import type { ChatCommands } from '../../features/conversations/contracts';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

/** A first-time principal: the roster is shared, the conversation list is empty. */
const firstRunCommands: ChatCommands = {
  loadCoworkers: async () => [],
  loadConversations: async () => [],
  createConversation: async () => {
    throw new Error('not used');
  },
  loadMessages: async () => [],
  sendMessage: async () => {
    throw new Error('not used');
  },
};

async function renderAt(path: string): Promise<{
  readonly text: string;
  readonly cleanup: () => void;
}> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <AppProviders commands={firstRunCommands}>
          <AppRouter />
        </AppProviders>
      </MemoryRouter>,
    );
  });
  return {
    text: host.textContent ?? '',
    cleanup: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}

it('serves the conversations list at /conversations instead of a route miss', async () => {
  const { text, cleanup } = await renderAt('/conversations');
  try {
    expect(text).not.toContain('Route unavailable');
    expect(text).not.toContain('doesn’t exist');
    expect(text).toContain('Conversations');
  } finally {
    cleanup();
  }
});

it('gives a first-time principal an onboarding empty state at /conversations', async () => {
  const { text, cleanup } = await renderAt('/conversations');
  try {
    expect(text).toContain('Ready when you are');
    expect(text).toContain('Meet your Coworkers');
  } finally {
    cleanup();
  }
});

it('still renders the route miss for a path that really has no view', async () => {
  const { text, cleanup } = await renderAt('/this-route-does-not-exist');
  try {
    expect(text).toContain('Route unavailable');
  } finally {
    cleanup();
  }
});
