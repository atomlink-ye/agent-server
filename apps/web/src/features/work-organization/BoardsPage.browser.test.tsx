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

it('adds a Task card through the in-app form instead of a native dialog', async () => {
  let cardCreated = false;
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

    expect(host.textContent).toContain('Add a Task card');
    const title = host.querySelector<HTMLInputElement>(
      'input[placeholder="Task title"]',
    );
    if (!title) throw new Error('Expected an in-app Task title input.');
    await act(async () => {
      setInputValue(title, 'New card title');
      await settle();
    });
    const addTaskButton = [
      ...host.querySelectorAll<HTMLButtonElement>('button'),
    ].find((button) => button.textContent === 'Add Task');
    if (!addTaskButton) throw new Error('Expected an "Add Task" button.');
    await act(async () => {
      addTaskButton.click();
      await settle();
    });

    expect(host.textContent).not.toContain('Task detail page');
    expect(host.textContent).toContain('New card title');
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it('keeps a failed Board mutation visible to the user', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/boards' && (init?.method ?? 'GET') === 'GET')
        return json({ boards: [board()] });
      if (path === `/api/boards/${boardId}` && init?.method === 'PATCH')
        return json({ error: { code: 'request_failed' } }, 500);
      if (path === `/api/boards/${boardId}`) return json(snapshot(false));
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
          <BoardsPage selectedBoardId={boardId} />
        </MemoryRouter>,
      );
    });
    await act(settle);
    const renameButton = [
      ...host.querySelectorAll<HTMLButtonElement>('button'),
    ].find((button) => button.textContent === 'Rename');
    if (!renameButton) throw new Error('Expected a Board rename button.');
    await act(async () => {
      renameButton.click();
      await settle();
    });
    const title = host.querySelector<HTMLInputElement>('input');
    if (!title) throw new Error('Expected a Board title input.');
    await act(async () => {
      setInputValue(title, 'Rejected Board title');
      await settle();
    });
    const saveButton = [
      ...host.querySelectorAll<HTMLButtonElement>('button'),
    ].find((button) => button.textContent === 'Save');
    if (!saveButton) throw new Error('Expected a Save button.');
    await act(async () => {
      saveButton.click();
      await settle();
    });

    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      'That Board change could not be saved. Please try again.',
    );
    expect(host.textContent).toContain('Rename this Board');
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

function setInputValue(input: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  );
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
