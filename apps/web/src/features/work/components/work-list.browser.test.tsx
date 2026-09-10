import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';

import type {
  WorkListItem,
  WorkListResponse,
} from '@atomlink-ye/agent-server/product-contract';
import { MemoryRouter } from 'react-router-dom';

import { WorkPage } from '../WorkPage';
import { WorkPane } from '@/features/work/WorkPane';
import '../../../index.css';
import './work-list.css';
import { AppProviders } from '../../../app/providers';
import { AppRouter } from '../../../app/router';
import parallelRecording from '@/test-support/fixtures/product-recordings/parallel-success.json';
import { projectWorkList } from '@/test-support/product-recording-test-helpers';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const baseWork = projectWorkList(parallelRecording).works[0]!;
const stateCases = [
  ['running', 'Running'],
  ['needs_you', 'Needs You'],
  ['complete', 'Complete'],
  ['problem', 'Problem'],
  ['not_captured', 'Status unknown'],
] as const;

const populatedWorkList: WorkListResponse = {
  works: stateCases.map(([productState], index): WorkListItem => ({
    ...baseWork,
    id: uuid(index + 1),
    title: `Work ${index + 1}`,
    product_state: productState,
    latest_run_summary: {
      id: uuid(index + 101),
      updated_at: `2026-08-16T10:0${index}:00.000Z`,
      result_summary: `Latest recorded result ${index + 1}`,
      result_capture_status: 'present',
    },
  })),
  next_cursor: null,
};

const emptyWorkList: WorkListResponse = {
  works: [],
  next_cursor: null,
};

function uuid(value: number) {
  return `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}

function workPaneFetch(workResponse: WorkListResponse) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path === '/api/works') return jsonResponse(workResponse);
    // WorkPane reads the catalog and Coworker roster independently of the
    // history list. Keep those reads explicit so a Work-list fixture cannot
    // accidentally masquerade as a Definition response.
    if (path === '/api/work-definitions') {
      return jsonResponse({ items: [], next_cursor: null });
    }
    if (path === '/api/agents') {
      return jsonResponse({ items: [], next_cursor: null });
    }
    if (path === '/api/auth/me') {
      return jsonResponse({
        user_id: 'browser-test-user',
        username: 'browser-test',
        display_name: 'Browser Test',
      });
    }
    throw new Error(`unexpected browser request: ${path}`);
  });
}

const catalogDefinitionId = uuid(901);
const catalogVersionId = uuid(902);
const unboundDefinitionId = uuid(903);
const unboundVersionId = uuid(904);
const catalogAgentId = uuid(905);

function catalogVersion(
  definitionId: string,
  versionId: string,
  name: string,
  description: string,
) {
  return {
    version: {
      id: versionId,
      definition_id: definitionId,
      status: 'published',
      fingerprint: `sha256:${'a'.repeat(64)}`,
      source: {
        apiVersion: 'agentserver.dev/v1alpha1',
        kind: 'WorkDefinition',
        metadata: { name, description },
        spec: { kind: 'single_worker' },
      },
      source_yaml: `apiVersion: agentserver.dev/v1alpha1\nkind: WorkDefinition\nmetadata:\n  name: ${name}\n`,
      resolved: { resource_manifest_fingerprint: `sha256:${'b'.repeat(64)}` },
      created_at: '2026-08-16T10:00:00.000Z',
      published_at: '2026-08-16T10:00:00.000Z',
      links: {
        self: `/api/v1/work-definition-versions/${versionId}`,
        definition: `/api/v1/work-definitions/${definitionId}`,
      },
    },
  };
}

function catalogPlanResponse(name: string): Response {
  return jsonResponse({
    valid: true,
    fingerprint: `sha256:${'c'.repeat(64)}`,
    metadata: { normalized_name: name },
    resolved: {
      kind: 'single_worker',
      participants: [
        {
          name: 'Worker',
          role: 'primary',
          source: 'inline',
          worker_version_id: null,
          skills: [],
          tools: [],
        },
      ],
      environment: { source: 'inline', environment_version_id: null },
      memory_version_ids: [],
      required_runtime_capabilities: [],
      platform_capabilities: [],
      materialization: {
        inline_workers: 1,
        inline_environment: true,
        internal_team: false,
      },
    },
    diagnostics: [],
  });
}

function renderPane() {
  return (
    <MemoryRouter initialEntries={['/work']}>
      <WorkPane onCreateNew={() => undefined} />
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

async function settleNetworkTurn() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

it('renders Product Work state and latest Run summary with one list read', async () => {
  const fetchMock = workPaneFetch(populatedWorkList);
  vi.stubGlobal('fetch', fetchMock);

  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(renderPane());
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const cards = [
      ...host.querySelectorAll<HTMLLIElement>('[data-testid="work-list"] > li'),
    ];
    expect(cards).toHaveLength(stateCases.length);
    for (const [index, [, stateLabel]] of stateCases.entries()) {
      const card = cards[index]!;
      expect(card.textContent).toContain(stateLabel);
      // The list row is a navigation index, not a place to read a Run's
      // result: it shows state and a compact timestamp, not result text.
      expect(card.textContent).not.toContain(
        `Latest recorded result ${index + 1}`,
      );
      expect(card.querySelector('time')?.textContent).toMatch(/^Run /);
      expect(
        card
          .querySelector('[data-product-state]')
          ?.getAttribute('data-product-state'),
      ).toBe(stateCases[index]![0]);
      expect(card.querySelector('a')?.getAttribute('href')).toBe(
        `/work/${populatedWorkList.works[index]!.id}`,
      );
    }

    expect(host.textContent).not.toContain('TeamRun');
    expect(host.textContent).not.toContain('RuntimeSession');
    expect(host.textContent).not.toContain('participating Agents');
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual(
      expect.arrayContaining([
        '/api/works',
        '/api/work-definitions',
        '/api/agents',
      ]),
    );
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it('starts any catalog Definition directly and keeps Coworker visibility in a secondary menu', async () => {
  const catalogItems = [
    {
      definitionId: catalogDefinitionId,
      displayName: 'Bound research workflow',
      currentPublishedVersionId: catalogVersionId,
    },
    {
      definitionId: unboundDefinitionId,
      displayName: 'Unbound planning workflow',
      currentPublishedVersionId: unboundVersionId,
    },
  ];
  const boundDescription =
    'A long description that must wrap inside the catalog card instead of disappearing behind an overflow mask.';
  const responses = new Map<string, unknown>([
    ['/api/works', populatedWorkList],
    ['/api/work-definitions', { items: catalogItems, next_cursor: null }],
    [
      `/api/work-definition-versions/${catalogVersionId}`,
      catalogVersion(
        catalogDefinitionId,
        catalogVersionId,
        'Bound research workflow',
        boundDescription,
      ),
    ],
    [
      `/api/work-definition-versions/${unboundVersionId}`,
      catalogVersion(
        unboundDefinitionId,
        unboundVersionId,
        'Unbound planning workflow',
        'Short description',
      ),
    ],
    [
      `/api/work-definitions/${catalogDefinitionId}/agents`,
      {
        definition_id: catalogDefinitionId,
        definition_version_id: catalogVersionId,
        agents: [
          {
            agent_definition_id: catalogAgentId,
            definition_version_id: catalogVersionId,
            display_name:
              'Maya with an intentionally long coworker name for wrapping coverage',
            role_label: 'Researcher',
          },
          {
            agent_definition_id: uuid(907),
            definition_version_id: catalogVersionId,
            display_name: 'Theo',
            role_label: 'Editor',
          },
        ],
      },
    ],
    [
      `/api/work-definitions/${unboundDefinitionId}/agents`,
      {
        definition_id: unboundDefinitionId,
        definition_version_id: unboundVersionId,
        agents: [],
      },
    ],
    [
      '/api/agents',
      {
        items: [
          {
            id: catalogAgentId,
            display_name:
              'Maya with an intentionally long coworker name for wrapping coverage',
            role_label: 'Researcher',
            summary: 'Researches workflows.',
            active_agent_version_id: uuid(906),
            runtime_status: 'available',
          },
        ],
        next_cursor: null,
      },
    ],
  ]);
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (
      path ===
      `/api/work-definitions/${catalogDefinitionId}/agents/${catalogAgentId}`
    ) {
      return jsonResponse({ associated: true });
    }
    if (path === '/api/work-definitions/plan')
      return catalogPlanResponse('catalog-workflow');
    const body = responses.get(path);
    if (!body) throw new Error(`unexpected browser request: ${path}`);
    return jsonResponse(body);
  });
  vi.stubGlobal('fetch', fetchMock);

  const host = document.createElement('div');
  host.className = 'app-shell';
  host.style.height = '900px';
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/work']}>
          <div />
          <WorkPage />
        </MemoryRouter>,
      );
      await new Promise((resolve) => setTimeout(resolve, 25));
    });

    const catalog = host.querySelector<HTMLElement>(
      '[data-testid="work-definition-catalog"]',
    );
    expect(catalog).not.toBeNull();
    const cards = [...catalog!.querySelectorAll<HTMLElement>(':scope > li')];
    expect(cards).toHaveLength(2);
    expect(cards[0]!.classList.contains('work-catalog-card--bound')).toBe(true);
    expect(cards[1]!.classList.contains('work-catalog-card--unbound')).toBe(
      true,
    );

    const description = cards[0]!.querySelector<HTMLElement>(
      '.work-catalog-card__description',
    );
    expect(description?.textContent).toContain('must wrap inside');
    expect(description?.getAttribute('title')).toBe(boundDescription);
    expect(getComputedStyle(description!).overflow).toBe('visible');
    expect(getComputedStyle(description!).whiteSpace).toBe('normal');

    for (const card of cards) {
      const cardRect = card.getBoundingClientRect();
      const bindMenu = card.querySelector<HTMLElement>('details');
      expect(bindMenu).not.toBeNull();
      expect(bindMenu!.getBoundingClientRect().right).toBeLessThanOrEqual(
        cardRect.right + 1,
      );
      expect(
        card.querySelector('.work-catalog-card__actions details'),
      ).toBeNull();
    }
    await page.screenshot({
      path: '../../../../__screenshots__/ux-review/work-directory.png',
    });
    const menu = cards[0]!.querySelector<HTMLDetailsElement>('details')!;
    const summary = menu.querySelector('summary')!;
    expect(summary.tabIndex).toBe(0);
    await act(async () => summary.click());
    expect(menu.open).toBe(true);
    const coworkerButton = menu.querySelector<HTMLButtonElement>('button')!;
    expect(coworkerButton.textContent).toContain('intentionally long');
    expect(getComputedStyle(coworkerButton).overflowWrap).toBe('break-word');
    await act(async () => coworkerButton.click());
    expect(menu.open).toBe(false);
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toContain(
      `/api/work-definitions/${catalogDefinitionId}/agents/${catalogAgentId}`,
    );
    expect(
      cards[0]!.querySelector('a.work-catalog-card__create'),
    ).not.toBeNull();
    expect(
      cards[0]!
        .querySelector('a.work-catalog-card__create')
        ?.getAttribute('href'),
    ).toBe(
      `/work?new=1&definition=${catalogDefinitionId}&version=${catalogVersionId}`,
    );
    expect(cards[0]!.textContent).not.toContain('Choose an initiator');
    expect(cards[0]!.textContent).not.toContain('Start as');
    expect(
      cards[1]!.querySelector('a.work-catalog-card__create'),
    ).not.toBeNull();
    expect(
      getComputedStyle(
        host.querySelector('.work-catalog .pane-section-heading')!,
      ).borderBottomWidth,
    ).toBe('1px');
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual(
      expect.arrayContaining([
        '/api/works',
        '/api/work-definitions',
        `/api/work-definition-versions/${catalogVersionId}`,
        `/api/work-definition-versions/${unboundVersionId}`,
        `/api/work-definitions/${catalogDefinitionId}/agents`,
        `/api/work-definitions/${unboundDefinitionId}/agents`,
        '/api/work-definitions/plan',
        '/api/agents',
      ]),
    );
    await act(async () => {
      host
        .querySelector<HTMLButtonElement>('[data-testid="new-work-cta"]')!
        .click();
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
    expect(host.querySelector('#work-definition-choice')).not.toBeNull();
    expect(host.querySelector('#work-coworker')).toBeNull();
    await page.screenshot({
      path: '../../../../__screenshots__/ux-review/heading-plus.png',
    });
    await act(async () => {
      root.render(
        <MemoryRouter
          key="catalog-entry"
          initialEntries={[
            `/work?new=1&definition=${unboundDefinitionId}&version=${unboundVersionId}`,
          ]}
        >
          <div />
          <WorkPage />
        </MemoryRouter>,
      );
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
    expect(host.querySelector('#work-coworker')).toBeNull();
    expect(host.querySelector<HTMLInputElement>('#work-title')?.value).toBe(
      'Unbound Planning Workflow',
    );
    await page.screenshot({
      path: '../../../../__screenshots__/ux-review/catalog-entry.png',
    });
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it('scrolls the real Work list through its final Work item', async () => {
  const works = Array.from({ length: 48 }, (_, index) => ({
    ...populatedWorkList.works[0]!,
    id: uuid(index + 300),
    title: index === 47 ? 'Final real Work item' : `Long Work ${index}`,
  }));
  vi.stubGlobal('fetch', workPaneFetch({ works, next_cursor: null }));
  const host = document.createElement('div');
  host.style.height = '900px';
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/work']}>
          <AppProviders commands={shellCommands()}>
            <AppRouter />
          </AppProviders>
        </MemoryRouter>,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const list = host.querySelector<HTMLElement>('[data-testid="work-list"]');
    const scroller = host.querySelector<HTMLElement>('.work-pane-scroll');
    expect(list).not.toBeNull();
    expect(scroller).not.toBeNull();
    expect(scroller!.scrollHeight).toBeGreaterThan(scroller!.clientHeight);
    scroller!.scrollTop = scroller!.scrollHeight;
    expect(scroller!.scrollTop).toBeGreaterThan(0);
    const finalItem = [...list!.querySelectorAll('li')].at(-1)!;
    expect(finalItem.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      scroller!.getBoundingClientRect().bottom + 1,
    );
    await page.screenshot({
      path: '../../../../../../.local/work-list-scroll-desktop.png',
    });
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it('scrolls the Work list and catalog together while its heading stays fixed', async () => {
  const works = Array.from({ length: 25 }, (_, index) => ({
    ...populatedWorkList.works[0]!,
    id: uuid(index + 500),
    title:
      index === 24 ? 'Final combined-scroll Work item' : `Work ${index + 1}`,
  }));
  const definitions = Array.from({ length: 8 }, (_, index) => ({
    definitionId: uuid(index + 600),
    displayName:
      index === 7
        ? 'final-reachable-catalog-definition'
        : `catalog-definition-${index + 1}`,
    currentPublishedVersionId: uuid(index + 700),
  }));
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path === '/api/works')
      return jsonResponse({ works, next_cursor: null });
    if (path === '/api/work-definitions') {
      return jsonResponse({ items: definitions, next_cursor: null });
    }
    if (path === '/api/work-definitions/plan') {
      return catalogPlanResponse('combined-scroll-workflow');
    }
    if (path === '/api/agents') {
      return jsonResponse({ items: [], next_cursor: null });
    }
    const version = definitions.find(
      (item) =>
        path ===
        `/api/work-definition-versions/${item.currentPublishedVersionId}`,
    );
    if (version) {
      return jsonResponse(
        catalogVersion(
          version.definitionId,
          version.currentPublishedVersionId,
          version.displayName,
          'A catalog definition included to exercise real sidebar overflow.',
        ),
      );
    }
    const agents = definitions.find(
      (item) => path === `/api/work-definitions/${item.definitionId}/agents`,
    );
    if (agents) {
      return jsonResponse({
        definition_id: agents.definitionId,
        definition_version_id: agents.currentPublishedVersionId,
        agents: [],
      });
    }
    throw new Error(`unexpected browser request: ${path}`);
  });
  vi.stubGlobal('fetch', fetchMock);

  const host = document.createElement('div');
  host.className = 'app-shell';
  host.style.height = '900px';
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/work']}>
          <div aria-hidden="true" />
          <WorkPane onCreateNew={() => undefined} />
          <main />
        </MemoryRouter>,
      );
      await new Promise((resolve) => setTimeout(resolve, 500));
    });

    const pane = host.querySelector<HTMLElement>('.work-pane')!;
    const heading = pane.querySelector<HTMLElement>(':scope > .pane-heading')!;
    const scroller = pane.querySelector<HTMLElement>(
      ':scope > .work-pane-scroll',
    );
    const list = pane.querySelector<HTMLElement>('[data-testid="work-list"]')!;
    const catalog = pane.querySelector<HTMLElement>(
      '[data-testid="work-definition-catalog"]',
    )!;
    expect(catalog).not.toBeNull();
    expect(scroller).not.toBeNull();
    expect(scroller!.scrollHeight).toBeGreaterThan(scroller!.clientHeight);
    expect(list.scrollHeight).toBe(list.clientHeight);
    expect(pane.scrollHeight).toBe(pane.clientHeight);

    const headingTop = heading.getBoundingClientRect().top;
    scroller!.scrollTop = scroller!.scrollHeight;
    expect(scroller!.scrollTop).toBeGreaterThan(0);
    expect(heading.getBoundingClientRect().top).toBe(headingTop);

    const finalWork = [...list.querySelectorAll('li')].at(-1)!;
    const finalCatalog = [...catalog.querySelectorAll(':scope > li')].at(-1)!;
    expect(finalWork.textContent).toContain('Final combined-scroll Work item');
    expect(finalCatalog.textContent).toContain(
      'final-reachable-catalog-definition',
    );
    expect(finalCatalog.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      scroller!.getBoundingClientRect().bottom + 1,
    );
    expect(document.documentElement.scrollHeight).toBe(
      document.documentElement.clientHeight,
    );
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it('distinguishes loading, empty, and real network error without fabricating Work', async () => {
  let resolvePending!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    resolvePending = resolve;
  });
  const pendingFetch = vi.fn(async () => pending);
  vi.stubGlobal('fetch', pendingFetch);

  const loadingHost = document.createElement('div');
  document.body.append(loadingHost);
  const loadingRoot = createRoot(loadingHost);
  try {
    await act(async () => {
      loadingRoot.render(renderPane());
    });
    expect(
      loadingHost.querySelector('[data-testid="work-list-loading"]'),
    ).not.toBeNull();
    expect(loadingHost.querySelector('[data-testid="work-list"]')).toBeNull();

    await act(async () => {
      resolvePending(jsonResponse(emptyWorkList));
      await pending;
      await Promise.resolve();
    });
    expect(
      loadingHost.querySelector('[data-testid="work-list-empty"]'),
    ).not.toBeNull();
    expect(loadingHost.querySelector('a[href^="/work/"]')).toBeNull();
  } finally {
    await act(async () => loadingRoot.unmount());
    loadingHost.remove();
    vi.unstubAllGlobals();
  }

  const networkErrorFetch = vi.fn(async () => {
    throw new TypeError('network unavailable');
  });
  vi.stubGlobal('fetch', networkErrorFetch);
  const errorHost = document.createElement('div');
  document.body.append(errorHost);
  const errorRoot = createRoot(errorHost);
  try {
    await act(async () => {
      errorRoot.render(renderPane());
    });
    await settleNetworkTurn();
    expect(
      errorHost.querySelector('[data-testid="work-list-error"]'),
    ).not.toBeNull();
    expect(errorHost.textContent).toContain('This is a connection problem');
    expect(errorHost.querySelector('[data-testid="work-list"]')).toBeNull();
  } finally {
    await act(async () => errorRoot.unmount());
    errorHost.remove();
    vi.unstubAllGlobals();
  }
});

it.each([
  ['recent Work landing', '.work-landing__intro button', populatedWorkList],
  ['empty Work landing', '.work-main-empty--first button', emptyWorkList],
  [
    'empty Work directory',
    '[data-testid="work-list-empty"] button',
    emptyWorkList,
  ],
] as const)(
  'opens the Definition picker from the %s',
  async (_, selector, works) => {
    vi.stubGlobal('fetch', workPaneFetch(works));
    const host = document.createElement('div');
    host.className = 'app-shell';
    host.style.height = '900px';
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => {
        root.render(
          <MemoryRouter initialEntries={['/work']}>
            <div />
            <WorkPage />
          </MemoryRouter>,
        );
        await new Promise((resolve) => setTimeout(resolve, 25));
      });
      const entry = host.querySelector<HTMLButtonElement>(selector)!;
      expect(entry).not.toBeNull();
      await act(async () => {
        entry.click();
        await new Promise((resolve) => setTimeout(resolve, 25));
      });
      expect(host.querySelector('#work-definition-choice')).not.toBeNull();
      expect(host.querySelector('#work-coworker')).toBeNull();
      expect(host.textContent).toContain(
        'No published Definitions are available',
      );
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    }
  },
);
