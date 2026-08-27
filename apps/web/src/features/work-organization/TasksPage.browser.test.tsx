import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';

import { TasksPage } from './TasksPage';
import { WORK_ITEM_NOT_FOUND_CODE } from '@atomlink-ye/agent-server/product-contract';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const workItemId = '00000000-0000-4000-8000-000000000101';
const definitionId = '00000000-0000-4000-8000-000000000102';
const versionId = '00000000-0000-4000-8000-000000000103';

afterEach(() => vi.unstubAllGlobals());

it('selects a published Definition and coworker by display-safe labels while promoting canonical IDs', async () => {
  let promotionBody: unknown = null;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/work-items') return json({ work_items: [task()] });
      if (path === '/api/agents')
        return json({
          items: [
            {
              id: 'coworker-1',
              display_name: 'Ari Analyst',
              role_label: 'Research',
              summary: null,
              active_agent_version_id: 'version-1',
              runtime_status: 'available',
            },
          ],
        });
      if (path === `/api/work-items/${workItemId}/comments`)
        return json({ comments: [] });
      if (path === '/api/work-definitions')
        return json({
          items: [
            {
              definitionId,
              displayName: 'Quarterly research brief',
              currentPublishedVersionId: versionId,
            },
          ],
        });
      if (
        path === `/api/work-items/${workItemId}/promote` &&
        init?.method === 'POST'
      ) {
        promotionBody = JSON.parse(String(init.body));
        return json({
          ...task(),
          linked_work: {
            work_id: '00000000-0000-4000-8000-000000000104',
            title: 'Prepare brief',
            product_state: 'running',
            latest_work_run_id: null,
            result_summary: null,
          },
        });
      }
      throw new Error(`Unexpected browser request: ${path}`);
    }),
  );

  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[`/tasks/${workItemId}`]}>
          <TasksPage selectedWorkItemId={workItemId} />
        </MemoryRouter>,
      );
    });
    await act(settle);
    await act(settle);

    expect(host.textContent).toContain('Quarterly research brief');
    expect(host.textContent).toContain('Ari Analyst · Research · available');
    expect(host.textContent).not.toContain(definitionId);
    expect(host.textContent).not.toContain(versionId);
    expect(host.textContent).not.toContain('coworker-1');

    const definition = host.querySelector<HTMLSelectElement>(
      '[aria-label="Published Work Definition"]',
    );
    const assignee = [
      ...host.querySelectorAll<HTMLSelectElement>('select'),
    ].find((select) => select.labels?.[0]?.textContent?.includes('Assignee'));
    if (!definition || !assignee)
      throw new Error('Expected promotion selectors.');

    await act(async () => {
      definition.value = definitionId;
      definition.dispatchEvent(new Event('change', { bubbles: true }));
      assignee.value = 'coworker-1';
      assignee.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const promote = [...host.querySelectorAll('button')].find(
      (button) => button.textContent === 'Create Work',
    );
    if (!promote) throw new Error('Expected Create Work button.');
    await act(async () => {
      promote.click();
      await settle();
    });

    expect(promotionBody).toMatchObject({
      definition_id: definitionId,
      definition_version_id: versionId,
    });
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it('shows a missing selected Task without Retry, while a transport failure remains retryable', async () => {
  const missingId = '00000000-0000-4000-8000-000000000199';
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === '/api/work-items') return json({ work_items: [] });
      if (path === '/api/agents') return json({ items: [] });
      if (
        path === `/api/work-items/${missingId}` ||
        path === `/api/work-items/${missingId}/comments`
      )
        return json({ error: { code: WORK_ITEM_NOT_FOUND_CODE } }, 404);
      throw new Error(`Unexpected browser request: ${path}`);
    }),
  );
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <TasksPage selectedWorkItemId={missingId} />
        </MemoryRouter>,
      );
    });
    await act(settle);
    expect(host.textContent).toContain('The selected Task is unavailable.');
    expect(host.textContent).toContain('Back to Tasks');
    expect(
      [...host.querySelectorAll('button')].some(
        (button) => button.textContent === 'Retry',
      ),
    ).toBe(false);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it('keeps Retry for a selected Task transport failure', async () => {
  const failedId = '00000000-0000-4000-8000-000000000198';
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === '/api/work-items') return json({ work_items: [] });
      if (path === '/api/agents') return json({ items: [] });
      if (path === `/api/work-items/${failedId}`)
        return json({ error: { code: 'request_failed' } }, 500);
      if (path === `/api/work-items/${failedId}/comments`)
        return json({ comments: [] });
      throw new Error(`Unexpected browser request: ${path}`);
    }),
  );
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <MemoryRouter>
          <TasksPage selectedWorkItemId={failedId} />
        </MemoryRouter>,
      ),
    );
    await act(settle);
    expect(host.textContent).toContain('Task could not be loaded');
    expect(
      [...host.querySelectorAll('button')].some(
        (button) => button.textContent === 'Retry',
      ),
    ).toBe(true);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it('keeps the newer Task selection when an older selected read finishes late', async () => {
  const firstId = '00000000-0000-4000-8000-000000000196';
  const secondId = '00000000-0000-4000-8000-000000000197';
  let resolveFirst: ((response: Response) => void) | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const path = String(input);
      if (path === '/api/work-items')
        return Promise.resolve(json({ work_items: [] }));
      if (path === '/api/agents') return Promise.resolve(json({ items: [] }));
      if (path === `/api/work-items/${firstId}`)
        return new Promise<Response>((resolve) => {
          resolveFirst = resolve;
        });
      if (path === `/api/work-items/${secondId}`)
        return Promise.resolve(json(taskFor(secondId, 'Second Task')));
      if (path.endsWith('/comments'))
        return Promise.resolve(json({ comments: [] }));
      throw new Error(`Unexpected browser request: ${path}`);
    }),
  );
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <MemoryRouter>
          <TasksPage selectedWorkItemId={firstId} />
        </MemoryRouter>,
      ),
    );
    await act(async () =>
      root.render(
        <MemoryRouter>
          <TasksPage selectedWorkItemId={secondId} />
        </MemoryRouter>,
      ),
    );
    await act(settle);
    await act(async () =>
      resolveFirst?.(json({ error: { code: WORK_ITEM_NOT_FOUND_CODE } }, 404)),
    );
    await act(settle);
    expect(host.textContent).toContain('Second Task');
    expect(host.textContent).not.toContain('The selected Task is unavailable.');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it('shows selected Task loading instead of an empty state', async () => {
  const loadingId = '00000000-0000-4000-8000-000000000195';
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const path = String(input);
      if (path === '/api/work-items')
        return Promise.resolve(json({ work_items: [] }));
      if (path === '/api/agents') return Promise.resolve(json({ items: [] }));
      if (path === `/api/work-items/${loadingId}`)
        return new Promise<Response>(() => {});
      if (path.endsWith('/comments'))
        return Promise.resolve(json({ comments: [] }));
      throw new Error(`Unexpected browser request: ${path}`);
    }),
  );
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <MemoryRouter>
          <TasksPage selectedWorkItemId={loadingId} />
        </MemoryRouter>,
      ),
    );
    await act(settle);
    expect(host.textContent).toContain('Loading selected Task…');
    expect(
      host.querySelector('[data-testid="tasks-selected-loading"]'),
    ).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

function task() {
  return taskFor(workItemId, 'Prepare brief');
}

function taskFor(id: string, title: string) {
  return {
    work_item: {
      id,
      workspace_id: '00000000-0000-4000-8000-000000000105',
      title,
      description: null,
      status: 'todo',
      assignee_id: null,
      created_by: 'principal-1',
      source_conversation_id: null,
      source_message_id: null,
      linked_work_id: null,
      created_at: '2026-08-26T00:00:00.000Z',
      updated_at: '2026-08-26T00:00:00.000Z',
    },
    linked_work: null,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 4; turn += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();
  }
}
