import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

import {
  GetWorkResponseSchema,
  ProductRunTraceSuccessSchema,
  ProductWorkDefinitionVersionSchema,
  ProductWorkRunSuccessSchema,
} from '@atomlink-ye/agent-server/product-contract';
import { WorkDetailShell } from '@/components/work/work-shell';
import reworkRecording from '@/lib/__fixtures__/product-recordings/rework-once.json';
import {
  projectWorkList,
  projectWorkRunList,
} from '@/lib/product-recording-projections';

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

function mockProductReads(
  input: {
    readonly runList?: typeof runs;
    readonly selectedRunId?: string;
    readonly runBody?: unknown;
    readonly definition?: ReturnType<typeof productDefinitionVersion>;
  } = {},
) {
  const runList = input.runList ?? runs;
  const runId = input.selectedRunId ?? selectedRun.id;
  const definition = input.definition ?? definitionVersion;
  const responses = new Map<string, unknown>([
    [`/api/works/${work.work.id}`, work],
    [`/api/works/${work.work.id}/runs`, runList],
    [`/api/work-definition-versions/${definition.id}`, { version: definition }],
    [`/api/works/${work.work.id}/runs/${runId}`, input.runBody ?? run],
    [`/api/works/${work.work.id}/runs/${runId}/trace`, trace],
  ]);
  const fetchMock = vi.fn().mockImplementation(async (path: string) => {
    const body = responses.get(path);
    if (!body) throw new Error(`unexpected request: ${path}`);
    return jsonResponse(body);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function renderDetail(
  props: React.ComponentProps<typeof WorkDetailShell> = {
    workId: work.work.id,
  },
) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<WorkDetailShell {...props} />);
    await new Promise((resolve) => setTimeout(resolve, 25));
  });
  return { host, root };
}

it('renders the four-tab Work shell and fixture-backed Overview through Product reads only', async () => {
  const fetchMock = mockProductReads();
  const { host, root } = await renderDetail();
  try {
    expect(host.textContent).toContain(work.work.title);
    expect(
      [...host.querySelectorAll<HTMLAnchorElement>('.work-tabs a')].map(
        (item) => item.textContent?.trim(),
      ),
    ).toEqual(['Overview', 'Runs', 'Transcript', 'Artifacts', 'Definition']);
    expect(host.textContent).toContain('Historical Run Trace');
    expect(host.textContent).toContain('MCP-only');
    for (const excluded of trace.timeline_coverage.excluded_execution)
      expect(host.textContent?.toLowerCase()).toContain(
        excluded.replaceAll('_', ' '),
      );

    const paths = fetchMock.mock.calls.map(([path]) => path as string);
    expect(paths).toContain(`/api/works/${work.work.id}`);
    expect(paths).toContain(`/api/works/${work.work.id}/runs`);
    expect(paths).toContain(
      `/api/work-definition-versions/${selectedRun.definition_version_id}`,
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
    // Definition tab link should not contain run= parameter (goes to current editable version)
    const definitionLink = host.querySelector<HTMLAnchorElement>(
      '.work-tabs a[href*="tab=definition"]',
    );
    expect(definitionLink?.getAttribute('href')).not.toContain(`run=`);
    // Other tabs should contain run= parameter (stay on the selected Run)
    const overviewLink = host.querySelector<HTMLAnchorElement>(
      '.work-tabs a:not([href*="tab="])',
    );
    expect(overviewLink?.getAttribute('href')).toContain(
      `run=${selectedRun.id}`,
    );
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
