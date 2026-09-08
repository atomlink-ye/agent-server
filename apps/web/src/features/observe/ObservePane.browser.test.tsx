import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import '../../index.css';

import { ObservePane } from './ObservePane';

const listWorks = vi.fn();
const loadSessionTranscripts = vi.fn();
const loadCoworkers = vi.fn();
const loadCoworkerProfile = vi.fn();

vi.mock('../work/clients/work-client', () => ({
  workClient: { list: (...args: unknown[]) => listWorks(...args) },
}));
vi.mock('../run-trace/run-trace-gateway', () => ({
  loadSessionTranscripts: (...args: unknown[]) =>
    loadSessionTranscripts(...args),
}));
vi.mock('../agents/agents-gateway', () => ({
  loadCoworkers: () => loadCoworkers(),
  loadCoworkerProfile: (id: string) => loadCoworkerProfile(id),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const WORK_ITEM = {
  id: 'work-1',
  tenant_id: 'tenant',
  workspace_id: 'workspace-1',
  definition_id: 'definition-1',
  definition_version_id: 'definition-version-1',
  title: 'Draft the quarterly report',
  origin: 'created' as const,
  archived_at: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-02T00:00:00.000Z',
  product_state: 'complete' as const,
  latest_run_summary: {
    id: 'run-1',
    updated_at: '2026-01-02T00:00:00.000Z',
    result_summary: 'Report drafted.',
    result_capture_status: 'present' as const,
    runtime_models: ['gpt-5.6-terra'],
  },
};

it('lists traced Work, keeps trace Workers visible, and filters by the complete Coworker roster', async () => {
  listWorks.mockResolvedValue({ works: [WORK_ITEM], next_cursor: null });
  loadCoworkers.mockResolvedValue([
    { id: 'agent-a', displayName: 'Report Owner' },
    { id: 'agent-b', displayName: 'No Capability Coworker' },
  ]);
  loadCoworkerProfile.mockImplementation(async (id: string) => ({
    workCatalog: id === 'agent-a' ? [{ definitionId: 'definition-1' }] : [],
  }));
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
        entries: [],
      },
    ],
  });

  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/observe']}>
        <ObservePane />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  try {
    const list = host.querySelector('[data-testid="observe-list"]');
    expect(list?.textContent).toContain('Draft the quarterly report');
    expect(list?.textContent).toContain('Report Writer');
    expect(list?.textContent).toContain('Model: gpt-5.6-terra');

    const agentSelect = host.querySelector<HTMLSelectElement>(
      '[aria-label="Filter by Agent"]',
    );
    expect(agentSelect).not.toBeNull();
    expect(
      Array.from(agentSelect!.options).map((option) => option.textContent),
    ).toContain('Report Owner');
    expect(
      Array.from(agentSelect!.options).map((option) => option.textContent),
    ).toContain('No Capability Coworker');

    await act(async () => {
      agentSelect!.value = 'agent-a';
      agentSelect!.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });
    expect(
      host.querySelector('[data-testid="observe-list"]')?.textContent,
    ).toContain('Draft the quarterly report');
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it('shows an empty-filter placeholder when no traced Run matches', async () => {
  listWorks.mockResolvedValue({ works: [WORK_ITEM], next_cursor: null });
  loadCoworkers.mockResolvedValue([]);
  loadSessionTranscripts.mockResolvedValue({
    work_id: 'work-1',
    work_run_id: 'run-1',
    capture_scope: 'safe_run_events',
    sessions: [],
  });

  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/observe?status=running']}>
        <ObservePane />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  try {
    expect(
      host.querySelector('[data-testid="observe-list-empty"]'),
    ).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it('scrolls the real Observe list to its final traced Run on desktop', async () => {
  listWorks.mockResolvedValue({ works: Array.from({ length: 48 }, (_, index) => ({ ...WORK_ITEM, id: `work-${index}`, title: index === 47 ? 'Final real traced Run' : `Traced Work ${index}`, latest_run_summary: { ...WORK_ITEM.latest_run_summary, id: `run-${index}` } })), next_cursor: null });
  loadCoworkers.mockResolvedValue([]);
  loadCoworkerProfile.mockResolvedValue({ workCatalog: [{ definitionId: 'definition-1' }] });
  loadSessionTranscripts.mockResolvedValue({ work_id: 'work-1', work_run_id: 'run-1', capture_scope: 'safe_run_events', sessions: [] });
  const host = document.createElement('div'); host.style.height = '900px'; document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => { root.render(<MemoryRouter><div className="app-shell"><ObservePane /></div></MemoryRouter>); for (let turn = 0; turn < 5; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0)); });
    const region = host.querySelector<HTMLElement>('[data-testid="observe-list"]')!;
    expect(region.scrollHeight).toBeGreaterThan(region.clientHeight);
    region.scrollTop = region.scrollHeight;
    expect(region.scrollTop).toBeGreaterThan(0);
    const final = [...region.querySelectorAll('a')].find((item) => item.textContent?.includes('Final real traced Run'))!;
    expect(final.getBoundingClientRect().bottom).toBeLessThanOrEqual(region.getBoundingClientRect().bottom + 1);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
