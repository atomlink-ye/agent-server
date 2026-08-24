import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

import reworkRecording from '@/test-support/fixtures/product-recordings/rework-once.json';
import { ExecutionTranscript } from './execution-transcript';
import { parseRecordedTrace } from '@/test-support/run-trace-recording-test-helpers';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

it('renders actual safe provider output through the Product-scoped Attempt detail endpoint', async () => {
  const trace = parseRecordedTrace(reworkRecording);
  const selected = [...trace.workItems.values()].find(
    (item) => item.attempts.length > 0,
  )!;
  const attempt = selected.attempts[0]!;
  const actor = selected.actorId
    ? trace.actors.get(selected.actorId)
    : undefined;
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      work_id: trace.work.id,
      work_run_id: trace.workRun.id,
      work_item_id: selected.id,
      attempt_id: attempt.id,
      actor_id: selected.actorId,
      capture_scope: 'safe_run_events',
      truncated: false,
      events: [
        {
          kind: 'lifecycle',
          status: 'started',
          sequence: 1,
          created_at: '2026-08-18T01:00:00.000Z',
        },
        {
          kind: 'assistant_text',
          text: 'Actual provider answer visible in Product execution detail.',
          sequence: 2,
          created_at: '2026-08-18T01:00:01.000Z',
        },
        {
          kind: 'tool_status',
          activity_id: 'activity-1',
          category: 'read',
          status: 'completed',
          label: 'read_source',
          summary: 'Read finished',
          provider: 'opencode',
          tool_name: null,
          detail_kind: 'read',
          detail_text: 'bounded detail',
          exit_code: null,
          parent_activity_id: null,
          sequence: 3,
          created_at: '2026-08-18T01:00:02.000Z',
        },
      ],
    }),
  });
  vi.stubGlobal('fetch', fetchMock);

  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(<ExecutionTranscript trace={trace} />);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(
      host.querySelector('[data-testid="execution-transcript"]'),
    ).not.toBeNull();
    expect(host.textContent).toContain(actor?.name ?? 'Name not captured');
    expect(host.textContent).toContain(
      'Actual provider answer visible in Product execution detail.',
    );
    expect(host.textContent).toContain('read_source');
    expect(host.textContent).toContain('bounded detail');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        `/api/works/${trace.work.id}/runs/${trace.workRun.id}/execution-detail?attempt_id=${attempt.id}`,
      ),
      expect.objectContaining({ method: 'GET', cache: 'no-store' }),
    );
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
