import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';

import {
  GetWorkResponseSchema,
  ProductRunTraceSuccessSchema,
  ProductWorkDefinitionVersionSchema,
  ProductWorkRunSuccessSchema,
  type ProductSessionTranscriptsResponse,
} from '@atomlink-ye/agent-server/product-contract';
import { AppProviders } from '@/app/providers';
import { AppRouter } from '@/app/router';
import { WorkDetailPage } from '@/features/work/pages/WorkDetailPage';
import '../../../index.css';
import reworkRecording from '@/test-support/fixtures/product-recordings/rework-once.json';
import {
  projectWorkList,
  projectWorkRunList,
} from '@/test-support/product-recording-test-helpers';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const trace = ProductRunTraceSuccessSchema.parse(
  reworkRecording.recording_documents[0],
);
const projectedWorks = projectWorkList(reworkRecording);
const work = GetWorkResponseSchema.parse({ work: trace.work });
const runs = projectWorkRunList(reworkRecording, work.work.id);
const selectedRun = runs.work_runs[0]!;
const run = ProductWorkRunSuccessSchema.parse({
  work: trace.work,
  work_run: trace.work_run,
  work_items: trace.work_items,
  actors: trace.actors,
  messages: trace.messages,
  projection_status: trace.projection_status,
});
const environmentVersionId = '00000000-0000-4000-8000-000000000701';
const leadVersionId = '00000000-0000-4000-8000-000000000702';
const researcherVersionId = '00000000-0000-4000-8000-000000000703';

const definitionVersion = productDefinitionVersion(
  selectedRun.definition_version_id,
  'supplier-risk-review',
);

function productDefinitionVersion(versionId: string, name: string) {
  return ProductWorkDefinitionVersionSchema.parse({
    id: versionId,
    definition_id: work.work.definition_id,
    status: 'published',
    fingerprint: `sha256:${'a'.repeat(64)}`,
    source: {
      apiVersion: 'agentserver.dev/v1alpha1',
      kind: 'WorkDefinition',
      metadata: {
        name,
        description: 'Review supplier risk using the selected Definition.',
      },
      spec: {
        kind: 'collaboration',
        lead: { name: 'Lead', agent_version_id: leadVersionId },
        members: [
          { name: 'Researcher', agent_version_id: researcherVersionId },
        ],
        environment_version_id: environmentVersionId,
        memory_version_ids: [],
        input_schema: {
          type: 'object',
          properties: {},
          required: [],
          additional_properties: false,
        },
      },
    },
    source_yaml: `apiVersion: agentserver.dev/v1alpha1
kind: WorkDefinition
metadata:
  name: ${name}
spec:
  kind: collaboration
`,
    resolved: {
      resource_manifest_fingerprint: `sha256:${'b'.repeat(64)}`,
    },
    created_at: work.work.created_at,
    published_at: work.work.updated_at,
    links: {
      self: `/api/v1/work-definition-versions/${versionId}`,
      definition: `/api/v1/work-definitions/${work.work.definition_id}`,
    },
  });
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}

function planResponse(): Response {
  return jsonResponse({
    valid: true,
    fingerprint: `sha256:${'c'.repeat(64)}`,
    metadata: { normalized_name: 'supplier-risk-review' },
    resolved: {
      kind: 'collaboration',
      participants: [
        {
          name: 'Lead',
          role: 'lead',
          source: 'referenced',
          worker_version_id: leadVersionId,
          skills: [],
          tools: [],
        },
      ],
      environment: {
        source: 'referenced',
        environment_version_id: environmentVersionId,
      },
      memory_version_ids: [],
      required_runtime_capabilities: [
        'reusable_session',
        'external_workspace',
        'platform_mcp',
      ],
      platform_capabilities: ['collaboration', 'platform_mcp'],
      materialization: {
        inline_workers: 0,
        inline_environment: false,
        internal_team: true,
      },
    },
    diagnostics: [],
  });
}

function mockProductReads(
  input: {
    readonly runList?: typeof runs;
    readonly selectedRunId?: string;
    readonly runBody?: unknown;
    readonly states?: Readonly<
      Record<string, typeof run.work_run.product_state>
    >;
    readonly definition?: ReturnType<typeof productDefinitionVersion>;
    readonly currentDefinitionMissing?: boolean;
    readonly sessionTranscripts?:
      | ProductSessionTranscriptsResponse
      | Promise<ProductSessionTranscriptsResponse>;
    readonly chatMessages?: readonly unknown[];
    readonly preparationMessages?: readonly unknown[];
    readonly preparation?: unknown;
  } = {},
) {
  const runList = input.runList ?? runs;
  const runId = input.selectedRunId ?? selectedRun.id;
  const definition = input.definition ?? definitionVersion;
  const responses = new Map<string, unknown>([
    [
      '/api/auth/me',
      {
        user_id: 'browser-test-user',
        username: 'browser-test',
        display_name: 'Browser Test',
      },
    ],
    ['/api/works', { works: projectedWorks.works, next_cursor: null }],
    [
      '/api/runtime-capabilities',
      {
        supported_runtime_capabilities: [
          'reusable_session',
          'external_workspace',
          'platform_mcp',
        ],
      },
    ],
    [
      `/api/work-definition-versions/${work.work.definition_version_id}`,
      { version: definitionVersion },
    ],
    [`/api/works/${work.work.id}`, work],
    [`/api/works/${work.work.id}/runs`, runList],
    [`/api/work-definition-versions/${definition.id}`, { version: definition }],
    [`/api/works/${work.work.id}/runs/${runId}`, input.runBody ?? run],
    [`/api/works/${work.work.id}/runs/${runId}/trace`, trace],
    [
      `/api/works/${work.work.id}/runs/${runId}/session-transcripts`,
      input.sessionTranscripts,
    ],
    [
      `/api/works/${work.work.id}/chat`,
      {
        work_id: work.work.id,
        work_run_id: null,
        // The preparation bucket serves the fixture messages too, so
        // Work-level preparation-chat assertions keep real content.
        messages: input.preparationMessages ?? input.chatMessages ?? [],
        preparation: input.preparation ?? null,
      },
    ],
    [
      `/api/works/${work.work.id}/runs/${runId}/chat`,
      {
        work_id: work.work.id,
        work_run_id: runId,
        messages: input.chatMessages ?? [],
        preparation: null,
      },
    ],
  ]);
  for (const summary of runList.work_runs) {
    if (summary.id === runId && input.runBody) continue;
    responses.set(`/api/works/${work.work.id}/runs/${summary.id}`, {
      ...run,
      work_run: {
        ...run.work_run,
        id: summary.id,
        definition_version_id: summary.definition_version_id,
        product_state: input.states?.[summary.id] ?? run.work_run.product_state,
      },
    });
  }
  const fetchMock = vi.fn().mockImplementation(async (path: string) => {
    if (
      input.currentDefinitionMissing &&
      path ===
        `/api/work-definition-versions/${work.work.definition_version_id}`
    ) {
      return {
        ok: false,
        status: 404,
        json: async () => ({ error: { code: 'work_not_found' } }),
      } as Response;
    }
    const body = responses.get(path);
    if (path === '/api/work-definitions/plan') return planResponse();
    if (!body) throw new Error(`unexpected request: ${path}`);
    return jsonResponse(body);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const longTranscript: ProductSessionTranscriptsResponse = {
  work_id: work.work.id,
  work_run_id: selectedRun.id,
  capture_scope: 'safe_run_events',
  sessions: [
    {
      label: {
        name: 'Recorded projection-worker',
        role: 'member',
        status: 'completed',
        status_basis: 'team_member_run',
        source_refs: {
          team_member_run_id: '8c6f3cfd-6a94-4ff7-88ec-c27ac9b1618f',
        },
      },
      summary: {
        status: 'completed',
        entry_count: 48,
        last_timestamp: '2026-08-13T02:48:00.000Z',
        last_meaningful: null,
        work_refs: [],
        truncated: false,
      },
      entries: Array.from({ length: 48 }, (_, index) => ({
        ordinal: index + 1,
        kind: 'assistant_text' as const,
        sequence: index + 1,
        created_at: `2026-08-13T02:${String(index + 1).padStart(2, '0')}:00.000Z`,
        text:
          index === 47
            ? 'Final real Work transcript entry'
            : `Recorded Work transcript checkpoint ${index + 1}`,
      })),
    },
  ],
};

const longChatMessages = Array.from({ length: 80 }, (_, index) => ({
  id: `00000000-0000-4000-8000-${String(index + 800).padStart(12, '0')}`,
  sequence: index + 1,
  role: index % 2 === 0 ? 'lead' : 'user',
  body:
    index === 79
      ? 'Final visible Work Chat message'
      : `Recorded Work Chat message ${index + 1}`,
  status: 'replied',
  reply_to_message_id: null,
  failure_code: null,
  created_at: `2026-08-13T03:${String(index % 60).padStart(2, '0')}:00.000Z`,
}));

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

it('scrolls the real Work detail transcript to its final entry in the AppShell router', async () => {
  const fetchMock = mockProductReads({ sessionTranscripts: longTranscript });
  const host = document.createElement('div');
  host.style.height = '900px';
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(
        <MemoryRouter
          initialEntries={[
            `/work/${work.work.id}?tab=transcript&run=${selectedRun.id}`,
          ]}
        >
          <AppProviders commands={shellCommands()}>
            <AppRouter />
          </AppProviders>
        </MemoryRouter>,
      );
      for (let turn = 0; turn < 8; turn += 1)
        await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const content = host.querySelector<HTMLElement>('.work-main-content');
    expect(content).not.toBeNull();
    expect(content!.textContent).toContain('Final real Work transcript entry');
    expect(content!.scrollHeight).toBeGreaterThan(content!.clientHeight);
    content!.scrollTop = content!.scrollHeight;
    expect(content!.scrollTop).toBeGreaterThan(0);
    const finalEntry = [
      ...content!.querySelectorAll<HTMLElement>('.transcript__prose'),
    ].find((entry) =>
      entry.textContent?.includes('Final real Work transcript entry'),
    )!;
    expect(finalEntry.textContent).toContain(
      'Final real Work transcript entry',
    );
    expect(finalEntry.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      content!.getBoundingClientRect().bottom + 1,
    );
    expect(fetchMock.mock.calls.map(([path]) => path)).toContain(
      `/api/works/${work.work.id}/runs/${selectedRun.id}/session-transcripts`,
    );
    await page.screenshot({
      path: '../../../../__screenshots__/ux-review/work-detail-transcript-scroll-desktop.png',
    });
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it('keeps the Work Chat composer visible when the main Work viewport reaches the latest message', async () => {
  const fetchMock = mockProductReads({ chatMessages: longChatMessages });
  const host = document.createElement('div');
  host.style.height = '900px';
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(
        <MemoryRouter
          initialEntries={[
            `/work/${work.work.id}?tab=chat&run=${selectedRun.id}`,
          ]}
        >
          <AppProviders commands={shellCommands()}>
            <AppRouter />
          </AppProviders>
        </MemoryRouter>,
      );
      for (let turn = 0; turn < 8; turn += 1)
        await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const content = host.querySelector<HTMLElement>('.work-main-content');
    const shell = host.querySelector<HTMLElement>('.work-shell');
    const composer = host.querySelector<HTMLElement>('.work-chat-composer');
    expect(content).not.toBeNull();
    expect(shell).not.toBeNull();
    expect(composer).not.toBeNull();
    expect(content!.textContent).toContain('Final visible Work Chat message');
    const requestedPaths = fetchMock.mock.calls.map(([path]) => path);
    expect(requestedPaths).toContain(
      `/api/works/${work.work.id}/runs/${selectedRun.id}/chat`,
    );
    expect(requestedPaths).not.toContain(`/api/works/${work.work.id}/chat`);
    content!.scrollTop = content!.scrollHeight;
    const contentRect = content!.getBoundingClientRect();
    const shellRect = shell!.getBoundingClientRect();
    const composerRect = composer!.getBoundingClientRect();
    expect(
      Math.abs(shellRect.top + content!.scrollTop - contentRect.top),
    ).toBeLessThanOrEqual(1);
    expect(composerRect.top).toBeGreaterThanOrEqual(contentRect.top);
    expect(composerRect.bottom).toBeLessThanOrEqual(contentRect.bottom);
    await page.screenshot({
      path: '../../../../__screenshots__/ux-review/work-chat-composer-bottom-desktop.png',
    });
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

async function renderDetail(
  props: React.ComponentProps<typeof WorkDetailPage> = {
    workId: work.work.id,
  },
) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <MemoryRouter>
        <WorkDetailPage {...props} />
      </MemoryRouter>,
    );
    await new Promise((resolve) => setTimeout(resolve, 25));
  });
  return { host, root };
}

it('renders a Work record with Work-only tabs through Product reads only', async () => {
  const fetchMock = mockProductReads();
  const { host, root } = await renderDetail();
  try {
    expect(host.textContent).toContain(work.work.title);
    expect(
      [...host.querySelectorAll<HTMLAnchorElement>('.work-tabs a')].map(
        (item) => item.textContent?.trim(),
      ),
    ).toEqual(['WorkRuns', 'Current Definition']);
    await page.screenshot({
      path: '../../../../__screenshots__/ux-review/work-overview.png',
    });
    expect(
      host.querySelector('.work-tabs a[aria-current="page"]')?.textContent,
    ).toBe('WorkRuns');
    expect(host.textContent).not.toContain(
      'Everything captured during this WorkRun',
    );
    expect(host.textContent).toContain('Start WorkRun');
    expect(host.querySelector('[data-testid=work-record]')).not.toBeNull();
    expect(
      host.querySelector('.work-detail-header .work-state-pill')?.textContent,
    ).toBe('Active');
    const row = host.querySelector('.work-record .work-run-list > li')!;
    expect(row).not.toBeNull();
    expect([...row.querySelectorAll('a')].map((a) => a.textContent)).toEqual([
      'Conversation',
      'Output',
      'Activity',
    ]);
    for (const [index, tab] of ['chat', 'result', 'transcript'].entries())
      expect(row.querySelectorAll('a')[index]?.getAttribute('href')).toBe(
        `/work/${work.work.id}?tab=${tab}&run=${selectedRun.id}`,
      );
    expect(
      host.querySelector<HTMLDetailsElement>('.work-record-metadata')?.open,
    ).toBe(false);
    const paths = fetchMock.mock.calls.map(([path]) => path as string);
    expect(paths).toContain(`/api/works/${work.work.id}`);
    expect(paths).toContain(`/api/works/${work.work.id}/runs`);
    expect(paths).toContain(
      `/api/work-definition-versions/${work.work.definition_version_id}`,
    );
    expect(paths.some((path) => path.endsWith('/definition'))).toBe(false);
    expect(paths.some((path) => path.includes('/team-runs'))).toBe(false);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it('renders the exact Product DefinitionVersion used by the selected Run', async () => {
  mockProductReads();
  const { host, root } = await renderDetail({
    workId: work.work.id,
    tab: 'definition',
    selectedRunId: selectedRun.id,
  });
  try {
    expect(
      host.querySelector('[data-testid="definition-viewer"]'),
    ).not.toBeNull();
    expect(host.textContent).toContain('supplier-risk-review');
    expect(host.textContent).toContain('collaboration');
    expect(host.textContent).toContain('Lead');
    expect(host.textContent).toContain('Researcher');
    expect(host.textContent).toContain(selectedRun.definition_version_id);
    expect(host.querySelector('.work-run-header')?.textContent).toContain(
      'WorkRun #1',
    );
    expect(
      [...host.querySelectorAll('.work-tabs a')].map((a) => a.textContent),
    ).toEqual(['Conversation', 'Output', 'Activity', 'Definition used']);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it('reads an exact historical DefinitionVersion instead of falling back to Team-shaped Work Definition', async () => {
  const historicalRunId = '00000000-0000-4000-8000-000000000791';
  const historicalDefinitionId = '00000000-0000-4000-8000-000000000792';
  const historicalSummary = {
    ...selectedRun,
    id: historicalRunId,
    definition_version_id: historicalDefinitionId,
    created_at: '2026-08-15T00:00:00.000Z',
  };
  const runList = {
    ...runs,
    work_runs: [selectedRun, historicalSummary],
  };
  const historicalRun = {
    ...run,
    work_run: {
      ...run.work_run,
      id: historicalRunId,
      definition_version_id: historicalDefinitionId,
    },
  };
  const historicalDefinition = productDefinitionVersion(
    historicalDefinitionId,
    'supplier-risk-review-v6',
  );
  const fetchMock = mockProductReads({
    runList,
    selectedRunId: historicalRunId,
    runBody: historicalRun,
    definition: historicalDefinition,
  });

  const { host, root } = await renderDetail({
    workId: work.work.id,
    tab: 'definition',
    selectedRunId: historicalRunId,
  });
  try {
    expect(
      host.querySelector('[data-testid="definition-viewer"]'),
    ).not.toBeNull();
    expect(host.textContent).toContain('supplier-risk-review-v6');
    expect(host.textContent).toContain(historicalDefinitionId);
    const paths = fetchMock.mock.calls.map(([path]) => path as string);
    expect(paths).toContain(
      `/api/work-definition-versions/${historicalDefinitionId}`,
    );
    expect(paths.some((path) => path.endsWith('/definition'))).toBe(false);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it('does not invent a runnable Work when its current DefinitionVersion is missing', async () => {
  const fetchMock = mockProductReads({ currentDefinitionMissing: true });
  const { host, root } = await renderDetail();
  try {
    expect(host.textContent).toContain(work.work.title);
    expect(host.textContent).not.toContain(
      'Everything captured during this WorkRun',
    );
    expect(host.textContent).toContain(
      'The current Work Definition version could not be loaded, so runnability cannot be determined.',
    );
    const button = host.querySelector<HTMLButtonElement>(
      '.work-run-trigger button',
    );
    expect(button?.textContent).toContain('Can’t start WorkRun');
    expect(button?.disabled).toBe(true);
    expect(host.textContent).not.toContain('Retry availability check');
    expect(fetchMock.mock.calls.map(([path]) => path)).toContain(
      `/api/work-definition-versions/${work.work.definition_version_id}`,
    );
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it('keeps Run tabs and an ordinal breadcrumb separate from the Work tabs', async () => {
  mockProductReads();
  const { host, root } = await renderDetail({
    workId: work.work.id,
    tab: 'chat',
    selectedRunId: selectedRun.id,
  });
  try {
    expect(
      [...host.querySelectorAll('.work-tabs a')].map((a) => a.textContent),
    ).toEqual(['Conversation', 'Output', 'Activity', 'Definition used']);
    expect(host.querySelector('.work-run-header')?.textContent).toContain(
      'WorkRun #1',
    );
    expect(host.querySelector('.work-run-header a')?.getAttribute('href')).toBe(
      `/work/${work.work.id}`,
    );
    // Integration: the Run view now hosts the real Run-scoped chat pane
    // (lane ia-a) in place of lane ia-b's pending placeholder.
    expect(host.querySelector('.work-chat-pane')).not.toBeNull();
    expect(
      getComputedStyle(host.querySelector('.work-shell')!).borderLeftWidth,
    ).not.toBe('0px');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it('lists Runs newest first with ordinal identities and opens their conversation', async () => {
  const older = {
    ...selectedRun,
    id: '00000000-0000-4000-8000-000000000791',
    created_at: '2020-01-01T00:00:00.000Z',
  };
  mockProductReads({
    runList: { work_runs: [older, selectedRun], next_cursor: null },
  });
  const { host, root } = await renderDetail({
    workId: work.work.id,
    tab: 'runs',
    selectedRunId: selectedRun.id,
  });
  try {
    const rows = [...host.querySelectorAll('.work-run-list > li')];
    expect(rows.map((row) => row.querySelector('strong')?.textContent)).toEqual(
      ['WorkRun #2', 'WorkRun #1'],
    );
    expect(rows[0]?.querySelector('a')?.getAttribute('href')).toContain(
      `tab=chat&run=${selectedRun.id}`,
    );
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it('offers Start WorkRun in an empty Runs index', async () => {
  mockProductReads({ runList: { work_runs: [], next_cursor: null } });
  const { host, root } = await renderDetail({
    workId: work.work.id,
    tab: 'runs',
  });
  try {
    expect(
      host.querySelector('.work-detail-header .work-run-trigger button')
        ?.textContent,
    ).toBe('Start WorkRun');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it('places the first Runs content row within 160px of the right pane top', async () => {
  mockProductReads();
  const { host, root } = await renderDetail({
    workId: work.work.id,
    tab: 'runs',
  });
  try {
    const row = host.querySelector('.work-run-list > li')!;
    const offset =
      row.getBoundingClientRect().top - host.getBoundingClientRect().top;
    console.info(
      `Runs first content row y-offset: ${offset}px (Chromium 1440x900)`,
    );
    expect(offset).toBeLessThanOrEqual(160);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it('keeps output in WorkRun Result and sends operational inspection to Observe', async () => {
  mockProductReads();
  const { host, root } = await renderDetail({
    workId: work.work.id,
    tab: 'result',
    selectedRunId: selectedRun.id,
  });
  try {
    expect(
      host.querySelector('.work-tabs a[aria-current="page"]')?.textContent,
    ).toBe('Output');
    expect(host.textContent).toContain(
      'Captured assistant text is unavailable.',
    );
    expect(host.textContent).not.toContain('Key steps');
    expect(host.textContent).not.toContain(
      'Everything captured during this WorkRun',
    );
    expect(
      host.querySelector('a[href^="/observe?"]')?.getAttribute('href'),
    ).toBe(`/observe?work=${work.work.id}&run=${selectedRun.id}`);
    expect(host.querySelector('[data-testid=work-record]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it('can read a Work record even when a child Run projection is unavailable', async () => {
  const fetchMock = mockProductReads({
    runBody: {
      projection_status: 'not_found',
      work: null,
      work_run: null,
      work_items: [],
      actors: [],
      messages: [],
    },
  });
  const { host, root } = await renderDetail();
  try {
    expect(host.querySelector('[data-testid=work-record]')).not.toBeNull();
    expect(
      host.querySelector('.work-run-list .work-state-pill')?.textContent,
    ).toBe('Status unknown');
    expect(fetchMock.mock.calls.map(([path]) => path)).not.toContain(
      `/api/works/${work.work.id}/runs/${selectedRun.id}/trace`,
    );
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it.each(
  (['en', 'zh-CN'] as const).flatMap((locale) =>
    (['work', 'result', 'chat', 'definition'] as const).map((view) => ({
      locale,
      view,
    })),
  ),
)('measures $view navigation at 1440 in $locale', async ({ locale, view }) => {
  const { setLocale } = await import('../../../i18n');
  setLocale(locale);
  await page.viewport(1440, 900);
  mockProductReads({ sessionTranscripts: longTranscript });
  const host = document.createElement('div');
  host.style.height = '900px';
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(
        <MemoryRouter
          key={view}
          initialEntries={[
            `/work/${work.work.id}${view === 'work' ? '' : `?tab=${view}&run=${selectedRun.id}`}`,
          ]}
        >
          <AppProviders commands={shellCommands()}>
            <AppRouter />
          </AppProviders>
        </MemoryRouter>,
      );
      for (let turn = 0; turn < 8; turn += 1)
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const shell = host.querySelector<HTMLElement>(
      '[data-testid="work-detail-shell"]',
    )!;
    const header = shell.querySelector<HTMLElement>('.work-detail-header')!;
    const tabs = shell.querySelector<HTMLElement>('.work-tabs')!;
    expect(window.innerWidth).toBe(1440);
    const measurement = {
      locale,
      view,
      header: header.getBoundingClientRect().height,
      tabs: tabs.getBoundingClientRect().height,
      chrome:
        tabs.getBoundingClientRect().bottom -
        header.getBoundingClientRect().top,
      contentOffset:
        tabs.getBoundingClientRect().bottom - shell.getBoundingClientRect().top,
      shellInset:
        header.getBoundingClientRect().top - shell.getBoundingClientRect().top,
      headerPadding: getComputedStyle(header).paddingBottom,
      headerBorder: getComputedStyle(header).borderBottomWidth,
      tabPadding: getComputedStyle(tabs).paddingTop,
      tabLinkPadding: getComputedStyle(tabs.querySelector('a')!).paddingBottom,
      paneGap:
        tabs.nextElementSibling!.getBoundingClientRect().top -
        tabs.getBoundingClientRect().bottom,
      firstContentOffset:
        shell
          .querySelector(
            view === 'work'
              ? '.work-run-list__identity strong'
              : view === 'result'
                ? '[data-testid=outcome-summary] > .work-shell-kicker'
                : view === 'chat'
                  ? '.work-chat-pane > .work-shell-kicker'
                  : '.work-definition-scope > h2',
          )!
          .getBoundingClientRect().top - shell.getBoundingClientRect().top,
      firstPaneOffset:
        tabs.nextElementSibling!.getBoundingClientRect().top -
        shell.getBoundingClientRect().top,
    };
    console.info(`Work navigation measurement: ${JSON.stringify(measurement)}`);
    expect.soft(measurement.header).toBe(view === 'work' ? 36 : 28);
    expect.soft(measurement.tabs).toBe(26);
    expect.soft(measurement.shellInset).toBe(view === 'work' ? 8 : 9);
    expect.soft(measurement.paneGap).toBe(8);
    expect.soft(measurement.chrome).toBe(view === 'work' ? 62 : 54);
    expect.soft(measurement.firstPaneOffset).toBe(view === 'work' ? 78 : 71);
    expect
      .soft(measurement.firstContentOffset)
      .toBe(view === 'work' ? 99.5 : view === 'result' ? 92 : 71);
    for (const link of tabs.querySelectorAll('a')) {
      expect(link.getBoundingClientRect().height).toBeGreaterThan(0);
      expect(link.getBoundingClientRect().right).toBeLessThanOrEqual(
        tabs.getBoundingClientRect().right + 1,
      );
    }
    const historyLink = header.querySelector('.work-run-history-link');
    if (historyLink)
      expect(historyLink.getBoundingClientRect().right).toBeLessThanOrEqual(
        header.getBoundingClientRect().right + 1,
      );
    expect(tabs.scrollWidth).toBeLessThanOrEqual(tabs.clientWidth);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    setLocale('en');
  }
});

it('shows historical WorkRun state and navigation without borrowing the latest execution state', async () => {
  const older = {
    ...selectedRun,
    id: '00000000-0000-4000-8000-000000000791',
    created_at: '2020-01-01T00:00:00.000Z',
  };
  const fetchMock = mockProductReads({
    runList: { work_runs: [selectedRun, older], next_cursor: null },
    selectedRunId: older.id,
    states: { [selectedRun.id]: 'running', [older.id]: 'problem' },
  });
  const { host, root } = await renderDetail({
    workId: work.work.id,
    tab: 'definition',
    selectedRunId: older.id,
    originConversationId: 'origin-chat',
  });
  try {
    const header = host.querySelector('.work-run-header')!;
    expect(header.querySelector('h1')?.textContent).toBe('WorkRun #1');
    expect(
      header
        .querySelector('.work-state-pill')
        ?.classList.contains('work-state-pill--problem'),
    ).toBe(true);
    expect(
      header.querySelector('.work-run-history-link')?.getAttribute('href'),
    ).toBe(`/work/${work.work.id}?from_conversation=origin-chat`);
    expect(
      host.querySelector('.work-tabs a[aria-current="page"]')?.textContent,
    ).toBe('Definition used');
    expect(host.querySelector('.work-definition-scope > h2')?.textContent).toBe(
      'Definition used by this WorkRun',
    );
    expect(
      host.querySelector('[data-testid="definition-authoring"]'),
    ).toBeNull();
    for (const link of host.querySelectorAll<HTMLAnchorElement>(
      '.work-tabs a',
    )) {
      expect(new URL(link.href).searchParams.get('run')).toBe(older.id);
      expect(new URL(link.href).searchParams.get('from_conversation')).toBe(
        'origin-chat',
      );
    }
    expect(fetchMock.mock.calls.map(([path]) => path)).not.toContain(
      `/api/works/${work.work.id}/runs/${older.id}/trace`,
    );
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it('keeps preparation exclusively in Work scope before the first execution', async () => {
  const fetchMock = mockProductReads({
    runList: { work_runs: [], next_cursor: null },
    preparationMessages: longChatMessages,
  });
  const { host, root } = await renderDetail({
    workId: work.work.id,
    tab: 'chat',
  });
  try {
    expect(host.querySelector('.work-run-header')).toBeNull();
    expect(
      host.querySelector('.work-tabs a[aria-current="page"]')?.textContent,
    ).toBe('Preparation');
    expect(host.textContent).toContain('Final visible Work Chat message');
    expect(fetchMock.mock.calls.map(([path]) => path)).toContain(
      `/api/works/${work.work.id}/chat`,
    );
    for (const link of host.querySelectorAll<HTMLAnchorElement>('.work-tabs a'))
      expect(new URL(link.href).searchParams.has('run')).toBe(false);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it('keeps old Files links honest without advertising an unavailable Artifact browser', async () => {
  mockProductReads();
  const { host, root } = await renderDetail({
    workId: work.work.id,
    tab: 'artifacts',
    selectedRunId: selectedRun.id,
  });
  try {
    expect(host.querySelector('.work-run-header')).toBeNull();
    expect(
      host.querySelector('[data-testid="artifacts-unavailable"]'),
    ).not.toBeNull();
    expect(
      host.querySelector('.work-tabs a[aria-current="page"]')?.textContent,
    ).toBe('Files unavailable');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it('offers the completed WorkRun result file without inferring a file for a running execution', async () => {
  for (const state of ['complete', 'running'] as const) {
    mockProductReads({
      states: { [selectedRun.id]: state },
      sessionTranscripts: longTranscript,
    });
    const { host, root } = await renderDetail({
      workId: work.work.id,
      tab: 'result',
      selectedRunId: selectedRun.id,
    });
    try {
      expect(
        host.querySelector('[data-testid=outcome-summary] h2')?.textContent,
      ).toBe('Latest captured assistant message');
      expect(host.textContent).toContain('it may be a worker progress update');
      expect(host.textContent).not.toContain('Captured WorkRun output');
      const file = host.querySelector<HTMLAnchorElement>('a[href^="/files?"]');
      if (state === 'complete') {
        expect(file?.textContent).toBe('Open result file');
        expect(new URL(file!.href).searchParams.get('run')).toBe(
          selectedRun.id,
        );
        expect(new URL(file!.href).searchParams.get('path')).toBe(
          `runs/${selectedRun.id}/result.md`,
        );
      } else {
        expect(file).toBeNull();
        expect(host.textContent).not.toContain('What this Run completed');
      }
      expect(
        host.querySelector('[data-testid="attention-basis"]')?.textContent,
      ).toContain('This WorkRun');
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    }
  }
});

it('keeps Output neutral while captured text is hydrating', async () => {
  let resolveTranscripts!: (value: ProductSessionTranscriptsResponse) => void;
  const transcripts = new Promise<ProductSessionTranscriptsResponse>(
    (resolve) => {
      resolveTranscripts = resolve;
    },
  );
  mockProductReads({ sessionTranscripts: transcripts });
  const { host, root } = await renderDetail({
    workId: work.work.id,
    tab: 'result',
    selectedRunId: selectedRun.id,
  });
  try {
    expect(
      host.querySelector('[data-testid=outcome-summary] h2')?.textContent,
    ).toBe('Loading captured output…');
    expect(host.textContent).not.toContain(
      'Captured assistant text is unavailable.',
    );

    await act(async () => {
      resolveTranscripts(longTranscript);
      await transcripts;
      await Promise.resolve();
    });
    expect(
      host.querySelector('[data-testid=outcome-summary] h2')?.textContent,
    ).toBe('Latest captured assistant message');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it('labels the current Work Definition and keeps its editor outside historical execution scope', async () => {
  mockProductReads();
  const { host, root } = await renderDetail({
    workId: work.work.id,
    tab: 'definition',
  });
  try {
    expect(host.querySelector('.work-run-header')).toBeNull();
    expect(host.querySelector('.work-definition-scope > h2')?.textContent).toBe(
      'Current Work Definition',
    );
    expect(
      host.querySelector('.work-tabs a[aria-current="page"]')?.textContent,
    ).toBe('Current Definition');
    expect(
      host.querySelector('[data-testid="definition-authoring"]'),
    ).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it('moves started preparation into a selected WorkRun shell and preserves conversation origin', async () => {
  const fetchMock = mockProductReads({
    preparation: {
      id: work.work.id,
      work_id: work.work.id,
      revision: 1,
      status: 'started',
      definition_version_id: work.work.definition_version_id,
      schema_fingerprint: 'test',
      candidate_input: {},
      confirmed_fingerprint: 'test',
      start_intent: 'test',
      work_run_id: selectedRun.id,
      missing: [],
      ambiguities: [],
      created_at: work.work.created_at,
      updated_at: work.work.updated_at,
    },
  });
  const read = fetchMock.getMockImplementation()!;
  let runListReads = 0;
  fetchMock.mockImplementation(async (path: string) => {
    if (path === `/api/works/${work.work.id}/runs` && runListReads++ === 0)
      return jsonResponse({ ...runs, work_runs: [] });
    return read(path);
  });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(
        <MemoryRouter
          initialEntries={[
            `/work/${work.work.id}?tab=chat&from_conversation=origin-chat`,
          ]}
        >
          <AppProviders commands={shellCommands()}>
            <AppRouter />
          </AppProviders>
        </MemoryRouter>,
      );
      for (let turn = 0; turn < 16; turn += 1)
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await expect
      .poll(() => host.querySelector('.work-run-header h1')?.textContent)
      .toBe('WorkRun #1');
    expect(
      host.querySelector('.work-tabs a[aria-current=page]')?.textContent,
    ).toBe('Conversation');
    for (const link of host.querySelectorAll<HTMLAnchorElement>(
      '.work-tabs a',
    )) {
      expect(new URL(link.href).searchParams.get('run')).toBe(selectedRun.id);
      expect(new URL(link.href).searchParams.get('from_conversation')).toBe(
        'origin-chat',
      );
    }
    expect(fetchMock.mock.calls.map(([path]) => path)).toContain(
      `/api/works/${work.work.id}/chat`,
    );
    expect(fetchMock.mock.calls.map(([path]) => path)).toContain(
      `/api/works/${work.work.id}/runs/${selectedRun.id}/chat`,
    );
    expect(
      host.querySelector('.work-chat-pane')?.getAttribute('aria-label'),
    ).toBe('Conversation');
    expect(host.textContent).toContain(
      'cannot access execution history or change execution',
    );
    expect(host.textContent).not.toContain('Run’s Lead');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
