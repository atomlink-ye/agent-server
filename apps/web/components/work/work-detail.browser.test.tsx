import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

import {
  GetWorkResponseSchema,
  ProductRunTraceSuccessSchema,
  ProductWorkRunSuccessSchema,
  WorkDefinitionResponseSchema,
  WorkResponseSchema,
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
const work = GetWorkResponseSchema.parse({
  work: trace.work,
});
const runs = projectWorkRunList(reworkRecording, work.work.id);
const selectedRun = runs.work_runs[0]!;
const run = ProductWorkRunSuccessSchema.parse({
  work: trace.work,
  work_run: trace.work_run,
  projection_status: trace.projection_status,
  work_items: trace.work_items,
  actors: trace.actors,
  messages: trace.messages,
});
const environmentVersionId = '00000000-0000-4000-8000-000000000701';
const definition = WorkDefinitionResponseSchema.parse({
  definition: {
    id: work.work.definition_id,
    name: 'Supplier risk review',
    description: 'Review supplier risk using the current Work Definition.',
    created_at: work.work.created_at,
    updated_at: work.work.updated_at,
  },
  version: {
    id: selectedRun.definition_version_id,
    definition_id: work.work.definition_id,
    status: 'published',
    name: 'Definition v7',
    description: 'Read-only selected Definition.',
    environment_version_id: environmentVersionId,
    spec: {
      lead: {
        name: 'Lead',
        agentVersionId: '00000000-0000-4000-8000-000000000702',
      },
      roster: [
        {
          name: 'Researcher',
          agentVersionId: '00000000-0000-4000-8000-000000000703',
        },
      ],
      environmentVersionId,
    },
    created_at: work.work.created_at,
    updated_at: work.work.updated_at,
    published_at: work.work.updated_at,
  },
});

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}

function mockProductReads(definitionBody: unknown = definition) {
  const responses = new Map<string, unknown>([
    [`/api/works/${work.work.id}`, work],
    [`/api/works/${work.work.id}/runs`, runs],
    [`/api/works/${work.work.id}/definition`, definitionBody],
    [`/api/works/${work.work.id}/runs/${selectedRun.id}`, run],
    [`/api/works/${work.work.id}/runs/${selectedRun.id}/trace`, trace],
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
  props: React.ComponentProps<typeof WorkDetailShell> = { workId: work.work.id },
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
      [...host.querySelectorAll<HTMLAnchorElement>('.work-tabs a')].map((item) =>
        item.textContent?.trim(),
      ),
    ).toEqual(['Overview', 'Runs', 'Artifacts', 'Definition']);
    expect(host.textContent).toContain('Historical Run Trace');
    expect(host.textContent).toContain('MCP-only');
    for (const excluded of trace.timeline_coverage.excluded_execution)
      expect(host.textContent?.toLowerCase()).toContain(
        excluded.replaceAll('_', ' '),
      );

    const firstItem = trace.work_items.find((item) => item.attempts.length > 0)!;
    const firstAttempt = firstItem.attempts[0]!;
    expect(host.textContent).toContain(
      `${firstAttempt.attempt_no} / ${firstItem.attempts.length}`,
    );
    expect(host.querySelector('[data-testid="chat-detail-link"]')).toBeNull();
    expect(
      host.querySelector('[data-testid="trace-coverage-disclosure"]'),
    ).not.toBeNull();

    const paths = fetchMock.mock.calls.map(([path]) => path as string);
    expect(paths).toContain(`/api/works/${work.work.id}`);
    expect(paths).toContain(`/api/works/${work.work.id}/runs`);
    expect(paths).toContain(`/api/works/${work.work.id}/definition`);
    expect(paths).toContain(`/api/works/${work.work.id}/runs/${selectedRun.id}`);
    expect(paths).toContain(
      `/api/works/${work.work.id}/runs/${selectedRun.id}/trace`,
    );
    expect(paths.some((path) => path.includes('/tasks'))).toBe(false);
    expect(paths.some((path) => path.includes('/team-runs'))).toBe(false);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it('preserves the selected Product WorkRun in Work tab URLs and renders exact Definition data', async () => {
  mockProductReads();
  const { host, root } = await renderDetail({
    workId: work.work.id,
    tab: 'definition',
    selectedRunId: selectedRun.id,
  });
  try {
    expect(host.querySelector('[data-testid="definition-viewer"]')).not.toBeNull();
    expect(host.textContent).toContain('Definition v7');
    expect(host.textContent).toContain('Lead Agent');
    expect(host.textContent).toContain('Researcher');
    expect(host.textContent).toContain(selectedRun.definition_version_id);
    for (const link of host.querySelectorAll<HTMLAnchorElement>('.work-tabs a'))
      expect(link.getAttribute('href')).toContain(`run=${selectedRun.id}`);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it('does not fabricate a historical Definition body when only the current version is available', async () => {
  const currentDefinition = {
    ...definition,
    version: {
      ...definition.version,
      id: '00000000-0000-4000-8000-000000000799',
      name: 'Definition v8',
    },
  };
  mockProductReads(currentDefinition);
  const { host, root } = await renderDetail({
    workId: work.work.id,
    tab: 'definition',
    selectedRunId: selectedRun.id,
  });
  try {
    expect(
      host.querySelector('[data-testid="definition-historical-unavailable"]'),
    ).not.toBeNull();
    expect(host.textContent).toContain('Historical Definition body unavailable');
    expect(host.textContent).toContain(selectedRun.definition_version_id);
    expect(host.textContent).toContain('does not fall back to internal collaboration APIs');
    expect(host.textContent).not.toContain('Researcher');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
