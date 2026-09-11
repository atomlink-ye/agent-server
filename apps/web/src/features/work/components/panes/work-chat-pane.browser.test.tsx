import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import type {
  WorkChatMessageResponse,
  WorkChatMessagesResponse,
} from '@atomlink-ye/agent-server/product-contract';

import '../../../../index.css';
import '../work-detail.css';
import { workClient } from '../../clients/work-client';
import { WorkChatPane } from './work-chat-pane';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const workId = '00000000-0000-4000-8000-000000000100';

function message(index: number, role?: WorkChatMessageResponse['role']) {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    sequence: index,
    role: role ?? (index % 3 === 0 ? 'system' : index % 2 ? 'lead' : 'user'),
    body: `Conversation message ${index}. This has enough detail to establish a comfortable readable measure.`,
    status: 'replied' as const,
    reply_to_message_id: null,
    failure_code: null,
    created_at: `2026-09-10T10:${String(index % 60).padStart(2, '0')}:00.000Z`,
  } satisfies WorkChatMessageResponse;
}

function response(
  messages: readonly WorkChatMessageResponse[],
): WorkChatMessagesResponse {
  return { work_id: workId, messages: [...messages], preparation: null };
}

let root: Root | null = null;

async function renderChat(messages: readonly WorkChatMessageResponse[]) {
  vi.spyOn(workClient, 'chat').mockResolvedValue(response(messages));
  const host = document.createElement('div');
  host.style.cssText =
    'height: 900px; width: 100%; padding: 70px 180px; box-sizing: border-box;';
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<WorkChatPane workId={workId} />);
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  return {
    host,
    history: host.querySelector<HTMLElement>('.work-chat-history')!,
  };
}

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

it('keeps one overflowing history between a pinned heading and composer', async () => {
  const { host, history } = await renderChat(
    Array.from({ length: 36 }, (_, index) => message(index + 1)),
  );
  const pane = host.querySelector<HTMLElement>('.work-chat-pane')!;
  const kicker = host.querySelector<HTMLElement>(
    '.work-chat-pane > .work-shell-kicker',
  )!;
  const composer = host.querySelector<HTMLElement>('.work-chat-composer')!;

  expect(history.scrollHeight).toBeGreaterThan(history.clientHeight);
  expect(getComputedStyle(history).overflowY).toBe('auto');
  expect(pane.scrollHeight).toBeLessThanOrEqual(pane.clientHeight + 1);
  expect(kicker.getBoundingClientRect().top).toBeGreaterThanOrEqual(
    pane.getBoundingClientRect().top,
  );
  expect(composer.getBoundingClientRect().bottom).toBeLessThanOrEqual(
    pane.getBoundingClientRect().bottom + 1,
  );
  expect(history.scrollTop).toBeGreaterThan(0);

  await page.screenshot({
    path: '../../../../../__screenshots__/ux-review/long-conversation.png',
  });
});

it('auto-scrolls on arrival only while the reader is near the bottom', async () => {
  const initial = Array.from({ length: 32 }, (_, index) => message(index + 1));
  const chat = vi
    .spyOn(workClient, 'chat')
    .mockResolvedValue(response(initial));
  const host = document.createElement('div');
  host.style.cssText =
    'height: 900px; width: 100%; padding: 70px 180px; box-sizing: border-box;';
  document.body.append(host);
  const mountedRoot = createRoot(host);
  root = mountedRoot;
  await act(async () => {
    mountedRoot.render(<WorkChatPane workId={workId} />);
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  const history = host.querySelector<HTMLElement>('.work-chat-history')!;
  const atBottom = () =>
    history.scrollHeight - history.clientHeight - history.scrollTop;
  expect(atBottom()).toBeLessThanOrEqual(2);

  // The server retains new messages across every subsequent poll.
  chat.mockResolvedValue(response([...initial, message(33, 'lead')]));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 1_050)));
  expect(history.textContent).toContain('Conversation message 33');
  expect(atBottom()).toBeLessThanOrEqual(2);

  history.scrollTop = 0;
  history.dispatchEvent(new Event('scroll'));
  const readerPosition = history.scrollTop;
  chat.mockResolvedValue(
    response([...initial, message(33, 'lead'), message(34, 'user')]),
  );
  await act(async () => new Promise((resolve) => setTimeout(resolve, 1_050)));
  expect(history.textContent).toContain('Conversation message 34');
  expect(history.scrollTop).toBe(readerPosition);
  expect(history.scrollHeight - history.clientHeight).toBeGreaterThan(80);
  // A further poll must preserve both the arrived message and reader position.
  await act(async () => new Promise((resolve) => setTimeout(resolve, 1100)));
  expect(history.textContent).toContain('Conversation message 34');
  expect(history.scrollTop).toBe(readerPosition);
});

it('captures the empty and short conversational states', async () => {
  const { host } = await renderChat([]);
  await page.screenshot({
    path: '../../../../../__screenshots__/ux-review/empty-state.png',
  });

  vi.mocked(workClient.chat).mockResolvedValue(
    response([message(1, 'user'), message(2, 'lead'), message(3, 'system')]),
  );
  await act(async () => new Promise((resolve) => setTimeout(resolve, 1_050)));
  expect(host.querySelectorAll('.work-chat-message')).toHaveLength(3);
  await page.screenshot({
    path: '../../../../../__screenshots__/ux-review/short-conversation.png',
  });
});

it('shows a single loading action and plain startup guidance', async () => {
  const { host } = await renderChat([]);
  vi.mocked(workClient.chat).mockResolvedValue({
    ...response([]),
    preparation: {
      id: workId,
      work_id: workId,
      revision: 1,
      status: 'starting',
      definition_version_id: workId,
      schema_fingerprint: 'test',
      candidate_input: {},
      confirmed_fingerprint: 'test',
      start_intent: 'test',
      work_run_id: null,
      missing: [],
      ambiguities: [],
      created_at: '2026-09-10T00:00:00.000Z',
      updated_at: '2026-09-10T00:00:00.000Z',
    },
  });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 1100)));
  const status = host.querySelector('[role="status"]');
  expect(status?.textContent).toContain('Preparing your WorkRun');
  const button = host.querySelector<HTMLButtonElement>(
    '.work-preparation-card button',
  );
  expect(button?.disabled).toBe(true);
  expect(button?.getAttribute('aria-busy')).toBe('true');
  expect(host.textContent).not.toContain('Status: starting');
});

it('loads the selected Run conversation instead of preparation', async () => {
  const { host } = await renderChat([]);
  const runId = '00000000-0000-4000-8000-000000000200';
  await act(async () => {
    root!.render(<WorkChatPane workId={workId} workRunId={runId} />);
  });
  expect(workClient.chat).toHaveBeenLastCalledWith(workId, runId);
  expect(host.textContent).toContain(
    'WorkRun conversation · cannot change execution',
  );
  expect(host.textContent).toContain(
    'cannot access execution history, steer, resume, or change this WorkRun',
  );
  expect(host.textContent).not.toContain('Definition lead');
  expect(host.querySelector('.work-chat-pane')?.textContent).not.toContain(
    'Lead',
  );
  expect(host.querySelector('.send-button')?.getAttribute('aria-label')).toBe(
    'Send to assistant',
  );
});
