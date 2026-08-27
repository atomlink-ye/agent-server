import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';

import { BoardsPage } from './BoardsPage';
import { WORK_BOARD_NOT_FOUND_CODE } from '@atomlink-ye/agent-server/product-contract';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const boardId = '00000000-0000-4000-8000-000000000201';
const columnId = '00000000-0000-4000-8000-000000000202';
const newWorkItemId = '00000000-0000-4000-8000-000000000203';

afterEach(() => vi.unstubAllGlobals());

it('stays on the Board and shows the new card after "+ Task" instead of jumping to the Task detail page', async () => {
  let cardCreated = false;
  const promptValues = ['New card title', ''];
  vi.stubGlobal(
    'prompt',
    vi.fn(() => promptValues.shift() ?? null),
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/boards' && (init?.method ?? 'GET') === 'GET')
        return json({ boards: [board()] });
      if (path === `/api/boards/${boardId}`) return json(snapshot(cardCreated));
      if (path === '/api/work-items' && init?.method === 'POST') {
        cardCreated = true;
        return json({
          work_item: workItem(),
          linked_work: null,
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
        <MemoryRouter initialEntries={[`/boards/${boardId}`]}>
          <Routes>
            <Route
              path="/boards/:boardId"
              element={<BoardsPage selectedBoardId={boardId} />}
            />
            <Route
              path="/tasks/:workItemId"
              element={<p>Task detail page</p>}
            />
          </Routes>
        </MemoryRouter>,
      );
    });
    await act(settle);
    await act(settle);

    expect(host.textContent).not.toContain('New card title');

    const addCardButton = [
      ...host.querySelectorAll<HTMLButtonElement>('button'),
    ].find((button) => button.textContent === '+ Task');
    if (!addCardButton) throw new Error('Expected a "+ Task" button.');

    await act(async () => {
      addCardButton.click();
      await settle();
    });

    expect(host.textContent).not.toContain('Task detail page');
    expect(host.textContent).toContain('New card title');
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it('shows a missing selected Board without Retry, while a snapshot transport failure remains retryable', async () => {
  const missingId = '00000000-0000-4000-8000-000000000299';
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === '/api/boards') return json({ boards: [] });
      if (path === `/api/boards/${missingId}`)
        return json({ error: { code: WORK_BOARD_NOT_FOUND_CODE } }, 404);
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
          <BoardsPage selectedBoardId={missingId} />
        </MemoryRouter>,
      );
    });
    await act(settle);
    expect(host.textContent).toContain('The selected Board is unavailable.');
    expect(host.textContent).toContain('Back to Boards');
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

it('keeps Retry for a selected Board transport failure', async () => {
  const failedId = '00000000-0000-4000-8000-000000000298';
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === '/api/boards') return json({ boards: [] });
      if (path === `/api/boards/${failedId}`)
        return json({ error: { code: 'request_failed' } }, 500);
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
          <BoardsPage selectedBoardId={failedId} />
        </MemoryRouter>,
      ),
    );
    await act(settle);
    expect(host.textContent).toContain('Board could not be loaded');
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

it('shows selected Board loading instead of an empty state', async () => {
  const loadingId = '00000000-0000-4000-8000-000000000297';
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const path = String(input);
      if (path === '/api/boards') return Promise.resolve(json({ boards: [] }));
      if (path === `/api/boards/${loadingId}`)
        return new Promise<Response>(() => {});
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
          <BoardsPage selectedBoardId={loadingId} />
        </MemoryRouter>,
      ),
    );
    await act(settle);
    expect(host.textContent).toContain('Loading selected Board…');
    expect(
      host.querySelector('[data-testid="boards-selected-loading"]'),
    ).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

function board() {
  return {
    id: boardId,
    workspace_id: '00000000-0000-4000-8000-000000000205',
    title: 'Launch board',
    description: null,
    created_by: 'principal-1',
    created_at: '2026-08-26T00:00:00.000Z',
    updated_at: '2026-08-26T00:00:00.000Z',
  };
}

function workItem() {
  return {
    id: newWorkItemId,
    workspace_id: '00000000-0000-4000-8000-000000000205',
    title: 'New card title',
    description: null,
    status: 'todo',
    assignee_id: null,
    created_by: 'principal-1',
    source_conversation_id: null,
    source_message_id: null,
    linked_work_id: null,
    created_at: '2026-08-26T00:00:00.000Z',
    updated_at: '2026-08-26T00:00:00.000Z',
  };
}

function snapshot(withCard: boolean) {
  return {
    board: board(),
    columns: [
      {
        id: columnId,
        board_id: boardId,
        title: 'Todo',
        position: 0,
        created_at: '2026-08-26T00:00:00.000Z',
        updated_at: '2026-08-26T00:00:00.000Z',
      },
    ],
    placements: withCard
      ? [
          {
            board_id: boardId,
            column_id: columnId,
            work_item_id: newWorkItemId,
            position: 0,
            created_at: '2026-08-26T00:00:00.000Z',
            updated_at: '2026-08-26T00:00:00.000Z',
          },
        ]
      : [],
    work_items: withCard ? [workItem()] : [],
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
