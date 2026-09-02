import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';

import { ObservePane } from './ObservePane';

const listWorks = vi.fn();
const sessionTranscripts = vi.fn();

vi.mock('../work/clients/work-client', () => ({
  workClient: { list: (...args: unknown[]) => listWorks(...args) },
}));
vi.mock('../work/clients/work-run-client', () => ({
  workRunClient: {
    sessionTranscripts: (...args: unknown[]) => sessionTranscripts(...args),
  },
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
  },
};

it('lists traced Work, resolves participating Agents, and filters by Agent', async () => {
  listWorks.mockResolvedValue({ works: [WORK_ITEM], next_cursor: null });
  sessionTranscripts.mockResolvedValue([
    {
      label: {
        name: 'Report Writer',
        role: null,
        status: 'idle',
        status_basis: 'agent_runs',
        source_refs: {},
      },
      summary: { entry_count: 1, last_meaningful: null },
    },
  ]);

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

    const agentSelect = host.querySelector<HTMLSelectElement>(
      '[aria-label="Filter by Agent"]',
    );
    expect(agentSelect).not.toBeNull();
    expect(
      Array.from(agentSelect!.options).map((option) => option.textContent),
    ).toContain('Report Writer');

    await act(async () => {
      agentSelect!.value = 'Report Writer';
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
  sessionTranscripts.mockResolvedValue([]);

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
