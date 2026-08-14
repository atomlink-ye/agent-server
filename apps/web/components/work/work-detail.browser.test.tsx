import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

import {
  GetWorkResponseSchema,
  ProductRunTraceSuccessSchema,
  ProductWorkRunSuccessSchema,
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

it('renders a fixture-backed Work detail through the accepted read seams', async () => {
  const trace = ProductRunTraceSuccessSchema.parse(
    reworkRecording.recording_documents[0],
  );

  const projectedWorks = projectWorkList(reworkRecording);
  const work = GetWorkResponseSchema.parse({
    work: WorkResponseSchema.parse(projectedWorks.works[0]),
  });
  const runs = projectWorkRunList(reworkRecording, work.work.id);
  const finalRun = runs.work_runs[0];
  expect(finalRun).toBeDefined();
  if (!finalRun) return;
  const run = ProductWorkRunSuccessSchema.parse({
    work: trace.work,
    work_run: trace.work_run,
    projection_status: trace.projection_status,
  });

  const responses = new Map<string, unknown>([
    [`/api/works/${work.work.id}`, work],
    [`/api/works/${work.work.id}/runs`, runs],
    [`/api/works/${work.work.id}/runs/${finalRun.id}`, run],
    [`/api/works/${work.work.id}/runs/${finalRun.id}/trace`, trace],
  ]);
  const fetchMock = vi.fn().mockImplementation(async (path: string) => {
    const body = responses.get(path);
    if (!body) throw new Error(`unexpected request: ${path}`);
    return {
      ok: true,
      status: 200,
      json: async () => body,
    } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);

  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(<WorkDetailShell workId={work.work.id} />);
      await new Promise((resolve) => setTimeout(resolve, 25));
    });

    expect(host.textContent).toContain(work.work.title);
    expect(host.textContent).toContain('Historical Run Trace');
    expect(host.textContent).toContain('Attempt 1');
    expect(host.textContent).toContain('Attempt 2');
    expect(host.textContent).toContain('MCP-only');
    expect(host.textContent).toContain('direct shell');
    expect(host.querySelectorAll('[data-testid="trace-attempt"]')).toHaveLength(
      trace.work_items.reduce(
        (count, workItem) => count + workItem.attempts.length,
        0,
      ),
    );
    expect(host.querySelector('[data-testid="chat-detail-link"]')).toBeNull();
    expect(
      host.querySelector('[data-testid="trace-coverage-disclosure"]'),
    ).not.toBeNull();
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      `/api/works/${work.work.id}`,
      `/api/works/${work.work.id}/runs`,
      `/api/works/${work.work.id}/runs/${finalRun.id}`,
      `/api/works/${work.work.id}/runs/${finalRun.id}/trace`,
    ]);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
