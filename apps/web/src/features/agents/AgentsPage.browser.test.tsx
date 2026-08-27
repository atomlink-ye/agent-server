import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';

import { AgentsPage } from './AgentsPage';

vi.mock('./agents-gateway', () => ({
  associateCapability: vi.fn(),
  createCoworker: vi.fn(),
  loadCoworkers: vi.fn(async () => []),
  loadCoworkerProfile: vi.fn(),
}));
vi.mock('../conversations/conversations-gateway', () => ({
  createConversation: vi.fn(),
}));

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

it('labels the New Coworker action for sighted users', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <MemoryRouter>
        <AgentsPage />
      </MemoryRouter>,
    );
    await Promise.resolve();
  });
  try {
    const button = host.querySelector<HTMLButtonElement>(
      '[data-testid="new-coworker-cta"]',
    );
    expect(button?.textContent?.trim()).toBe('+ New Coworker');
    expect(button?.classList.contains('pane-refresh')).toBe(false);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
