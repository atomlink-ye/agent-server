import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

import type { WorkDetailQuery } from '../work/queries/use-work-detail';
import type { NormalizedTrace } from '../run-trace/normalized';
import { ObserveDetail } from './ObserveDetail';

const useWorkDetail = vi.fn();
const loadSessionTranscripts = vi.fn();

vi.mock('../work/queries/use-work-detail', () => ({
  useWorkDetail: (...args: unknown[]) => useWorkDetail(...args),
}));
vi.mock('@/features/run-trace/run-trace-gateway', () => ({
  loadSessionTranscripts: (...args: unknown[]) =>
    loadSessionTranscripts(...args),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const TRACE = {
  runId: 'run-1',
  work: { id: 'work-1', title: 'Draft the quarterly report' },
  workRun: { id: 'run-1', productState: 'complete' },
  actors: new Map(),
  workItems: new Map(),
  attempts: new Map(),
  messages: new Map([
    [
      'msg-1',
      { id: 'msg-1', senderName: null, recipientName: null, summary: null },
    ],
    [
      'msg-2',
      { id: 'msg-2', senderName: null, recipientName: null, summary: null },
    ],
  ]),
  activities: [
    {
      activityId: 'activity-1',
      runId: 'run-1',
      sequence: 1,
      status: 'succeeded',
      category: 'mcp_dispatch',
      toolName: 'search',
      resultCaptureStatus: 'present',
      actorId: null,
      workItemId: null,
    },
  ],
  edges: [],
  runs: [
    {
      id: 'run-1',
      status: 'succeeded',
      actorId: null,
      workItemId: null,
      taskId: null,
      rootTaskId: null,
      startedAt: '2026-01-01T00:00:00.000Z',
      endedAt: '2026-01-01T00:02:30.000Z',
    },
  ],
  events: [],
  timeline: {
    startedAt: Date.parse('2026-01-01T00:00:00.000Z'),
    endedAt: Date.parse('2026-01-01T00:02:30.000Z'),
  },
  coverage: {
    scope: 'mcp_dispatch_and_confirmation',
    completeness: 'mcp_only',
    excludedExecution: [],
  },
} satisfies NormalizedTrace;

const DETAIL = {
  work: { id: 'work-1', title: 'Draft the quarterly report' },
  runs: [],
  run: {
    projection_status: 'internally_anchored',
    work_run: {
      id: 'run-1',
      product_state: 'complete',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:02:30.000Z',
      result_summary: 'Report drafted.',
      result_capture_status: 'present',
    },
  },
  trace: TRACE,
  selectedDefinitionVersionId: 'definition-version-1',
  definitionVersion: null,
  currentDefinitionVersion: null,
};

function renderDetail() {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  return { host, root };
}

it('renders Duration/Inbox/Tools/Tokens metric cards from the loaded Trace', async () => {
  useWorkDetail.mockReturnValue({
    status: 'available',
    detail: DETAIL,
  } as unknown as WorkDetailQuery);
  loadSessionTranscripts.mockResolvedValue({
    work_id: 'work-1',
    work_run_id: 'run-1',
    capture_scope: 'safe_run_events',
    sessions: [
      {
        label: {
          name: 'Report Writer',
          role: null,
          status: 'idle',
          status_basis: 'agent_runs',
          source_refs: {},
        },
        summary: {
          status: 'idle',
          entry_count: 1,
          last_timestamp: null,
          last_meaningful: null,
          work_refs: [],
          truncated: false,
        },
        entries: [
          {
            kind: 'usage',
            timestamp: '2026-01-01T00:02:00.000Z',
            input_tokens: 1500,
            cached_input_tokens: null,
            output_tokens: 200,
            total_cost_usd: null,
            context_window_max_tokens: null,
            context_window_used_tokens: null,
            ordinal: 0,
          },
        ],
      },
    ],
  });

  const { host, root } = renderDetail();
  await act(async () => {
    root.render(<ObserveDetail workId="work-1" runId="run-1" />);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  try {
    expect(
      host.querySelector('[data-testid="observe-metric-duration"]')
        ?.textContent,
    ).toContain('2m 30s');
    expect(
      host.querySelector('[data-testid="observe-metric-inbox"]')?.textContent,
    ).toContain('2');
    expect(
      host.querySelector('[data-testid="observe-metric-tools"]')?.textContent,
    ).toContain('1');
    expect(
      host.querySelector('[data-testid="observe-metric-tokens"]')?.textContent,
    ).toContain('1,700');
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it('shows a not-captured placeholder for Tokens when no usage was recorded', async () => {
  useWorkDetail.mockReturnValue({
    status: 'available',
    detail: DETAIL,
  } as unknown as WorkDetailQuery);
  loadSessionTranscripts.mockResolvedValue({
    work_id: 'work-1',
    work_run_id: 'run-1',
    capture_scope: 'safe_run_events',
    sessions: [],
  });

  const { host, root } = renderDetail();
  await act(async () => {
    root.render(<ObserveDetail workId="work-1" runId="run-1" />);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  try {
    const tokensCard = host.querySelector(
      '[data-testid="observe-metric-tokens"]',
    );
    expect(tokensCard?.textContent).toContain('not captured');
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
