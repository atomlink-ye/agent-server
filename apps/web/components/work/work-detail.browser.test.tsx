import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

import { WorkDetailShell } from '@/components/work/work-shell';

const workId = '00000000-0000-4000-8000-000000000001';
const firstRunId = '00000000-0000-4000-8000-000000000002';
const finalRunId = '00000000-0000-4000-8000-000000000003';
const firstAttemptId = '00000000-0000-4000-8000-000000000004';
const secondAttemptId = '00000000-0000-4000-8000-000000000005';
const taskId = '00000000-0000-4000-8000-000000000006';
const rootTaskId = '00000000-0000-4000-8000-000000000007';
const actorId = '00000000-0000-4000-8000-000000000008';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

it('renders decoded Work outcome, rework attempts, timing, and MCP coverage', async () => {
  const responses = new Map<string, unknown>([
    [`/api/works/${workId}`, { work: { ...work, title: 'Research Work' } }],
    [
      `/api/works/${workId}/runs`,
      {
        work_runs: [
          workRun(firstRunId, '2026-08-12T10:00:00.000Z'),
          workRun(finalRunId, '2026-08-12T11:00:00.000Z'),
        ],
        next_cursor: null,
      },
    ],
    [`/api/works/${workId}/runs/${finalRunId}`, workRunDetail],
    [`/api/works/${workId}/runs/${finalRunId}/trace`, trace],
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
      root.render(<WorkDetailShell workId={workId} />);
      await new Promise((resolve) => setTimeout(resolve, 25));
    });

    for (const response of fetchMock.mock.results) {
      expect((await response.value).status, 'not_implemented').not.toBe(501);
    }
    expect(host.textContent).toContain('complete');
    expect(host.textContent).toContain('Attention basis: not specified');
    expect(host.textContent).toContain('Final answer');
    expect(host.textContent).toContain(`Attempt ID: ${firstAttemptId}`);
    expect(host.textContent).toContain(`Attempt ID: ${secondAttemptId}`);
    expect(host.querySelectorAll('[data-testid="attempt-id"]').length).toBe(2);
    expect(host.textContent).toContain('Longest captured attempt:');
    expect(host.textContent).toContain('9000 ms');
    expect(host.textContent).toContain('not_captured');
    expect(host.textContent).toContain('MCP-only');
    expect(
      host
        .querySelector('a[data-testid="chat-detail-link"]')
        ?.getAttribute('href'),
    ).toBe('/api/runs/detail-1');

    expect(
      host.querySelector('[data-testid="outcome-product-state"]'),
      'display_bug',
    ).not.toBeNull();
    expect(
      host.querySelector('[data-testid="attention-basis"]'),
      'display_bug',
    ).not.toBeNull();
    expect(
      host.querySelector('[data-testid="longest-attempt"]'),
      'display_bug',
    ).not.toBeNull();
    expect(
      host.querySelector('[data-testid="mcp-only-warning"]'),
      'display_bug',
    ).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

const work = {
  id: workId,
  tenant_id: 'tenant-1',
  workspace_id: '00000000-0000-4000-8000-000000000009',
  definition_id: '00000000-0000-4000-8000-000000000010',
  definition_version_id: '00000000-0000-4000-8000-000000000011',
  title: 'Work',
  origin: 'created' as const,
  archived_at: null,
  created_at: '2026-08-12T09:00:00.000Z',
  updated_at: '2026-08-12T11:00:00.000Z',
};

function workRun(id: string, created_at: string) {
  return {
    id,
    work_id: workId,
    definition_version_id: work.definition_version_id,
    trigger_kind: 'manual' as const,
    trigger_ref: 'browser-test',
    expires_at: '2026-08-13T11:00:00.000Z',
    bound_at: created_at,
    created_at,
    updated_at: created_at,
  };
}

const attempts = [
  {
    id: firstAttemptId,
    attempt_no: 1,
    status: 'failed' as const,
    started_at: '2026-08-12T11:00:00.000Z',
    ended_at: '2026-08-12T11:00:05.000Z',
    duration_ms: null,
    timing_capture_status: 'not_captured' as const,
    feedback_summary: 'Needs another pass.',
    feedback_capture_status: 'not_present' as const,
    result_summary: 'First pass.',
    result_capture_status: 'not_present' as const,
    source_refs: {},
  },
  {
    id: secondAttemptId,
    attempt_no: 2,
    status: 'completed' as const,
    started_at: '2026-08-12T11:01:00.000Z',
    ended_at: '2026-08-12T11:01:09.000Z',
    duration_ms: 9000,
    timing_capture_status: 'captured' as const,
    feedback_summary: null,
    feedback_capture_status: 'not_present' as const,
    result_summary: 'Final answer.',
    result_capture_status: 'not_present' as const,
    source_refs: {},
  },
];

const workItem = {
  id: '00000000-0000-4000-8000-000000000012',
  subject: 'Research item',
  description: null,
  status: 'completed' as const,
  actor_id: actorId,
  dependency_ids: [],
  attempts,
  source_refs: {},
};

const workRunDetail = {
  work,
  work_run: {
    ...workRun(finalRunId, '2026-08-12T11:00:00.000Z'),
    product_state: 'complete' as const,
    problem_kind: null,
    attention_reason: null,
    result_summary: 'Final answer.',
    result_capture_status: 'present' as const,
    control_revision: 1,
    cancel_availability: 'not_available' as const,
    completion_decision_availability: 'available' as const,
  },
  projection_status: 'internally_anchored' as const,
  work_items: [workItem],
  actors: [],
  messages: [],
};

const trace = {
  ...workRunDetail,
  runs: [],
  events: [],
  edges: [],
  mcp_activities: [
    {
      activity_id: 'activity-1',
      sequence: 1,
      provenance: 'server_authorized_team_mcp_catalog' as const,
      tool_identity_capture_status: 'present' as const,
      operation_capture_status: 'present' as const,
      result_capture_status: 'not_present' as const,
      source_refs: {
        root_task_id: rootTaskId,
        task_id: taskId,
        run_id: finalRunId,
        actor_id: actorId,
      },
      chat_detail: {
        method: 'GET' as const,
        path: '/api/runs/detail-1',
        target: {
          source_refs: { run_id: finalRunId },
          sequence: 1,
          activity_id: 'activity-1',
        },
      },
      kind: 'tool_status' as const,
      status: 'completed' as const,
      category: 'read' as const,
      tool_name: 'read',
    },
  ],
  timeline_coverage: {
    scope: 'mcp_dispatch_and_confirmation' as const,
    completeness: 'mcp_only' as const,
    excluded_execution: [
      'direct_shell',
      'direct_file_edit',
      'other_non_mcp_execution',
    ] as const,
  },
};
