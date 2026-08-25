import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { ProductSessionTranscriptsResponse } from '@atomlink-ye/agent-server/product-contract';
import { expect, it, vi } from 'vitest';

import reworkRecording from '@/test-support/fixtures/product-recordings/rework-once.json';
import { SessionTranscripts } from './session-transcripts';
import { parseRecordedTrace } from '@/test-support/run-trace-recording-test-helpers';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const MOCK_RESPONSE: ProductSessionTranscriptsResponse = {
  work_id: '00000000-0000-0000-0000-000000000001',
  work_run_id: '00000000-0000-0000-0000-000000000002',
  capture_scope: 'safe_run_events',
  sessions: [
    {
      label: {
        name: 'Lead Agent',
        role: 'lead',
        status: 'completed',
        status_basis: 'team_member_run',
        source_refs: {
          team_member_run_id: '10000000-0000-4000-8000-000000000001',
        },
      },
      summary: {
        status: 'completed',
        entry_count: 3,
        last_timestamp: '2026-08-17T10:00:00.000Z',
        last_meaningful: {
          kind: 'tool_status',
          timestamp: '2026-08-17T10:00:00.000Z',
          action: 'Reviewed final output',
          result: 'All checks passed',
        },
        work_refs: ['W-1', 'W-2'],
        truncated: false,
      },
      entries: [
        {
          ordinal: 1,
          kind: 'lifecycle',
          sequence: 1,
          created_at: '2026-08-17T09:58:00.000Z',
          status: 'started',
        },
        {
          ordinal: 2,
          kind: 'tool_status',
          sequence: 2,
          created_at: '2026-08-17T09:59:00.000Z',
          activity_id: 'a1',
          category: 'read',
          status: 'completed',
          label: 'read_file',
          summary: 'Read config.ts',
          tool_name: 'zzz_future_tool_v9',
          provider: null,
          detail_kind: 'read',
          detail_text: null,
          exit_code: null,
          parent_activity_id: null,
        },
        {
          ordinal: 3,
          kind: 'permission',
          sequence: 3,
          created_at: '2026-08-17T10:00:00.000Z',
          activity_id: 'a2',
          category: 'tool',
          status: 'resolved',
          decision: 'allowed',
          summary: 'Allowed file write',
        },
      ],
    },
    {
      // The real projection-worker actor from rework-once.json: this lets
      // the assertions below exercise the Agent-to-Agent message join
      // (R3) against real recorded edges, not a fixture invented for it.
      label: {
        name: 'Worker Agent',
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
        last_timestamp: '2026-08-17T10:01:00.000Z',
        last_meaningful: null,
        work_refs: ['W-1'],
        truncated: true,
      },
      entries: [
        {
          ordinal: 1,
          kind: 'assistant_text',
          sequence: 1,
          created_at: '2026-08-17T10:00:30.000Z',
          text: 'Working on it...',
        },
        {
          ordinal: 2,
          kind: 'usage',
          sequence: 2,
          created_at: '2026-08-17T10:01:00.000Z',
          input_tokens: 1500,
          cached_input_tokens: null,
          output_tokens: 200,
          total_cost_usd: 0.0045,
          context_window_max_tokens: null,
          context_window_used_tokens: null,
        },
      ],
    },
    {
      label: {
        name: 'Risk Agent',
        role: 'member',
        status: 'idle',
        status_basis: 'team_member_run',
        source_refs: {
          team_member_run_id: '10000000-0000-4000-8000-000000000003',
        },
      },
      summary: {
        status: 'idle',
        entry_count: 1,
        last_timestamp: '2026-08-17T09:57:00.000Z',
        last_meaningful: null,
        work_refs: [],
        truncated: false,
      },
      entries: [
        {
          ordinal: 1,
          kind: 'permission',
          sequence: 1,
          created_at: '2026-08-17T09:57:00.000Z',
          activity_id: 'a3',
          category: 'tool',
          status: 'requested',
          decision: null,
          summary: '',
        },
      ],
    },
  ],
};

it('renders per-session transcripts with switching between sessions that share a role, truncation warning, permission honesty, and derived summary labeling', async () => {
  const trace = parseRecordedTrace(reworkRecording);
  const response = {
    ...MOCK_RESPONSE,
    work_id: trace.work.id,
    work_run_id: trace.workRun.id,
  } satisfies ProductSessionTranscriptsResponse;
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => response,
  });
  vi.stubGlobal('fetch', fetchMock);

  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);

  try {
    await act(async () => {
      root.render(<SessionTranscripts trace={trace} />);
    });
    // Wait for fetch to resolve
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    // 1. Role list is visible and switchable
    const roleNav = host.querySelector('[data-testid="session-role-nav"]');
    expect(roleNav).not.toBeNull();
    const roleButtons = [
      ...roleNav!.querySelectorAll<HTMLButtonElement>('button'),
    ];
    expect(roleButtons).toHaveLength(3);
    // Two sessions deliberately share the role 'member' — that is what a real
    // team Run produces. Sessions must stay individually addressable anyway.
    expect(roleButtons[0]!.textContent).toContain('Lead Agent');
    expect(roleButtons[1]!.textContent).toContain('Worker Agent');
    expect(roleButtons[2]!.textContent).toContain('Risk Agent');

    // First role is selected by default — entries are visible
    const entries = host.querySelector('[data-testid="session-entries"]');
    expect(entries).not.toBeNull();
    // Projected activity rows preserve the lifecycle, tool, and permission entries.
    const eventElements = entries!.querySelectorAll(
      '[data-testid="transcript-activity-row"], .transcript__lifecycle-start',
    );
    expect(eventElements.length).toBeGreaterThanOrEqual(2); // lifecycle + tool_status (+ maybe permission)

    // Switch to the second session (same role as the third one)
    await act(async () => {
      roleButtons[1]!.click();
    });
    expect(
      host.querySelector('.execution-transcript__detail header')!.textContent,
    ).toContain('Worker Agent');

    // R3: the Worker Agent's source_refs.team_member_run_id joins to the
    // real projection-worker actor in rework-once.json, so its reworked
    // Work Item (2 Attempts) surfaces an attempt/work-item filter and the
    // Team messages addressed to it -- resolved through trace.edges, not
    // invented for the session view.
    const workItemFilter = host.querySelector(
      '[data-testid="session-work-item-filter"]',
    );
    expect(workItemFilter).not.toBeNull();
    const filterButtons = [
      ...workItemFilter!.querySelectorAll<HTMLButtonElement>('button'),
    ];
    expect(filterButtons).toHaveLength(3); // "All work" + 2 Attempts
    expect(filterButtons[1]!.textContent).toContain('Attempt 1');
    expect(filterButtons[2]!.textContent).toContain('Attempt 2');
    const messagesSection = host.querySelector(
      '[data-testid="session-messages"]',
    );
    expect(messagesSection).not.toBeNull();
    expect(messagesSection!.textContent).toContain('projection-lead');
    expect(messagesSection!.textContent).toContain('projection-worker');
    expect(messagesSection!.querySelectorAll('article')).toHaveLength(2);

    // 2. Truncated=true shows warning
    const truncatedWarning = host.querySelector(
      '[data-testid="session-truncated-warning"]',
    );
    expect(truncatedWarning).not.toBeNull();
    expect(truncatedWarning!.textContent).toContain('truncated');

    // Switch to the third session — same role as the second, must not collide
    await act(async () => {
      roleButtons[2]!.click();
    });
    expect(
      host.querySelector('.execution-transcript__detail header')!.textContent,
    ).toContain('Risk Agent');
    expect(
      host.querySelector('[data-testid="session-platform-tool-count"]'),
    ).toBeNull();
    // Risk Agent's placeholder team_member_run_id joins to no real Work
    // Item, so the filter/message affordance is simply absent -- not an
    // error state (R3).
    expect(
      host.querySelector('[data-testid="session-work-item-filter"]'),
    ).toBeNull();
    expect(host.querySelector('[data-testid="session-messages"]')).toBeNull();

    // 3. Permission with null decision and non-resolved status shows "Not captured / not triggered"
    const riskEntries = host.querySelector('[data-testid="session-entries"]');
    expect(riskEntries).not.toBeNull();
    expect(riskEntries!.textContent).toContain('Not captured / not triggered');

    // Switch back to lead role to check derived summary
    await act(async () => {
      roleButtons[0]!.click();
    });

    // 4. Derived summary has "not provider text" labeling
    const summaryBlock = host.querySelector('[data-testid="session-summary"]');
    expect(summaryBlock).not.toBeNull();
    expect(summaryBlock!.textContent).toContain('not provider text');
    expect(
      summaryBlock!.querySelector('[data-testid="session-platform-tool-count"]')
        ?.textContent,
    ).toContain('1');

    // The renderer is namespace/provenance-driven: a future server tool name
    // stays visibly platform-owned rather than falling through a frontend list.
    const platformRow = host.querySelector('[data-platform-tool="true"]');
    expect(platformRow?.tagName).toBe('DETAILS');
    expect(platformRow?.getAttribute('data-tool-name')).toBe(
      'zzz_future_tool_v9',
    );
    expect(platformRow?.textContent).toContain('Zzz Future Tool V9');
    expect(
      platformRow?.querySelector('.transcript__detail')?.textContent,
    ).toMatch(/not captured/i);
    expect(platformRow?.querySelector('.transcript__detail pre')).toBeNull();

    // Null provenance is intentionally not an interactive platform row, but
    // preserving that entry still leaves the total rendered unit count intact.
    const withPlatformCount = host.querySelectorAll('.transcript__item').length;
    const withoutPlatform = structuredClone(MOCK_RESPONSE);
    const toolEntry = withoutPlatform.sessions[0]!.entries.find(
      (entry) => entry.kind === 'tool_status',
    );
    if (!toolEntry)
      throw new Error('Fixture must contain a tool_status entry.');
    toolEntry.tool_name = null;
    withoutPlatform.work_id = trace.work.id;
    withoutPlatform.work_run_id = trace.workRun.id;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => withoutPlatform,
    });
    await act(async () => {
      root.render(
        <SessionTranscripts key="without-platform-provenance" trace={trace} />,
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    const staticTool = host.querySelector('[data-transcript-row-kind="tool"]');
    expect(staticTool?.tagName).toBe('DIV');
    expect(staticTool?.classList.contains('transcript__row--static')).toBe(
      true,
    );
    expect(host.querySelector('[data-platform-tool="true"]')).toBeNull();
    expect(
      host.querySelector('[data-testid="session-platform-tool-count"]'),
    ).toBeNull();
    expect(host.querySelectorAll('.transcript__item')).toHaveLength(
      withPlatformCount,
    );
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it('renders a single-agent session with no role element shown', async () => {
  // A lone agent (no Team) has no role -- printing "null", or fabricating
  // "lead" to fill the gap, would both assert a product fact the domain
  // does not hold (role === 'lead' gates real lead behavior server-side).
  const trace = parseRecordedTrace(reworkRecording);
  const response: ProductSessionTranscriptsResponse = {
    work_id: trace.work.id,
    work_run_id: trace.workRun.id,
    capture_scope: 'safe_run_events',
    sessions: [
      {
        label: {
          name: 'Solo Agent',
          role: null,
          status: 'completed',
          status_basis: 'agent_runs',
          source_refs: { task_id: '20000000-0000-4000-8000-000000000001' },
        },
        summary: {
          status: 'completed',
          entry_count: 1,
          last_timestamp: '2026-08-17T10:00:00.000Z',
          last_meaningful: null,
          work_refs: [],
          truncated: false,
        },
        entries: [
          {
            ordinal: 1,
            kind: 'lifecycle',
            sequence: 1,
            created_at: '2026-08-17T09:58:00.000Z',
            status: 'started',
          },
        ],
      },
    ],
  };
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => response,
  });
  vi.stubGlobal('fetch', fetchMock);

  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(<SessionTranscripts trace={trace} />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    const roleNav = host.querySelector('[data-testid="session-role-nav"]');
    expect(roleNav).not.toBeNull();
    const soloButton = roleNav!.querySelector('button');
    expect(soloButton?.textContent).toContain('Solo Agent');
    // No role element at all -- not a "null" string, not an invented "lead".
    expect(soloButton?.querySelector('span')).toBeNull();

    const header = host.querySelector('.execution-transcript__detail header');
    expect(header?.textContent).toContain('Solo Agent');
    expect(header?.textContent).not.toContain('Role:');
    expect(header?.textContent).not.toContain('null');
    expect(header?.textContent).not.toContain('lead');

    // No Work Items are joinable via a task_id-only source_ref, so the
    // filter/message affordance is absent rather than erroring.
    expect(
      host.querySelector('[data-testid="session-work-item-filter"]'),
    ).toBeNull();
    expect(host.querySelector('[data-testid="session-messages"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
