import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { setLocale } from '../../../i18n';

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
import {
  projectWorkList,
  projectWorkRunList,
} from '@/test-support/product-recording-test-helpers';

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
    const selected = workResponse.works.find(
      (work) => path === `/api/works/${work.id}/runs`,
    );
    if (selected) {
      const seed = projectWorkRunList(parallelRecording, baseWork.id)
        .work_runs[0]!;
      return jsonResponse({
        work_runs: [1, 2, 3].map((n) => ({
          ...seed,
          id: uuid(n + 200),
          work_id: selected.id,
        })),
        next_cursor: null,
      });
    }
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

it('renders Work state and run counts without latest Run summaries', async () => {
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
    for (const [index] of stateCases.entries()) {
      const card = cards.find(
        (card) =>
          card.querySelector('a')?.getAttribute('href') ===
          `/work/${populatedWorkList.works[index]!.id}`,
      )!;
      expect(card.querySelector('a')?.getAttribute('aria-label')).toContain(
        'Active',
      );
      expect(card.textContent).toContain(`WorkRun: ${stateCases[index]![1]}`);
      expect(card.textContent).toContain('3 WorkRuns');
      // The list row is a navigation index, not a place to read a Run's
      // result: it shows state and a compact timestamp, not result text.
      expect(card.textContent).not.toContain(
        `Latest recorded result ${index + 1}`,
      );
      expect(card.querySelector('time')).not.toBeNull();
      expect(card.querySelector('a')?.getAttribute('href')).toBe(
        `/work/${populatedWorkList.works[index]!.id}`,
      );
    }

    expect(host.textContent).not.toContain('TeamRun');
    expect(host.textContent).not.toContain('RuntimeSession');
    expect(host.textContent).not.toContain('participating Agents');
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual(
      expect.arrayContaining(['/api/works', '/api/work-definitions']),
    );
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it('starts catalog Definitions without Coworker binding or initiator controls', async () => {
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
    const description = cards[0]!.querySelector<HTMLElement>(
      '.work-catalog-card__description',
    );
    expect(description?.textContent).toContain('must wrap inside');
    expect(description?.getAttribute('title')).toBe(boundDescription);
    expect(getComputedStyle(description!).overflow).toBe('visible');
    expect(getComputedStyle(description!).whiteSpace).toBe('normal');

    for (const card of cards) {
      expect(card.querySelector('details')).toBeNull();
      expect(card.textContent).not.toContain('Maya');
    }
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
        'Publish a Definition before creating Work',
      );
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    }
  },
);

it.each(['en', 'zh-CN'] as const)(
  'measures %s directory density and long titles at 1440',
  async (locale) => {
    setLocale(locale);
    await page.viewport(1440, 900);
    const works = Array.from({ length: 30 }, (_, index) => ({
      ...populatedWorkList.works[index % 5]!,
      id: uuid(index + 1000),
      title:
        index === 1
          ? 'A'.repeat(199) + 'B'
          : index === 2
            ? '中'.repeat(199) + '文'
            : `Work ${index + 1}`,
    }));
    vi.stubGlobal('fetch', workPaneFetch({ works, next_cursor: null }));
    const host = document.createElement('div');
    host.className = 'app-shell';
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => {
        root.render(
          <MemoryRouter>
            <div />
            <WorkPane onCreateNew={() => undefined} />
            <main />
          </MemoryRouter>,
        );
      });
      const scroller = host.querySelector<HTMLElement>('.work-pane-scroll')!;
      const rows = [
        ...host.querySelectorAll<HTMLElement>('[data-testid="work-list"] > li'),
      ];
      const rect = scroller.getBoundingClientRect();
      expect({
        scrollerHeight: rect.height,
        scrollerTop: rect.top,
        firstTop: rows[0]!.getBoundingClientRect().top,
        firstHeight: rows[0]!.getBoundingClientRect().height,
        fifteenthBottom: rows[14]!.getBoundingClientRect().bottom,
        scrollerBottom: rect.bottom,
      }).toEqual({
        scrollerHeight: 788,
        scrollerTop: 96,
        firstTop: 100,
        firstHeight: 49.5,
        fifteenthBottom: 912.5,
        scrollerBottom: 884,
      });
      expect(
        rows.filter((row) => row.getBoundingClientRect().bottom <= rect.bottom),
      ).toHaveLength(14);
      expect(rect.height).toBe(788);
      expect(rect.top).toBe(96);
      for (const row of rows) {
        expect(row.getBoundingClientRect().height).toBe(49.5);
        // 307, not 292: `.work-pane-scroll { scrollbar-gutter: stable }`
        // (63bf7162, landed before this pin) reserves a ~15px scrollbar
        // gutter that this row width must account for.
        expect(row.getBoundingClientRect().width).toBe(307);
        expect(row.scrollWidth).toBe(row.clientWidth);
      }
      const longRows = rows.filter(
        (row) =>
          row.querySelector('strong')?.getAttribute('title')?.length === 200,
      );
      expect(longRows).toHaveLength(2);
      for (const row of longRows) {
        const title = row.querySelector('strong')!;
        expect(title.getBoundingClientRect().height).toBe(19.5);
        expect(getComputedStyle(title).fontSize).toBe('13px');
        expect(title.getAttribute('title')).toHaveLength(200);
        const suffix = title.querySelector('.work-scannable-title__suffix')!;
        expect(suffix.getBoundingClientRect().right).toBeLessThanOrEqual(
          title.getBoundingClientRect().right,
        );
        expect(suffix.textContent).toBe(title.getAttribute('title')!.slice(-8));
      }
      expect(innerWidth).toBe(1440);
      expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight);
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
      setLocale('en');
    }
  },
);

it('shows a stale-data warning after a failed refresh and recovers on retry', async () => {
  const fetchMock = workPaneFetch(populatedWorkList);
  vi.stubGlobal('fetch', fetchMock);
  const host = document.createElement('div');
  host.className = 'app-shell';
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <div />
          <WorkPane onCreateNew={() => undefined} />
          <main />
        </MemoryRouter>,
      );
    });
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input) => {
      if (String(input) === '/api/works')
        throw new TypeError('private network failure');
      return original(input);
    });
    await act(async () => {
      host
        .querySelector<HTMLButtonElement>('button[aria-label="Refresh Work"]')!
        .click();
    });
    const warning = host.querySelector('[data-testid="work-list-error"]')!;
    expect(warning.textContent).toContain('last loaded Works');
    expect(
      host.querySelectorAll('[data-testid="work-list"] > li'),
    ).toHaveLength(5);
    expect(host.textContent).not.toContain('private network failure');
    fetchMock.mockImplementation(original);
    await act(async () => {
      warning.querySelector<HTMLButtonElement>('button')!.click();
    });
    expect(host.querySelector('[data-testid="work-list-error"]')).toBeNull();
    expect(
      host.querySelectorAll('[data-testid="work-list"] > li'),
    ).toHaveLength(5);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it('orders by Work or latest Run activity and distinguishes attention without reading titles', async () => {
  const works = populatedWorkList.works.slice(0, 3).map((work, index) => ({
    ...work,
    product_state:
      index === 0
        ? ('problem' as const)
        : index === 1
          ? ('needs_you' as const)
          : ('running' as const),
    updated_at:
      index === 1 ? '2026-09-05T00:00:00.000Z' : '2026-09-01T00:00:00.000Z',
    latest_run_summary: {
      ...work.latest_run_summary!,
      updated_at: `2026-09-0${index === 2 ? 4 : 3}T00:00:00.000Z`,
    },
  }));
  vi.stubGlobal('fetch', workPaneFetch({ works, next_cursor: null }));
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(renderPane());
    });
    const links = [
      ...host.querySelectorAll<HTMLAnchorElement>(
        '[data-testid="work-list"] a',
      ),
    ];
    expect(links.map((link) => link.getAttribute('href'))).toEqual(
      [works[1], works[2], works[0]].map((work) => `/work/${work!.id}`),
    );
    const problem = host.querySelector<HTMLElement>(
      '[data-run-state="problem"] .work-list-mark',
    )!;
    const waiting = host.querySelector<HTMLElement>(
      '[data-run-state="needs_you"] .work-list-mark',
    )!;
    expect(problem.textContent).toBe('!');
    expect(waiting.textContent).toBe('?');
    expect(getComputedStyle(problem).backgroundColor).not.toBe(
      getComputedStyle(waiting).backgroundColor,
    );
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it.each(['en', 'zh-CN'] as const)(
  'keeps distinguishing suffixes visible in %s recent Work names',
  async (locale) => {
    await page.viewport(1440, 900);
    setLocale(locale);
    const works = populatedWorkList.works.slice(0, 2).map((work, index) => ({
      ...work,
      title: index === 0 ? 'A'.repeat(199) + 'B' : '中'.repeat(199) + '文',
    }));
    vi.stubGlobal('fetch', workPaneFetch({ works, next_cursor: null }));
    const host = document.createElement('div');
    host.className = 'app-shell';
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => {
        root.render(
          <MemoryRouter>
            <div />
            <WorkPage />
          </MemoryRouter>,
        );
      });
      const names = [
        ...host.querySelectorAll<HTMLElement>('.work-landing__recent strong'),
      ];
      expect(names).toHaveLength(2);
      for (const [index, name] of names.entries()) {
        expect(name.getBoundingClientRect().height).toBe(24);
        // `.work-landing__recent a` gives the title a `minmax(0, 1fr)`
        // middle column between two `max-content` siblings (the
        // `work.latestState` state pill and the run timestamp). The
        // `work.latestState` copy ("Latest WorkRun: {state}" /
        // "最新 WorkRun：{state}") is an already-shipped vocabulary
        // decision (92100dba) that landed after this pin was first
        // measured (6e7adb4b / 08600a88), so the pill now legitimately
        // claims ~130px more of the row and the title gets the
        // remainder by design of the grid — not a CSS regression.
        expect(name.getBoundingClientRect().width).toBe(
          locale === 'zh-CN'
            ? index === 0
              ? 403.703125
              : 401.3125
            : index === 0
              ? 388.46875
              : 402.15625,
        );
        expect(name.getAttribute('title')).toHaveLength(200);
        const suffix = name.querySelector<HTMLElement>(
          '.work-scannable-title__suffix',
        )!;
        expect(suffix.textContent).toBe(name.getAttribute('title')!.slice(-8));
        expect(suffix.getBoundingClientRect().right).toBeLessThanOrEqual(
          name.getBoundingClientRect().right,
        );
        expect(suffix.getBoundingClientRect().width).toBeGreaterThan(0);
      }
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
      setLocale('en');
    }
  },
);
