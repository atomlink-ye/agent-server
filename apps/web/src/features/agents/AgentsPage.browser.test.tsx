import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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

// Recent activity reads real Work and conversation records. These specs are
// about the profile shell, so the loader is stubbed to a resolved empty result
// instead of letting it reach the network.
const loadCoworkerActivity = vi.fn(async () => ({
  items: [],
  work: 'skipped' as const,
  chat: 'ok' as const,
}));
vi.mock('./coworker-activity', () => ({
  ACTIVITY_LIMIT: 5,
  activityStateLabel: (state: string) => state,
  formatActivityTime: () => 'Just now',
  sortByRecency: (items: unknown[]) => items,
  loadCoworkerActivity: (...args: unknown[]) =>
    (loadCoworkerActivity as (...args: unknown[]) => unknown)(...args),
}));

// CoworkerHomeFiles owns its own fetches and has its own coverage; the profile
// specs below only need it to render without reaching the network.
vi.mock('../files/files-gateway', () => ({
  loadContextFiles: async () => ({
    access: 'read_only' as const,
    scope: {},
    entries: [],
  }),
}));

// Agent detail routes only accept a canonical Agent id; a placeholder like
// "agent-1" renders the invalid-link state instead of the profile.
const AGENT_ID = '123e4567-e89b-42d3-a456-426614174000';

/**
 * The page reads the selected Coworker from `useParams`, so it has to be
 * mounted under the real detail route. A bare MemoryRouter leaves the params
 * empty and the page stays on its "choose a Coworker" state forever.
 */
function routed(entry: string) {
  return (
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/agents" element={<AgentsPage />} />
        <Route path="/agents/:agentId" element={<AgentsPage />} />
      </Routes>
    </MemoryRouter>
  );
}

function profileFor(runtimeStatus: Coworker['runtimeStatus']): CoworkerProfile {
  return {
    agent: {
      id: AGENT_ID,
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
    root.render(routed('/agents'));
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
    root.render(routed(`/agents/${AGENT_ID}`));
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
    root.render(routed(`/agents/${AGENT_ID}`));
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

it('states the Coworker summary once and puts Capabilities above Context files', async () => {
  loadCoworkers.mockReset();
  loadCoworkerProfile.mockReset();
  const withSummary: CoworkerProfile = {
    ...profileFor('available'),
    agent: {
      ...profileFor('available').agent,
      summary: 'Researches markets and writes concise briefs.',
    },
  };
  loadCoworkers.mockResolvedValue([withSummary.agent]);
  loadCoworkerProfile.mockResolvedValue(withSummary);

  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(routed(`/agents/${AGENT_ID}`));
    await Promise.resolve();
    await Promise.resolve();
  });
  try {
    const detail = host.querySelector('.agents-detail');
    const occurrences =
      detail?.textContent?.split(
        'Researches markets and writes concise briefs.',
      ).length ?? 0;
    expect(occurrences - 1).toBe(1);
    expect(detail?.querySelector('.agents-about-card')).toBeNull();

    const capabilities = host.querySelector('.agents-capabilities');
    const activity = host.querySelector('.agents-activity');
    const files = host.querySelector('.agents-home-files');
    expect(capabilities).not.toBeNull();
    expect(activity).not.toBeNull();
    expect(files).not.toBeNull();
    expect(
      capabilities!.compareDocumentPosition(files!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      activity!.compareDocumentPosition(files!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
