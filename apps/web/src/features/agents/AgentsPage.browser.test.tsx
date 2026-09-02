import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';

import { AgentsPage } from './AgentsPage';
import type { Coworker } from './contracts';
import type { CoworkerProfile } from './agents-gateway';
import { ApiTransportError } from '../../api/transport';

const loadCoworkers = vi.fn(async () => [] as readonly Coworker[]);
const loadCoworkerProfile =
  vi.fn<(agentId: string) => Promise<CoworkerProfile>>();
vi.mock('./agents-gateway', () => ({
  associateCapability: vi.fn(),
  createCoworker: vi.fn(),
  loadCoworkers: (...args: unknown[]) =>
    (loadCoworkers as (...args: unknown[]) => unknown)(...args),
  loadCoworkerProfile: (...args: unknown[]) =>
    (loadCoworkerProfile as (...args: unknown[]) => unknown)(...args),
}));

const createConversation = vi.fn();
vi.mock('../conversations/conversations-gateway', () => ({
  createConversation: (...args: unknown[]) =>
    (createConversation as (...args: unknown[]) => unknown)(...args),
}));

function profileFor(runtimeStatus: Coworker['runtimeStatus']): CoworkerProfile {
  return {
    agent: {
      id: 'agent-1',
      displayName: 'Busy Bot',
      roleLabel: 'Tester',
      summary: null,
      activeAgentVersionId: 'v1',
      runtimeStatus,
    },
    capabilities: {
      modelPolicyRef: 'free-only',
      proposalLimit: null,
      tools: [],
      skills: [],
    },
    workCatalog: [],
  };
}

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

it('disables Chat with an explanatory title while a Coworker is working', async () => {
  loadCoworkers.mockReset();
  loadCoworkerProfile.mockReset();
  loadCoworkers.mockResolvedValue([profileFor('working').agent]);
  loadCoworkerProfile.mockResolvedValue(profileFor('working'));

  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/agents/agent-1']}>
        <AgentsPage />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  try {
    const button = host.querySelector<HTMLButtonElement>(
      '.agents-profile-actions button.agents-primary',
    );
    expect(button?.textContent?.trim()).toBe('Busy');
    expect(button?.disabled).toBe(true);
    expect(button?.title).toMatch(/handling another conversation/i);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it('shows an actionable message when the chat runtime rejects with 409', async () => {
  loadCoworkers.mockReset();
  loadCoworkerProfile.mockReset();
  createConversation.mockReset();
  loadCoworkers.mockResolvedValue([profileFor('available').agent]);
  loadCoworkerProfile.mockResolvedValue(profileFor('available'));
  createConversation.mockRejectedValue(
    new ApiTransportError(
      409,
      'chat_runtime_unavailable',
      'The requested agent is not available for chat.',
    ),
  );

  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/agents/agent-1']}>
        <AgentsPage />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  try {
    const button = host.querySelector<HTMLButtonElement>(
      '.agents-profile-actions button.agents-primary',
    );
    expect(button?.disabled).toBe(false);
    await act(async () => {
      button?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const error = host.querySelector('.agents-error');
    expect(error?.textContent).toMatch(/handling another conversation/i);
    expect(error?.textContent).not.toBe(
      'The requested agent is not available for chat.',
    );
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
