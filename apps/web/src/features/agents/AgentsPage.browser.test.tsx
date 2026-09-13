import { surfaceMetrics } from '@/test-support/surface-metrics';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { commands, page } from 'vitest/browser';

import { AgentsPage } from './AgentsPage';
import type { Coworker } from './contracts';
import type { CoworkerProfile } from './agents-gateway';
import { ApiTransportError } from '../../api/transport';
import { AppShell } from '../../app/shell/AppShell';
import '../../index.css';
import { setLocale } from '../../i18n';
import { copyRegressions } from '../../test-support/copy-regressions';
import { findCopy, measureCopy } from '../../test-support/copy-measurement';

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
vi.mock('../conversations/conversations-gateway', async () => {
  const actual = await vi.importActual<
    typeof import('../conversations/conversations-gateway')
  >('../conversations/conversations-gateway');
  return {
    ...actual,
    createConversation: (...args: unknown[]) =>
      (createConversation as (...args: unknown[]) => unknown)(...args),
  };
});

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
vi.mock('../files/files-gateway', async () => {
  const actual = await vi.importActual<typeof import('../files/files-gateway')>(
    '../files/files-gateway',
  );
  return {
    ...actual,
    loadContextFiles: async () => ({
      access: 'read_only' as const,
      scope: {},
      entries: [],
    }),
  };
});

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

function RoutedAppShell({ entry }: { readonly entry: string }) {
  return (
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route
          path="/agents"
          element={<AppShell commands={shellCommands()} />}
        />
        <Route
          path="/agents/:agentId"
          element={<AppShell commands={shellCommands()} />}
        />
      </Routes>
    </MemoryRouter>
  );
}

function shellCommands() {
  return {
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
}

function agentId(index: number): string {
  return `123e4567-e89b-42d3-a456-${String(index).padStart(12, '0')}`;
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

const copyMeasurements: unknown[] = [];

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

it('scrolls the real Agents roster to its final Coworker on desktop', async () => {
  expect(window.innerWidth).toBe(1440);
  expect(window.innerHeight).toBe(900);
  loadCoworkers.mockResolvedValue(
    Array.from({ length: 48 }, (_, index) => ({
      id: `123e4567-e89b-42d3-a456-${String(index).padStart(12, '0')}`,
      displayName: index === 47 ? 'Final real Coworker' : `Coworker ${index}`,
      roleLabel: 'Research',
      summary: null,
      activeAgentVersionId: 'v1',
      runtimeStatus: 'available' as const,
    })),
  );
  const host = document.createElement('div');
  host.style.height = '900px';
  host.style.width = '100%';
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(<RoutedAppShell entry="/agents" />);
      await Promise.resolve();
      await Promise.resolve();
    });
    await surfaceMetrics(host, 'agents-roster', [
      '.title-bar',
      '.agents-roster-header',
      '.agents-roster-card',
      '.agents-main',
    ]);
    const region = host.querySelector<HTMLElement>('.agents-main')!;
    expectScrollable(region);
    const final = [...region.querySelectorAll('.agents-roster-card')].at(-1)!;
    expect(final.textContent).toContain('Final real Coworker');
    expectFullyVisible(final, region);
    await page.screenshot({
      path: '../../../../../.local/agents-roster-app-shell-scroll-desktop.png',
    });
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it('scrolls the real Agents detail and Coworker rail through their final entries', async () => {
  expect(window.innerWidth).toBe(1440);
  expect(window.innerHeight).toBe(900);
  const agents = Array.from({ length: 48 }, (_, index) => ({
    id: index === 0 ? AGENT_ID : agentId(index),
    displayName:
      index === 47 ? 'Final detail Coworker' : `Detail Coworker ${index}`,
    roleLabel: 'Research',
    summary: null,
    activeAgentVersionId: 'v1',
    runtimeStatus: 'available' as const,
  }));
  const profile = {
    ...profileFor('available'),
    agent: agents[0]!,
    workCatalog: Array.from({ length: 48 }, (_, index) => ({
      definitionId: `definition-${index}`,
      definitionVersionId: `definition-version-${index}`,
      name:
        index === 47 ? 'final-detail-capability' : `detail-capability-${index}`,
      description: 'A real capability fixture for the detail scroll surface.',
      inputSchema: {
        properties: {},
        required: [],
        additionalProperties: false,
      },
    })),
  } satisfies CoworkerProfile;
  loadCoworkers.mockReset();
  loadCoworkerProfile.mockReset();
  loadCoworkers.mockResolvedValue(agents);
  loadCoworkerProfile.mockResolvedValue(profile);

  const host = document.createElement('div');
  host.style.height = '900px';
  host.style.width = '100%';
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(<RoutedAppShell entry={`/agents/${AGENT_ID}`} />);
      for (let turn = 0; turn < 6; turn += 1)
        await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await surfaceMetrics(host, 'agents', [
      '.title-bar',
      '.agents-profile-header',
      '.agents-card',
      '.agents-list-item',
      '.agents-main',
      '.agents-first-screen',
    ]);
    const listRegion = host.querySelector<HTMLElement>('.agents-list');
    expect(listRegion).not.toBeNull();
    expectScrollable(listRegion!);
    const finalAgent = [
      ...listRegion!.querySelectorAll('.agents-list-item'),
    ].at(-1)!;
    expect(finalAgent.textContent).toContain('Final detail Coworker');
    expectFullyVisible(finalAgent, listRegion!);

    const detailRegion = host.querySelector<HTMLElement>('.agents-main');
    expect(detailRegion).not.toBeNull();
    expectScrollable(detailRegion!);
    const finalCapability = [
      ...detailRegion!.querySelectorAll('.agents-capability-card'),
    ].at(-1)!;
    expect(finalCapability.textContent).toContain('Final Detail Capability');
    expectFullyVisible(finalCapability, detailRegion!);

    await page.screenshot({
      path: '../../../../../.local/agents-detail-app-shell-scroll-desktop.png',
    });
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

it('lands on a card per Coworker instead of redirecting into the first profile', async () => {
  loadCoworkers.mockReset();
  loadCoworkerProfile.mockReset();
  const maya = {
    ...profileFor('available').agent,
    displayName: 'Maya',
    roleLabel: 'Research Analyst',
    summary: 'Researches markets and writes concise briefs.',
  };
  const nova = {
    ...profileFor('available').agent,
    id: '123e4567-e89b-42d3-a456-426614174001',
    displayName: 'Nova',
    roleLabel: 'Project Researcher',
    summary: null,
  };
  loadCoworkers.mockResolvedValue([maya, nova]);
  loadCoworkerProfile.mockResolvedValue({
    ...profileFor('available'),
    agent: maya,
  });

  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(routed('/agents'));
    await Promise.resolve();
    await Promise.resolve();
  });
  try {
    const cards = host.querySelectorAll('.agents-roster-card');
    expect(cards.length).toBe(2);
    // The roster is the landing view, so nothing has opened a profile yet.
    expect(loadCoworkerProfile).not.toHaveBeenCalled();
    expect(host.querySelector('.agents-roster')?.textContent).toContain(
      'Your team',
    );
    expect(host.querySelector('[role="note"]')?.textContent).toContain(
      'Maya is a sample Coworker',
    );
    // A Coworker with no summary must not borrow anyone else's words.
    expect(cards[1]?.textContent).toContain('No summary yet.');
    // Chat starts from the card, without a detour through the profile.
    expect(
      cards[0]?.querySelector<HTMLButtonElement>(
        '.agents-roster-actions button.agents-primary',
      )?.disabled,
    ).toBe(false);

    await act(async () => {
      cards[0]
        ?.querySelector<HTMLButtonElement>('.agents-roster-identity')
        ?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(loadCoworkerProfile).toHaveBeenCalledWith(maya.id);
    expect(host.querySelector('.agents-profile-header')).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it('explains the starter Maya on a new account roster', async () => {
  loadCoworkers.mockReset();
  loadCoworkers.mockResolvedValue([
    {
      ...profileFor('available').agent,
      displayName: 'Maya',
      roleLabel: 'Research Analyst',
      summary: 'Researches markets and writes concise briefs.',
    },
  ]);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(routed('/agents'));
    await Promise.resolve();
    await Promise.resolve();
  });
  try {
    expect(host.querySelector('[role="note"]')?.textContent).toContain(
      'Maya is a sample Coworker',
    );
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it.each(['en', 'zh-CN'] as const)(
  'fits Definition availability and creation copy in %s at 1440',
  async (locale) => {
    await page.viewport(1440, 900);
    setLocale(locale);
    loadCoworkerActivity.mockResolvedValue({
      items: [
        {
          id: 'work:1',
          kind: 'work',
          title: 'Review',
          detail: null,
          state: null,
          at: '2026-08-15T00:00:00Z',
          to: '/work/1',
        },
      ],
      work: 'ok',
      chat: 'ok',
    } as never);
    const host = document.createElement('div');
    host.style.width = '1368px';
    host.style.height = '900px';
    document.body.append(host);
    const root = createRoot(host);
    try {
      for (const hasDefinition of [false, true]) {
        const profile = profileFor('available');
        loadCoworkers.mockResolvedValue([profile.agent]);
        loadCoworkerProfile.mockResolvedValue({
          ...profile,
          workCatalog: hasDefinition
            ? [
                {
                  definitionId: 'definition',
                  definitionVersionId: 'version',
                  name: 'review',
                  description: 'Review',
                  inputSchema: {
                    properties: {},
                    required: [],
                    additionalProperties: false,
                  },
                },
              ]
            : [],
        });
        await act(async () =>
          root.render(
            <React.Fragment key={String(hasDefinition)}>
              {routed(`/agents/${AGENT_ID}`)}
            </React.Fragment>,
          ),
        );
        const keys = hasDefinition
          ? (['agents.startWork', 'agents.activityWorkHint'] as const)
          : (['agents.noCapabilities', 'agents.browseWorkCatalog'] as const);
        for (const key of keys) {
          const copy = copyRegressions[key][locale];
          const element = findCopy(host, copy.after);
          copyMeasurements.push({
            locale,
            key,
            ...measureCopy(element, copy.before),
          });
        }
      }
    } finally {
      await act(async () => root.unmount());
      host.remove();
      await commands.writeInventory(
        JSON.stringify({
          kind: 'profile-copy',
          measurements: copyMeasurements,
        }),
        'canary',
      );
      setLocale('en');
      loadCoworkerActivity.mockResolvedValue({
        items: [],
        work: 'skipped',
        chat: 'ok',
      });
    }
  },
);
