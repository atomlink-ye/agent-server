import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';

import {
  GetWorkResponseSchema,
  ProductRunTraceSuccessSchema,
  ProductWorkRunSuccessSchema,
} from '@atomlink-ye/agent-server/product-contract';
import { AppShell } from '@/app/shell/AppShell';
import reworkRecording from '@/test-support/fixtures/product-recordings/rework-once.json';
import {
  projectWorkList,
  projectWorkRunList,
} from '@/test-support/product-recording-test-helpers';
import '../../index.css';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const recordedTrace = ProductRunTraceSuccessSchema.parse(
  reworkRecording.recording_documents[0],
);
const recordedWork = projectWorkList(reworkRecording).works[0]!;
const recordedRunList = projectWorkRunList(reworkRecording, recordedWork.id);
const recordedRun = ProductWorkRunSuccessSchema.parse({
  work: recordedTrace.work,
  work_run: recordedTrace.work_run,
  work_items: recordedTrace.work_items,
  actors: recordedTrace.actors,
  messages: recordedTrace.messages,
  projection_status: recordedTrace.projection_status,
});

const workId = uuid(47);
const runId = uuid(147);
const longResult = Array.from({ length: 48 }, (_, index) =>
  index === 47
    ? '### Final real Observe Trace result'
    : `Recorded Trace checkpoint ${index + 1}`,
).join('\n\n');
const trace = ProductRunTraceSuccessSchema.parse({
  ...recordedTrace,
  work: {
    ...recordedTrace.work,
    id: workId,
    title: 'Final real Observe Trace',
  },
  work_run: {
    ...recordedTrace.work_run,
    id: runId,
    work_id: workId,
    result_summary: longResult,
  },
});
const work = GetWorkResponseSchema.parse({ work: trace.work });
const run = ProductWorkRunSuccessSchema.parse({
  ...recordedRun,
  work: trace.work,
  work_run: trace.work_run,
});
const works = Array.from({ length: 48 }, (_, index) => ({
  ...recordedWork,
  id: uuid(index + 1000),
  title:
    index === 47
      ? 'Final real Observe Trace'
      : `Recorded Observe Trace ${index + 1}`,
  latest_run_summary: {
    ...recordedWork.latest_run_summary!,
    id: uuid(index + 2000),
  },
}));
works[47] = {
  ...works[47]!,
  id: workId,
  latest_run_summary: {
    ...works[47]!.latest_run_summary,
    id: runId,
    result_summary: longResult,
  },
};
const runList = {
  ...recordedRunList,
  work_runs: [
    {
      ...recordedRunList.work_runs[0]!,
      id: runId,
      work_id: workId,
    },
  ],
};

function uuid(value: number): string {
  return `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}

function notFoundResponse(): Response {
  return {
    ok: false,
    status: 404,
    json: async () => ({ error: { code: 'not_found' } }),
  } as Response;
}

function sessionTranscripts(inputWorkId: string, inputRunId: string) {
  return {
    work_id: inputWorkId,
    work_run_id: inputRunId,
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
          entry_count: 2,
          last_timestamp: '2026-08-13T01:20:00.000Z',
          last_meaningful: null,
          work_refs: [],
          truncated: false,
        },
        entries: [
          {
            ordinal: 0,
            kind: 'lifecycle',
            sequence: 1,
            created_at: '2026-08-13T01:18:00.000Z',
            status: 'started',
          },
          {
            ordinal: 1,
            kind: 'usage',
            sequence: 2,
            created_at: '2026-08-13T01:20:00.000Z',
            input_tokens: 1500,
            cached_input_tokens: null,
            output_tokens: 200,
            total_cost_usd: 0.0045,
            context_window_max_tokens: null,
            context_window_used_tokens: null,
          },
        ],
      },
    ],
  };
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

it('scrolls the real Observe page list and Trace detail on desktop', async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const request =
      typeof input === 'object' && input !== null && 'url' in input
        ? (input as Request)
        : null;
    const url = new URL(request?.url ?? String(input), window.location.href);
    const method = request?.method ?? 'GET';
    if (method !== 'GET')
      throw new Error(`unexpected Observe method: ${method}`);

    if (url.pathname === '/api/works')
      return jsonResponse({ works, next_cursor: null });
    if (url.pathname === '/api/agents') return jsonResponse({ items: [] });
    if (url.pathname === `/api/works/${workId}`) return jsonResponse(work);
    if (url.pathname === `/api/works/${workId}/runs`)
      return jsonResponse(runList);
    if (url.pathname === `/api/works/${workId}/runs/${runId}`)
      return jsonResponse(run);
    if (url.pathname === `/api/works/${workId}/runs/${runId}/trace`)
      return jsonResponse(trace);
    if (
      url.pathname === `/api/works/${workId}/runs/${runId}/session-transcripts`
    )
      return jsonResponse(sessionTranscripts(workId, runId));
    if (url.pathname.startsWith('/api/work-definition-versions/'))
      return notFoundResponse();
    throw new Error(`unexpected Observe request URL: ${url.pathname}`);
  });
  vi.stubGlobal('fetch', fetchMock);

  const host = document.createElement('div');
  host.style.height = '900px';
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[`/observe?work=${workId}&run=${runId}`]}>
          <AppShell commands={shellCommands()} />
        </MemoryRouter>,
      );
      for (let turn = 0; turn < 8; turn += 1)
        await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const list = host.querySelector<HTMLElement>(
      '[data-testid="observe-list"]',
    );
    expect(list).not.toBeNull();
    expect(list!.textContent).toContain('Final real Observe Trace');
    expect(list!.scrollHeight).toBeGreaterThan(list!.clientHeight);
    list!.scrollTop = list!.scrollHeight;
    expect(list!.scrollTop).toBeGreaterThan(0);
    const finalTrace = [...list!.querySelectorAll('a')].at(-1)!;
    expect(finalTrace.textContent).toContain('Final real Observe Trace');
    expect(finalTrace.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      list!.getBoundingClientRect().bottom + 1,
    );

    const detail = host.querySelector<HTMLElement>(
      'main > section[aria-label]',
    );
    expect(detail).not.toBeNull();
    expect(detail!.classList.contains('work-main-content')).toBe(true);
    expect(detail!.textContent).toContain('Final real Observe Trace result');
    expect(detail!.scrollHeight).toBeGreaterThan(detail!.clientHeight);
    detail!.scrollTop = detail!.scrollHeight;
    expect(detail!.scrollTop).toBeGreaterThan(0);
    const finalResult = [...detail!.querySelectorAll('h3')].find((heading) =>
      heading.textContent?.includes('Final real Observe Trace result'),
    )!;
    expect(finalResult.textContent).toContain(
      'Final real Observe Trace result',
    );
    expect(finalResult.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      detail!.getBoundingClientRect().bottom + 1,
    );
    await page.screenshot({
      path: '../../../../../.local/observe-scroll-desktop.png',
    });
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
