import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

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

let nativeDialogSpies: {
  readonly prompt: ReturnType<typeof vi.spyOn>;
  readonly confirm: ReturnType<typeof vi.spyOn>;
  readonly alert: ReturnType<typeof vi.spyOn>;
};

beforeEach(() => {
  nativeDialogSpies = {
    prompt: vi.spyOn(window, 'prompt').mockImplementation(() => null),
    confirm: vi.spyOn(window, 'confirm').mockImplementation(() => false),
    alert: vi.spyOn(window, 'alert').mockImplementation(() => undefined),
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('adds a Task card through the in-app form instead of a native dialog', async () => {
  let cardCreated = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/agents') return json({ items: [] });
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
    ].find((button) => button.textContent === '+ 新建任务');
    if (!addCardButton) throw new Error('Expected a "+ 新建任务" button.');

    await act(async () => {
      addCardButton.click();
      await settle();
    });

    expect(host.textContent).toContain('添加任务卡片');
    const title = host.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="任务标题…"]',
    );
    if (!title) throw new Error('Expected an in-app Task title textarea.');
    await act(async () => {
      setTextareaValue(title, 'New card title');
      await settle();
    });
    const addTaskButton = [
      ...host.querySelectorAll<HTMLButtonElement>('button'),
    ].find((button) => button.textContent === '添加任务');
    if (!addTaskButton) throw new Error('Expected an "添加任务" button.');
    await act(async () => {
      addTaskButton.click();
      await settle();
    });

    expect(host.textContent).not.toContain('Task detail page');
    expect(host.textContent).toContain('New card title');
    expectNoNativeDialogs();
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
      if (path === '/api/agents') return json({ items: [] });
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
    ].find((button) => button.textContent === '重命名');
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
    ].find((button) => button.textContent === '保存');
    if (!saveButton) throw new Error('Expected a 保存 button.');
    await act(async () => {
      saveButton.click();
      await settle();
    });

    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      '这次看板改动没能保存，请重试。',
    );
    expect(host.textContent).toContain('重命名这个看板');
    expectNoNativeDialogs();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it('completes every Board authoring action in-app and requires confirmed deletion', async () => {
  const api = createBoardApi();
  const mounted = await mountRoutedBoards(api.fetch);
  try {
    await clickButton(mounted.host, '+ 新建看板');
    await setInputValueByAriaLabel(mounted.host, '新看板标题', 'Release Board');
    await clickButton(mounted.host, '创建');
    await expectText(mounted.host, 'Release Board');

    await clickButton(mounted.host, '重命名');
    await setInputValueByLabel(
      mounted.host,
      '看板标题',
      'Release Board renamed',
    );
    await clickButton(mounted.host, '保存');
    await expectText(mounted.host, 'Release Board renamed');

    await clickButton(mounted.host, '+ 新建列');
    await setInputValueByPlaceholder(mounted.host, '列标题', 'Backlog');
    await clickButton(mounted.host, '添加');
    await expectText(mounted.host, 'Backlog · 0');

    await clickButton(mounted.host, '重命名 Backlog');
    await setInputValueByLabel(mounted.host, '列标题', 'Ready');
    await clickButton(mounted.host, '保存');
    await expectText(mounted.host, 'Ready · 0');

    await clickButton(mounted.host, '+ 新建任务');
    await setTextareaValueByLabel(
      mounted.host,
      '任务标题',
      'Release checklist',
    );
    await setTextareaValueByLabel(
      mounted.host,
      '描述（可选）',
      'Verify the release in the Board.',
    );
    await clickButton(mounted.host, '添加任务');
    await expectText(mounted.host, 'Release checklist');
    expect(api.requests).toContainEqual(
      expect.objectContaining({
        method: 'POST',
        path: '/api/work-items',
        body: expect.objectContaining({
          title: 'Release checklist',
          description: 'Verify the release in the Board.',
        }),
      }),
    );

    await clickButton(mounted.host, '删除 Ready');
    await expectText(mounted.host, '卡片会作为任务保留，但会离开这个看板。');
    await clickButton(mounted.host, '取消');
    await expectAuthoringAbsent(mounted.host);
    await expectText(mounted.host, 'Ready · 1');
    expect(api.deleteColumnRequests).toBe(0);

    await clickButton(mounted.host, '删除 Ready');
    await clickAuthoringButton(mounted.host, '删除');
    await expectAbsent(mounted.host, 'Ready · 1');
    expect(api.deleteColumnRequests).toBe(1);

    await clickToolbarButton(mounted.host, '删除');
    await expectText(mounted.host, '任务本身会保留，只移除这个看板视图。');
    await clickButton(mounted.host, '取消');
    await expectAuthoringAbsent(mounted.host);
    await expectText(mounted.host, 'Release Board renamed');
    expect(api.deleteBoardRequests).toBe(0);

    await clickToolbarButton(mounted.host, '删除');
    await clickAuthoringButton(mounted.host, '删除');
    await expectText(mounted.host, '选择一个看板');
    expect(api.deleteBoardRequests).toBe(1);
    expectNoNativeDialogs();
  } finally {
    await mounted.dispose();
  }
});

it('disables authoring controls until a title can succeed', async () => {
  const api = createBoardApi({ initialBoard: true });
  const mounted = await mountRoutedBoards(api.fetch);
  try {
    await clickButton(mounted.host, '重命名');
    await expectAuthoringSubmitDisabled(mounted.host, true);
    await setInputValueByLabel(mounted.host, '看板标题', 'Changed Board title');
    await expectAuthoringSubmitDisabled(mounted.host, false);
    await setInputValueByLabel(mounted.host, '看板标题', '');
    await expectAuthoringSubmitDisabled(mounted.host, true);
    await clickButton(mounted.host, '取消');

    await clickButton(mounted.host, '重命名 Todo');
    await expectAuthoringSubmitDisabled(mounted.host, true);
    await setInputValueByLabel(mounted.host, '列标题', 'Changed Column title');
    await expectAuthoringSubmitDisabled(mounted.host, false);
    await setInputValueByLabel(mounted.host, '列标题', '');
    await expectAuthoringSubmitDisabled(mounted.host, true);
    await clickButton(mounted.host, '取消');

    await clickButton(mounted.host, '+ 新建任务');
    await expectAuthoringSubmitDisabled(mounted.host, true);
    await setTextareaValueByLabel(mounted.host, '任务标题', 'Valid Task title');
    await expectAuthoringSubmitDisabled(mounted.host, false);
    expectNoNativeDialogs();
  } finally {
    await mounted.dispose();
  }
});

for (const failure of [
  {
    name: 'Board creation',
    begin: async (host: HTMLElement) => {
      await clickButton(host, '+ 新建看板');
      await setInputValueByAriaLabel(host, '新看板标题', 'Unsent Board');
      await clickButton(host, '创建');
    },
    failedRequest: { method: 'POST', path: '/api/boards' },
    preserved: 'Unsent Board',
    panel: '给这个看板起个名字',
  },
  {
    name: 'Board rename',
    begin: async (host: HTMLElement) => {
      await clickButton(host, '重命名');
      await setInputValueByLabel(host, '看板标题', 'Unsent Board rename');
      await clickButton(host, '保存');
    },
    failedRequest: { method: 'PATCH', path: `/api/boards/${boardId}` },
    preserved: 'Unsent Board rename',
    panel: '重命名这个看板',
  },
  {
    name: 'Column creation',
    begin: async (host: HTMLElement) => {
      await clickButton(host, '+ 新建列');
      await setInputValueByPlaceholder(host, '列标题', 'Unsent Column');
      await clickButton(host, '添加');
    },
    failedRequest: {
      method: 'POST',
      path: `/api/boards/${boardId}/columns`,
    },
    preserved: 'Unsent Column',
    panel: '添加',
  },
  {
    name: 'Column rename',
    begin: async (host: HTMLElement) => {
      await clickButton(host, '重命名 Todo');
      await setInputValueByLabel(host, '列标题', 'Unsent Column rename');
      await clickButton(host, '保存');
    },
    failedRequest: {
      method: 'PATCH',
      path: `/api/boards/${boardId}/columns/${columnId}`,
    },
    preserved: 'Unsent Column rename',
    panel: '重命名这一列',
  },
  {
    name: 'Task creation',
    begin: async (host: HTMLElement) => {
      await clickButton(host, '+ 新建任务');
      await setTextareaValueByLabel(host, '任务标题', 'Unsent Task');
      await setTextareaValueByLabel(
        host,
        '描述（可选）',
        'Unsent Task description',
      );
      await clickButton(host, '添加任务');
    },
    failedRequest: { method: 'POST', path: '/api/work-items' },
    preserved: ['Unsent Task', 'Unsent Task description'],
    panel: '添加任务卡片',
  },
  {
    name: 'Column deletion',
    begin: async (host: HTMLElement) => {
      await clickButton(host, '删除 Todo');
      await clickAuthoringButton(host, '删除');
    },
    failedRequest: {
      method: 'DELETE',
      path: `/api/boards/${boardId}/columns/${columnId}`,
    },
    preserved: '卡片会作为任务保留，但会离开这个看板。',
    panel: '删除列“Todo”？',
  },
  {
    name: 'Board deletion',
    begin: async (host: HTMLElement) => {
      await clickToolbarButton(host, '删除');
      await clickAuthoringButton(host, '删除');
    },
    failedRequest: { method: 'DELETE', path: `/api/boards/${boardId}` },
    preserved: '任务本身会保留，只移除这个看板视图。',
    panel: '删除“Launch board”？',
  },
]) {
  it(`keeps ${failure.name} visible when its mutation fails`, async () => {
    const api = createBoardApi({
      initialBoard: failure.name !== 'Board creation',
      failRequest: failure.failedRequest,
    });
    const mounted = await mountRoutedBoards(api.fetch);
    try {
      await failure.begin(mounted.host);
      await expectAlert(mounted.host);
      await expectText(mounted.host, failure.panel);
      for (const value of Array.isArray(failure.preserved)
        ? failure.preserved
        : [failure.preserved])
        await expectVisibleValue(mounted.host, value);
      expectNoNativeDialogs();
    } finally {
      await mounted.dispose();
    }
  });
}

it('shows a missing selected Board without Retry, while a snapshot transport failure remains retryable', async () => {
  const missingId = '00000000-0000-4000-8000-000000000299';
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === '/api/agents') return json({ items: [] });
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
    expect(host.textContent).toContain('所选看板已不可用。');
    expect(host.textContent).toContain('返回看板列表');
    expect(
      [...host.querySelectorAll('button')].some(
        (button) => button.textContent === '重试',
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
      if (path === '/api/agents') return json({ items: [] });
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
    expect(host.textContent).toContain('看板加载失败');
    expect(
      [...host.querySelectorAll('button')].some(
        (button) => button.textContent === '重试',
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
      if (path === '/api/agents') return json({ items: [] });
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
    expect(host.textContent).toContain('正在加载所选看板…');
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
    mentions: [],
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
        kind: null,
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

function setTextareaValue(textarea: HTMLTextAreaElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    'value',
  );
  descriptor?.set?.call(textarea, value);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

type BoardRequest = {
  readonly method: string;
  readonly path: string;
  readonly body: Record<string, unknown> | null;
};

function createBoardApi({
  initialBoard = false,
  failRequest,
}: {
  readonly initialBoard?: boolean;
  readonly failRequest?: Pick<BoardRequest, 'method' | 'path'>;
} = {}) {
  let boardCreated = initialBoard;
  let boardDeleted = false;
  let boardTitle = 'Launch board';
  let columnCreated = initialBoard;
  let columnDeleted = false;
  let columnTitle = 'Todo';
  let card: {
    readonly title: string;
    readonly description: string | null;
  } | null = null;
  const requests: BoardRequest[] = [];
  let deleteColumnRequests = 0;
  let deleteBoardRequests = 0;

  const currentBoard = () => ({
    id: boardId,
    workspace_id: '00000000-0000-4000-8000-000000000205',
    title: boardTitle,
    description: null,
    created_by: 'principal-1',
    created_at: '2026-08-26T00:00:00.000Z',
    updated_at: '2026-08-26T00:00:00.000Z',
  });
  const currentColumn = () => ({
    id: columnId,
    board_id: boardId,
    title: columnTitle,
    position: 0,
    kind: null,
    created_at: '2026-08-26T00:00:00.000Z',
    updated_at: '2026-08-26T00:00:00.000Z',
  });
  const currentWorkItem = () => ({
    id: newWorkItemId,
    workspace_id: '00000000-0000-4000-8000-000000000205',
    title: card?.title ?? 'Unexpected task',
    description: card?.description ?? null,
    status: 'todo',
    assignee_id: null,
    mentions: [],
    created_by: 'principal-1',
    source_conversation_id: null,
    source_message_id: null,
    linked_work_id: null,
    created_at: '2026-08-26T00:00:00.000Z',
    updated_at: '2026-08-26T00:00:00.000Z',
  });
  const currentSnapshot = () => ({
    board: currentBoard(),
    columns: columnCreated && !columnDeleted ? [currentColumn()] : [],
    placements:
      card && columnCreated && !columnDeleted
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
    work_items:
      card && columnCreated && !columnDeleted ? [currentWorkItem()] : [],
  });
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    const method = init?.method ?? 'GET';
    const body =
      typeof init?.body === 'string'
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : null;
    requests.push({ method, path, body });
    if (path === '/api/agents') return json({ items: [] });
    if (failRequest?.method === method && failRequest.path === path)
      return json({ error: { code: 'request_failed' } }, 500);
    if (path === '/api/boards' && method === 'GET')
      return json({
        boards: boardCreated && !boardDeleted ? [currentBoard()] : [],
      });
    if (path === '/api/boards' && method === 'POST') {
      boardCreated = true;
      boardDeleted = false;
      boardTitle = String(body?.title ?? '');
      return json({ board: currentBoard() });
    }
    if (path === `/api/boards/${boardId}` && method === 'GET')
      return json(currentSnapshot());
    if (path === `/api/boards/${boardId}` && method === 'PATCH') {
      boardTitle = String(body?.title ?? boardTitle);
      return json({ board: currentBoard() });
    }
    if (path === `/api/boards/${boardId}` && method === 'DELETE') {
      deleteBoardRequests += 1;
      boardDeleted = true;
      return new Response(null, { status: 204 });
    }
    if (path === `/api/boards/${boardId}/columns` && method === 'POST') {
      columnCreated = true;
      columnDeleted = false;
      columnTitle = String(body?.title ?? '');
      return json({ column: currentColumn() });
    }
    if (
      path === `/api/boards/${boardId}/columns/${columnId}` &&
      method === 'PATCH'
    ) {
      columnTitle = String(body?.title ?? columnTitle);
      return json({ column: currentColumn() });
    }
    if (
      path === `/api/boards/${boardId}/columns/${columnId}` &&
      method === 'DELETE'
    ) {
      deleteColumnRequests += 1;
      columnDeleted = true;
      return new Response(null, { status: 204 });
    }
    if (path === '/api/work-items' && method === 'POST') {
      card = {
        title: String(body?.title ?? ''),
        description:
          typeof body?.description === 'string' ? body.description : null,
      };
      return json({ work_item: currentWorkItem(), linked_work: null });
    }
    throw new Error(`Unexpected browser request: ${method} ${path}`);
  });

  return {
    fetch,
    requests,
    get deleteColumnRequests() {
      return deleteColumnRequests;
    },
    get deleteBoardRequests() {
      return deleteBoardRequests;
    },
  };
}

async function mountRoutedBoards(fetch: typeof globalThis.fetch) {
  vi.stubGlobal('fetch', fetch);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/boards']}>
        <Routes>
          <Route path="/boards" element={<BoardsPage />} />
          <Route path="/boards/:boardId" element={<SelectedBoardsPage />} />
        </Routes>
      </MemoryRouter>,
    );
  });
  await act(settle);
  await act(settle);
  return {
    host,
    dispose: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

function SelectedBoardsPage() {
  const { boardId: selectedBoardId } = useParams();
  return <BoardsPage selectedBoardId={selectedBoardId ?? null} />;
}

async function clickButton(host: HTMLElement, name: string) {
  const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) =>
      candidate.textContent === name ||
      candidate.getAttribute('aria-label') === name,
  );
  if (!button) throw new Error(`Expected a "${name}" button.`);
  await act(async () => {
    button.click();
    await settle();
  });
}

async function clickAuthoringButton(host: HTMLElement, name: string) {
  const button = host
    .querySelector('.work-board-authoring')
    ?.querySelector<HTMLButtonElement>('button.work-org-primary');
  if (!button || button.textContent !== name)
    throw new Error(`Expected the authoring form to offer "${name}".`);
  await act(async () => {
    button.click();
    await settle();
  });
}

async function clickToolbarButton(host: HTMLElement, name: string) {
  const button = host
    .querySelector('.work-board-toolbar')
    ?.querySelectorAll<HTMLButtonElement>('button');
  const matching =
    button && [...button].find((candidate) => candidate.textContent === name);
  if (!matching)
    throw new Error(`Expected the Board toolbar to offer "${name}".`);
  await act(async () => {
    matching.click();
    await settle();
  });
}

async function setInputValueByLabel(
  host: HTMLElement,
  labelText: string,
  value: string,
) {
  const label = [...host.querySelectorAll('label')].find((candidate) =>
    candidate.textContent?.includes(labelText),
  );
  const input = label?.querySelector<HTMLInputElement>('input');
  if (!input) throw new Error(`Expected a "${labelText}" input.`);
  await act(async () => {
    setInputValue(input, value);
    await settle();
  });
}

async function setInputValueByPlaceholder(
  host: HTMLElement,
  placeholder: string,
  value: string,
) {
  const input = host.querySelector<HTMLInputElement>(
    `input[placeholder="${placeholder}"]`,
  );
  if (!input) throw new Error(`Expected a "${placeholder}" input.`);
  await act(async () => {
    setInputValue(input, value);
    await settle();
  });
}

async function setInputValueByAriaLabel(
  host: HTMLElement,
  label: string,
  value: string,
) {
  const input = host.querySelector<HTMLInputElement>(
    `input[aria-label="${label}"]`,
  );
  if (!input) throw new Error(`Expected a "${label}" input.`);
  await act(async () => {
    setInputValue(input, value);
    await settle();
  });
}

async function setTextareaValueByLabel(
  host: HTMLElement,
  labelText: string,
  value: string,
) {
  const label = [...host.querySelectorAll('label')].find((candidate) =>
    candidate.textContent?.includes(labelText),
  );
  const textarea = label?.querySelector<HTMLTextAreaElement>('textarea');
  if (!textarea) throw new Error(`Expected a "${labelText}" textarea.`);
  await act(async () => {
    setTextareaValue(textarea, value);
    await settle();
  });
}

async function expectText(host: HTMLElement, text: string) {
  await act(settle);
  expect(host.textContent).toContain(text);
}

async function expectAbsent(host: HTMLElement, text: string) {
  await act(settle);
  expect(host.textContent).not.toContain(text);
}

async function expectAlert(host: HTMLElement) {
  await act(settle);
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    '这次看板改动没能保存，请重试。',
  );
}

async function expectAuthoringAbsent(host: HTMLElement) {
  await act(settle);
  expect(host.querySelector('.work-board-authoring')).toBeNull();
}

async function expectAuthoringSubmitDisabled(
  host: HTMLElement,
  disabled: boolean,
) {
  await act(settle);
  expect(
    host
      .querySelector('.work-board-authoring')
      ?.querySelector<HTMLButtonElement>('button.work-org-primary')?.disabled,
  ).toBe(disabled);
}

async function expectVisibleValue(host: HTMLElement, value: string) {
  await act(settle);
  if (host.textContent?.includes(value)) return;
  const controls = [
    ...host.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      'input, textarea',
    ),
  ];
  expect(controls.some((control) => control.value === value)).toBe(true);
}

function expectNoNativeDialogs() {
  expect(nativeDialogSpies.prompt.mock.calls).toHaveLength(0);
  expect(nativeDialogSpies.confirm.mock.calls).toHaveLength(0);
  expect(nativeDialogSpies.alert.mock.calls).toHaveLength(0);
}
