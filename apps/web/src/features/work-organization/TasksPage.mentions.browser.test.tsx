import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';

import { TasksPage } from './TasksPage';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const workItemId = '00000000-0000-4000-8000-000000000401';
const timestamp = '2026-08-26T00:00:00.000Z';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('completes an @ mention on the Task form with the keyboard and posts the participant id', async () => {
  const api = createTasksApi();
  const mounted = await mountTasks(api.fetch);
  try {
    await clickButton(mounted.host, '+ 新建任务');
    const title = controlByLabel<HTMLInputElement>(
      mounted.host,
      '标题',
      'input',
    );
    await typeInto(title, 'ping @ari');

    const suggestions = mounted.host.querySelector(
      '[data-testid="mention-suggestions"]',
    );
    expect(suggestions?.getAttribute('role')).toBe('listbox');
    expect(suggestions?.textContent).toContain('Ari Analyst');
    expect(title.getAttribute('aria-expanded')).toBe('true');

    await press(title, 'Enter');
    expect(title.value).toBe('ping @coworker-1 ');
    expect(
      mounted.host.querySelector('[data-testid="mention-suggestions"]'),
    ).toBeNull();

    await clickButton(mounted.host, '创建任务');
    expect(api.createdTitles).toEqual(['ping @coworker-1']);
  } finally {
    await mounted.dispose();
  }
});

it('offers the Coworker roster from the description field too, and gives up on Escape', async () => {
  const api = createTasksApi();
  const mounted = await mountTasks(api.fetch);
  try {
    await clickButton(mounted.host, '+ 新建任务');
    const description = controlByLabel<HTMLTextAreaElement>(
      mounted.host,
      '描述',
      'textarea',
    );
    await typeInto(description, 'handing to @a');
    expect(
      mounted.host.querySelector('[data-testid="mention-suggestions"]'),
    ).not.toBeNull();

    await press(description, 'Escape');
    expect(
      mounted.host.querySelector('[data-testid="mention-suggestions"]'),
    ).toBeNull();
    // Escape dismissed the list without touching what was written.
    expect(description.value).toBe('handing to @a');
  } finally {
    await mounted.dispose();
  }
});

it('completes an @ mention in a comment and renders the posted mention as a chip', async () => {
  const api = createTasksApi();
  const mounted = await mountTasks(api.fetch, workItemId);
  try {
    const comment = mounted.host.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="添加评论"]',
    );
    if (!comment) throw new Error('Expected a comment box.');
    await typeInto(comment, '@ari');

    const option = mounted.host.querySelector<HTMLButtonElement>(
      '[data-testid="mention-suggestions"] button[role="option"]',
    );
    if (!option) throw new Error('Expected a mention option.');
    await act(async () => {
      option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      await settle();
    });
    expect(comment.value).toBe('@coworker-1 ');

    await clickButton(mounted.host, '评论');
    expect(api.commentBodies).toEqual(['@coworker-1']);

    const chip = mounted.host.querySelector('[data-testid="work-org-mention"]');
    // The stored token is an id; the chip shows the name it resolves to.
    expect(chip?.getAttribute('data-participant-id')).toBe('coworker-1');
    expect(chip?.textContent).toBe('@Ari Analyst');
  } finally {
    await mounted.dispose();
  }
});

function createTasksApi() {
  const createdTitles: string[] = [];
  const commentBodies: string[] = [];
  const comments: Array<Record<string, unknown>> = [];

  const workItem = (title: string, id = workItemId) => ({
    id,
    workspace_id: '00000000-0000-4000-8000-000000000405',
    title,
    description: null,
    status: 'todo',
    assignee_id: null,
    created_by: 'principal-1',
    source_conversation_id: null,
    source_message_id: null,
    linked_work_id: null,
    created_at: timestamp,
    updated_at: timestamp,
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
    if (path === '/api/work-items' && method === 'GET')
      return json({
        work_items: [
          { work_item: workItem('Prepare brief'), linked_work: null },
        ],
      });
    if (path === '/api/work-items' && method === 'POST') {
      createdTitles.push(String(body?.title ?? ''));
      return json({
        work_item: workItem(
          String(body?.title ?? ''),
          '00000000-0000-4000-8000-000000000402',
        ),
        linked_work: null,
      });
    }
    if (path === '/api/work-definitions')
      return json({ error: { code: 'feature_unavailable' } }, 503);
    if (path === `/api/work-items/${workItemId}/comments` && method === 'GET')
      return json({ comments });
    if (
      path === `/api/work-items/${workItemId}/comments` &&
      method === 'POST'
    ) {
      commentBodies.push(String(body?.body ?? ''));
      const comment = {
        id: '00000000-0000-4000-8000-000000000403',
        work_item_id: workItemId,
        author_id: 'principal-1',
        body: String(body?.body ?? ''),
        created_at: timestamp,
      };
      comments.push(comment);
      return json({ comment });
    }
    if (path === `/api/work-items/${workItemId}` && method === 'GET')
      return json({ work_item: workItem('Prepare brief'), linked_work: null });
    throw new Error(`Unexpected browser request: ${method} ${path}`);
  });

  return { fetch, createdTitles, commentBodies };
}

async function mountTasks(
  fetch: typeof globalThis.fetch,
  selectedWorkItemId: string | null = null,
) {
  vi.stubGlobal('fetch', fetch);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <MemoryRouter
        initialEntries={[
          selectedWorkItemId ? `/tasks/${selectedWorkItemId}` : '/tasks',
        ]}
      >
        <TasksPage selectedWorkItemId={selectedWorkItemId} />
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

function controlByLabel<T extends HTMLElement>(
  host: HTMLElement,
  labelText: string,
  tag: 'input' | 'textarea',
): T {
  const label = [...host.querySelectorAll('label')].find(
    (candidate) => candidate.firstChild?.textContent === labelText,
  );
  const control = label?.querySelector<T>(tag);
  if (!control) throw new Error(`Expected a "${labelText}" ${tag}.`);
  return control;
}

/** Types character by character so the mention reader sees a moving caret. */
async function typeInto(
  control: HTMLInputElement | HTMLTextAreaElement,
  text: string,
): Promise<void> {
  const descriptor = Object.getOwnPropertyDescriptor(
    control instanceof HTMLInputElement
      ? HTMLInputElement.prototype
      : HTMLTextAreaElement.prototype,
    'value',
  );
  for (const character of text) {
    await act(async () => {
      descriptor?.set?.call(control, `${control.value}${character}`);
      control.setSelectionRange(control.value.length, control.value.length);
      control.dispatchEvent(new Event('input', { bubbles: true }));
      await settle();
    });
  }
}

async function press(control: HTMLElement, key: string): Promise<void> {
  await act(async () => {
    control.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    await settle();
  });
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
