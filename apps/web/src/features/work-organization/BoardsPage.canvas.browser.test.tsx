import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';

import { BoardsPage } from './BoardsPage';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const boardId = '00000000-0000-4000-8000-000000000301';
const todoColumnId = '00000000-0000-4000-8000-000000000302';
const doingColumnId = '00000000-0000-4000-8000-000000000303';
const cardOneId = '00000000-0000-4000-8000-000000000311';
const cardTwoId = '00000000-0000-4000-8000-000000000312';
const cardThreeId = '00000000-0000-4000-8000-000000000313';
const cardNewId = '00000000-0000-4000-8000-000000000314';
const timestamp = '2026-08-26T00:00:00.000Z';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('drags a card into another column and writes the position the drop landed on', async () => {
  const api = createCanvasApi();
  const mounted = await mountBoard(api.fetch);
  try {
    dragCardTo(mounted.host, cardOneId, doingColumnId, 0);
    await act(settle);

    expect(api.placements).toEqual([
      { column_id: doingColumnId, work_item_id: cardOneId, position: 1000 },
    ]);
    expect(cardTitlesIn(mounted.host, doingColumnId)).toEqual([
      'Draft the brief',
    ]);
    expect(cardTitlesIn(mounted.host, todoColumnId)).toEqual([
      'Collect the numbers',
      'Review the deck',
    ]);
  } finally {
    await mounted.dispose();
  }
});

it('interpolates a position between the two cards a drop landed between', async () => {
  const api = createCanvasApi();
  const mounted = await mountBoard(api.fetch);
  try {
    // Between 'Draft the brief' (1000) and 'Collect the numbers' (2000).
    dragCardTo(mounted.host, cardThreeId, todoColumnId, 1);
    await act(settle);

    expect(api.placements).toEqual([
      { column_id: todoColumnId, work_item_id: cardThreeId, position: 1500 },
    ]);
    expect(cardTitlesIn(mounted.host, todoColumnId)).toEqual([
      'Draft the brief',
      'Review the deck',
      'Collect the numbers',
    ]);
  } finally {
    await mounted.dispose();
  }
});

it('shows a card where it was dropped before the server has answered', async () => {
  const api = createCanvasApi({ holdPlacement: true });
  const mounted = await mountBoard(api.fetch);
  try {
    dragCardTo(mounted.host, cardOneId, doingColumnId, 0);
    await act(settle);

    // The placement write is still in flight; the canvas already reads the way
    // the reader left it.
    expect(api.pendingPlacements).toBe(1);
    expect(cardTitlesIn(mounted.host, doingColumnId)).toEqual([
      'Draft the brief',
    ]);
  } finally {
    await mounted.dispose();
  }
});

it('puts a card back where the Board says it is when the move is rejected', async () => {
  const api = createCanvasApi({ failPlacement: true });
  const mounted = await mountBoard(api.fetch);
  try {
    dragCardTo(mounted.host, cardOneId, doingColumnId, 0);
    await act(settle);

    expect(mounted.host.querySelector('[role="alert"]')?.textContent).toContain(
      '这次看板改动没能保存，请重试。',
    );
    expect(cardTitlesIn(mounted.host, doingColumnId)).toEqual([]);
    expect(cardTitlesIn(mounted.host, todoColumnId)).toEqual([
      'Draft the brief',
      'Collect the numbers',
      'Review the deck',
    ]);
  } finally {
    await mounted.dispose();
  }
});

it('reorders columns by dragging a column handle', async () => {
  const api = createCanvasApi();
  const mounted = await mountBoard(api.fetch);
  try {
    expect(columnTitles(mounted.host)).toEqual(['Todo', 'In Progress']);
    dragColumnOnto(mounted.host, doingColumnId, todoColumnId);
    await act(settle);

    expect(api.columnPositions).toEqual([
      { column_id: todoColumnId, position: 1 },
      { column_id: doingColumnId, position: 0 },
    ]);
    expect(columnTitles(mounted.host)).toEqual(['In Progress', 'Todo']);
  } finally {
    await mounted.dispose();
  }
});

it('claims a card from its detail panel and moves it into the doing column', async () => {
  const api = createCanvasApi();
  const mounted = await mountBoard(api.fetch);
  try {
    await openPeek(mounted.host, cardOneId);
    expect(mounted.host.textContent).toContain('Draft the brief');

    await clickTestId(mounted.host, 'work-board-claim');

    expect(api.claims).toEqual([cardOneId]);
    expect(api.placements).toEqual([
      { column_id: doingColumnId, work_item_id: cardOneId, position: 1000 },
    ]);
    expect(cardTitlesIn(mounted.host, doingColumnId)).toEqual([
      'Draft the brief',
    ]);
  } finally {
    await mounted.dispose();
  }
});

it('says a claim is held rather than offering one that cannot succeed', async () => {
  const api = createCanvasApi();
  const mounted = await mountBoard(api.fetch);
  try {
    await openPeek(mounted.host, cardTwoId);
    expect(
      mounted.host.querySelector('[data-testid="work-board-claim-blocked"]')
        ?.textContent,
    ).toBe('这个任务已被 coworker-1 领取。');
    expect(
      mounted.host.querySelector('[data-testid="work-board-claim"]'),
    ).toBeNull();
  } finally {
    await mounted.dispose();
  }
});

it('stops offering a claim once the deployment answers that it has no claim route', async () => {
  const api = createCanvasApi({ claimRouteMissing: true });
  const mounted = await mountBoard(api.fetch);
  try {
    await openPeek(mounted.host, cardOneId);
    await clickTestId(mounted.host, 'work-board-claim');

    expect(mounted.host.textContent).toContain('当前部署还没有开启任务领取。');
    expect(api.placements).toEqual([]);

    await clickButton(mounted.host, '关闭卡片详情');
    await openPeek(mounted.host, cardOneId);
    expect(
      mounted.host.querySelector('[data-testid="work-board-claim"]'),
    ).toBeNull();
  } finally {
    await mounted.dispose();
  }
});

it('completes an @ mention in the Board card form and posts the participant id', async () => {
  const api = createCanvasApi();
  const mounted = await mountBoard(api.fetch);
  try {
    await clickButton(mounted.host, '+ 新建任务');
    const title = inputByLabel(mounted.host, '任务标题');
    await typeInto(title, 'ask @ari');

    const suggestions = mounted.host.querySelector(
      '[data-testid="mention-suggestions"]',
    );
    expect(suggestions?.textContent).toContain('Ari Analyst');

    const option = suggestions?.querySelector<HTMLButtonElement>(
      'button[role="option"]',
    );
    if (!option) throw new Error('Expected a mention option.');
    await act(async () => {
      option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      await settle();
    });

    expect(title.value).toBe('ask @coworker-1 ');
    expect(
      mounted.host.querySelector('[data-testid="mention-suggestions"]'),
    ).toBeNull();

    await clickButton(mounted.host, '添加任务');
    expect(api.createdWorkItems).toEqual([
      { title: 'ask @coworker-1', column_id: todoColumnId },
    ]);
  } finally {
    await mounted.dispose();
  }
});

it('offers no mention list until an @ is typed', async () => {
  const api = createCanvasApi();
  const mounted = await mountBoard(api.fetch);
  try {
    await clickButton(mounted.host, '+ 新建任务');
    const title = inputByLabel(mounted.host, '任务标题');
    await typeInto(title, 'plain title');
    expect(
      mounted.host.querySelector('[data-testid="mention-suggestions"]'),
    ).toBeNull();
  } finally {
    await mounted.dispose();
  }
});

function createCanvasApi({
  failPlacement = false,
  holdPlacement = false,
  claimRouteMissing = false,
}: {
  readonly failPlacement?: boolean;
  readonly holdPlacement?: boolean;
  readonly claimRouteMissing?: boolean;
} = {}) {
  const columns = [
    { id: todoColumnId, title: 'Todo', position: 0 },
    { id: doingColumnId, title: 'In Progress', position: 1 },
  ];
  const items = [
    {
      id: cardOneId,
      title: 'Draft the brief',
      columnId: todoColumnId,
      position: 1000,
      assignee_id: null as string | null,
    },
    {
      id: cardTwoId,
      title: 'Collect the numbers',
      columnId: todoColumnId,
      position: 2000,
      assignee_id: 'coworker-1' as string | null,
    },
    {
      id: cardThreeId,
      title: 'Review the deck',
      columnId: todoColumnId,
      position: 3000,
      assignee_id: null as string | null,
    },
  ];
  const placements: Array<Record<string, unknown>> = [];
  const columnPositions: Array<Record<string, unknown>> = [];
  const createdWorkItems: Array<Record<string, unknown>> = [];
  const claims: string[] = [];
  let pendingPlacements = 0;

  const workItem = (entry: (typeof items)[number]) => ({
    id: entry.id,
    workspace_id: '00000000-0000-4000-8000-000000000305',
    title: entry.title,
    description: null,
    status: 'todo',
    assignee_id: entry.assignee_id,
    created_by: 'principal-1',
    source_conversation_id: null,
    source_message_id: null,
    linked_work_id: null,
    created_at: timestamp,
    updated_at: timestamp,
  });
  const snapshot = () => ({
    board: {
      id: boardId,
      workspace_id: '00000000-0000-4000-8000-000000000305',
      title: 'Launch board',
      description: null,
      created_by: 'principal-1',
      created_at: timestamp,
      updated_at: timestamp,
    },
    columns: columns.map((column) => ({
      id: column.id,
      board_id: boardId,
      title: column.title,
      position: column.position,
      created_at: timestamp,
      updated_at: timestamp,
    })),
    placements: items.map((entry) => ({
      board_id: boardId,
      column_id: entry.columnId,
      work_item_id: entry.id,
      position: entry.position,
      created_at: timestamp,
      updated_at: timestamp,
    })),
    work_items: items.map(workItem),
  });

  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    const method = init?.method ?? 'GET';
    const body =
      typeof init?.body === 'string'
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : null;
    if (path === '/api/agents')
      return json({
        items: [
          {
            id: 'coworker-1',
            display_name: 'Ari Analyst',
            role_label: 'Analyst',
            summary: null,
            active_agent_version_id: 'coworker-1-v1',
            runtime_status: 'available',
          },
        ],
      });
    if (path === '/api/boards' && method === 'GET')
      return json({ boards: [snapshot().board] });
    if (path === `/api/boards/${boardId}` && method === 'GET')
      return json(snapshot());
    if (path === `/api/boards/${boardId}/placement` && method === 'PUT') {
      if (failPlacement)
        return json({ error: { code: 'request_failed' } }, 500);
      if (holdPlacement) {
        pendingPlacements += 1;
        return new Promise<Response>(() => {});
      }
      placements.push({
        column_id: body?.column_id,
        work_item_id: body?.work_item_id,
        position: body?.position,
      });
      const moved = items.find((entry) => entry.id === body?.work_item_id);
      if (moved) {
        moved.columnId = String(body?.column_id);
        moved.position = Number(body?.position);
      }
      return json({
        placement: {
          board_id: boardId,
          column_id: String(body?.column_id),
          work_item_id: String(body?.work_item_id),
          position: Number(body?.position ?? 0),
          created_at: timestamp,
          updated_at: timestamp,
        },
      });
    }
    const columnMatch = /^\/api\/boards\/[^/]+\/columns\/([^/]+)$/u.exec(path);
    if (columnMatch && method === 'PATCH') {
      const column = columns.find((entry) => entry.id === columnMatch[1]);
      columnPositions.push({
        column_id: columnMatch[1],
        position: body?.position,
      });
      if (column && typeof body?.position === 'number')
        column.position = body.position;
      return json({
        column: {
          id: columnMatch[1],
          board_id: boardId,
          title: column?.title ?? 'Unknown',
          position: column?.position ?? 0,
          created_at: timestamp,
          updated_at: timestamp,
        },
      });
    }
    const detailMatch = /^\/api\/work-items\/([^/]+)$/u.exec(path);
    if (detailMatch && method === 'GET') {
      const entry = items.find((candidate) => candidate.id === detailMatch[1]);
      if (!entry) return json({ error: { code: 'work_item_not_found' } }, 404);
      return json({ work_item: workItem(entry), linked_work: null });
    }
    const commentsMatch = /^\/api\/work-items\/([^/]+)\/comments$/u.exec(path);
    if (commentsMatch && method === 'GET') return json({ comments: [] });
    const claimMatch = /^\/api\/work-items\/([^/]+)\/claim$/u.exec(path);
    if (claimMatch && method === 'POST') {
      if (claimRouteMissing) return json({ error: { code: 'not_found' } }, 404);
      claims.push(String(claimMatch[1]));
      const entry = items.find((candidate) => candidate.id === claimMatch[1]);
      if (entry) entry.assignee_id = 'principal-1';
      return json({
        work_item: entry ? workItem(entry) : null,
        linked_work: null,
      });
    }
    if (path === '/api/work-items' && method === 'POST') {
      createdWorkItems.push({
        title: body?.title,
        column_id: body?.column_id,
      });
      const created = {
        id: cardNewId,
        title: String(body?.title ?? ''),
        columnId: String(body?.column_id ?? todoColumnId),
        position: 4000,
        assignee_id: null as string | null,
      };
      items.push(created);
      return json({ work_item: workItem(created), linked_work: null });
    }
    throw new Error(`Unexpected browser request: ${method} ${path}`);
  });

  return {
    fetch,
    placements,
    columnPositions,
    createdWorkItems,
    claims,
    get pendingPlacements() {
      return pendingPlacements;
    },
  };
}

async function mountBoard(fetch: typeof globalThis.fetch) {
  vi.stubGlobal('fetch', fetch);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[`/boards/${boardId}`]}>
        <Routes>
          <Route
            path="/boards/:boardId"
            element={<BoardsPage selectedBoardId={boardId} />}
          />
          <Route path="/tasks/:workItemId" element={<p>Task detail page</p>} />
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

function columnOf(host: HTMLElement, columnId: string): HTMLElement {
  const handle = host.querySelector(
    `[data-testid="work-board-column-handle"][data-column-id="${columnId}"]`,
  );
  const column = handle?.closest<HTMLElement>('.work-board-column');
  if (!column) throw new Error(`Expected a column ${columnId}.`);
  return column;
}

function columnTitles(host: HTMLElement): string[] {
  return [...host.querySelectorAll('.work-board-column-header h2')].map(
    (heading) => heading.textContent?.split(' · ')[0] ?? '',
  );
}

function cardTitlesIn(host: HTMLElement, columnId: string): string[] {
  return [
    ...columnOf(host, columnId).querySelectorAll(
      '[data-testid="work-board-card"] strong',
    ),
  ].map((title) => title.textContent ?? '');
}

function cardOf(host: HTMLElement, workItemId: string): HTMLElement {
  const card = host.querySelector<HTMLElement>(
    `[data-testid="work-board-card"][data-work-item-id="${workItemId}"]`,
  );
  if (!card) throw new Error(`Expected a card for ${workItemId}.`);
  return card;
}

/** The drag a pointer performs: dragstart on the card, drop on a gap. */
function dragCardTo(
  host: HTMLElement,
  workItemId: string,
  columnId: string,
  index: number,
): void {
  const transfer = new DataTransfer();
  cardOf(host, workItemId).dispatchEvent(
    new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }),
  );
  const zone = columnOf(host, columnId).querySelector<HTMLElement>(
    `[data-testid="work-board-dropzone"][data-drop-index="${index}"]`,
  );
  if (!zone) throw new Error(`Expected drop index ${index} in ${columnId}.`);
  zone.dispatchEvent(
    new DragEvent('dragover', { bubbles: true, dataTransfer: transfer }),
  );
  zone.dispatchEvent(
    new DragEvent('drop', { bubbles: true, dataTransfer: transfer }),
  );
}

function dragColumnOnto(
  host: HTMLElement,
  columnId: string,
  targetColumnId: string,
): void {
  const transfer = new DataTransfer();
  const handle = host.querySelector<HTMLElement>(
    `[data-testid="work-board-column-handle"][data-column-id="${columnId}"]`,
  );
  if (!handle) throw new Error(`Expected a handle for ${columnId}.`);
  handle.dispatchEvent(
    new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }),
  );
  const target = columnOf(host, targetColumnId);
  target.dispatchEvent(
    new DragEvent('dragover', { bubbles: true, dataTransfer: transfer }),
  );
  target.dispatchEvent(
    new DragEvent('drop', { bubbles: true, dataTransfer: transfer }),
  );
}

async function openPeek(host: HTMLElement, workItemId: string): Promise<void> {
  const card = cardOf(host, workItemId);
  const detail = [...card.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent === '卡片详情',
  );
  if (!detail) throw new Error('Expected a 卡片详情 button.');
  await act(async () => {
    detail.click();
    await settle();
  });
  // The panel reads the card and its comments before it can offer anything.
  await act(settle);
  await act(settle);
}

async function clickTestId(host: HTMLElement, testId: string): Promise<void> {
  const button = host.querySelector<HTMLButtonElement>(
    `[data-testid="${testId}"]`,
  );
  if (!button) throw new Error(`Expected a "${testId}" control.`);
  await act(async () => {
    button.click();
    await settle();
  });
}

async function clickButton(host: HTMLElement, name: string): Promise<void> {
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

function inputByLabel(host: HTMLElement, labelText: string): HTMLInputElement {
  const label = [...host.querySelectorAll('label')].find((candidate) =>
    candidate.textContent?.includes(labelText),
  );
  const input = label?.querySelector<HTMLInputElement>('input');
  if (!input) throw new Error(`Expected a "${labelText}" input.`);
  return input;
}

/** Types character by character so the mention reader sees a moving caret. */
async function typeInto(input: HTMLInputElement, text: string): Promise<void> {
  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  );
  for (const character of text) {
    await act(async () => {
      descriptor?.set?.call(input, `${input.value}${character}`);
      input.setSelectionRange(input.value.length, input.value.length);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await settle();
    });
  }
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
