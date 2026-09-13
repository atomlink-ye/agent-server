import { commands, page } from 'vitest/browser';
import { setLocale } from '@/i18n';
import { copyRegressions } from '@/test-support/copy-regressions';
import {
  findCopy,
  measureCopy,
  measureControlCopy,
} from '@/test-support/copy-measurement';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
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

it('clears a transient load failure after polling recovers', async () => {
  const chat = vi
    .spyOn(workClient, 'chat')
    .mockRejectedValueOnce(new Error('temporary'))
    .mockResolvedValue(response([message(1, 'lead')]));
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<WorkChatPane workId={workId} />);
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    'Unable to load',
  );

  await act(async () => new Promise((resolve) => setTimeout(resolve, 1_050)));
  expect(chat).toHaveBeenCalledTimes(2);
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.textContent).toContain('Conversation message 1');
});

it('does not let a slow poll erase a message that just posted', async () => {
  let resolvePoll!: (value: WorkChatMessagesResponse) => void;
  vi.spyOn(workClient, 'chat').mockReturnValue(
    new Promise((resolve) => {
      resolvePoll = resolve;
    }),
  );
  vi.spyOn(workClient, 'postChat').mockResolvedValue({
    ...message(7, 'user'),
    body: 'Keep this successful send',
  });
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<WorkChatPane workId={workId} />);
  });
  const textarea = host.querySelector<HTMLTextAreaElement>('textarea')!;
  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value',
    )!.set!;
    valueSetter.call(textarea, 'Keep this successful send');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    host.querySelector<HTMLButtonElement>('.send-button')!.click();
    await Promise.resolve();
  });
  expect(host.textContent).toContain('Keep this successful send');

  await act(async () => {
    resolvePoll(response([]));
    await Promise.resolve();
  });
  expect(host.textContent).toContain('Keep this successful send');
});

it('admits only one request for rapid duplicate submits', async () => {
  const { host } = await renderChat([]);
  let resolveSend!: (value: WorkChatMessageResponse) => void;
  const post = vi.spyOn(workClient, 'postChat').mockReturnValue(
    new Promise((resolve) => {
      resolveSend = resolve;
    }),
  );
  const textarea = host.querySelector<HTMLTextAreaElement>('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value',
    )!.set!.call(textarea, 'Send once');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const form = host.querySelector<HTMLFormElement>('form.composer')!;
  await act(async () => {
    form.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    form.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    await Promise.resolve();
  });
  expect(post).toHaveBeenCalledTimes(1);
  await act(async () => {
    resolveSend({ ...message(8, 'user'), body: 'Send once' });
    await Promise.resolve();
  });
});

it('uses a new idempotency key after the user edits a failed send', async () => {
  const { host } = await renderChat([]);
  const requestIds: string[] = [];
  vi.spyOn(workClient, 'postChat').mockImplementation(
    async (_workId, body, requestId) => {
      requestIds.push(requestId!);
      if (requestIds.length === 1) throw new Error('temporary');
      return { ...message(9, 'user'), body };
    },
  );
  const textarea = host.querySelector<HTMLTextAreaElement>('textarea')!;
  const write = async (value: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )!.set!.call(textarea, value);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  await write('Original failed body');
  await act(async () => {
    host.querySelector<HTMLButtonElement>('.send-button')!.click();
    await Promise.resolve();
  });
  expect(textarea.value).toBe('Original failed body');
  await write('Edited body');
  await act(async () => {
    host.querySelector<HTMLButtonElement>('.send-button')!.click();
    await Promise.resolve();
  });
  expect(requestIds).toHaveLength(2);
  expect(requestIds[1]).not.toBe(requestIds[0]);
});

it.each(['en', 'zh-CN'] as const)(
  'contains long user, code, and CJK content without widening the history in %s',
  async (locale) => {
    await page.viewport(1440, 900);
    setLocale(locale);
    try {
      const longToken = `${'A'.repeat(500)}${'超'.repeat(500)}`;
      const code = `\`\`\`text\n${'code'.repeat(300)}\n\`\`\``;
      const { host, history } = await renderChat([
        { ...message(1, 'user'), body: longToken },
        { ...message(2, 'lead'), body: code },
      ]);
      const bubble = host.querySelector<HTMLElement>(
        '.work-chat-message--user .chat-message',
      )!;
      const pre = host.querySelector<HTMLElement>('pre')!;

      expect(history.scrollWidth).toBeLessThanOrEqual(history.clientWidth + 1);
      expect(bubble.scrollWidth).toBeLessThanOrEqual(bubble.clientWidth + 1);
      expect(pre.scrollWidth).toBeGreaterThan(pre.clientWidth);
    } finally {
      setLocale('en');
    }
  },
);

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
  const workRunId = '00000000-0000-4000-8000-000000000200';
  await act(async () => {
    root!.render(<WorkChatPane workId={workId} workRunId={workRunId} />);
  });
  expect(workClient.chat).toHaveBeenLastCalledWith(workId, workRunId);
  expect(host.textContent).toContain('Questions about this WorkRun');
  expect(host.textContent).toContain(
    'cannot access execution history or change execution',
  );
  expect(host.textContent).not.toContain('Definition lead');
  expect(host.querySelector('.work-chat-pane')?.textContent).not.toContain(
    'Lead',
  );
  expect(host.querySelector('.send-button')?.getAttribute('aria-label')).toBe(
    'Send to assistant',
  );
});

it('replaces the transcript when the selected Run changes', async () => {
  const firstRunId = '00000000-0000-4000-8000-000000000200';
  const secondRunId = '00000000-0000-4000-8000-000000000201';
  const chat = vi
    .spyOn(workClient, 'chat')
    .mockImplementation((_workId, runId) =>
      Promise.resolve(
        response([
          {
            ...message(runId === firstRunId ? 1 : 2, 'lead'),
            body:
              runId === firstRunId
                ? 'First Run transcript'
                : 'Second Run transcript',
          },
        ]),
      ),
    );
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);

  await act(async () => {
    root!.render(<WorkChatPane workId={workId} workRunId={firstRunId} />);
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(host.textContent).toContain('First Run transcript');
  expect(host.textContent).not.toContain('Second Run transcript');

  await act(async () => {
    root!.render(<WorkChatPane workId={workId} workRunId={secondRunId} />);
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(chat).toHaveBeenLastCalledWith(workId, secondRunId);
  expect(host.textContent).toContain('Second Run transcript');
  expect(host.textContent).not.toContain('First Run transcript');
});

it('ignores an old Run response that finishes after switching Runs', async () => {
  const firstRunId = '00000000-0000-4000-8000-000000000200';
  const secondRunId = '00000000-0000-4000-8000-000000000201';
  let resolveFirst!: (value: WorkChatMessagesResponse) => void;
  vi.spyOn(workClient, 'chat').mockImplementation((_workId, runId) => {
    if (runId === firstRunId)
      return new Promise((resolve) => {
        resolveFirst = resolve;
      });
    return Promise.resolve(
      response([{ ...message(2, 'lead'), body: 'Current Run response' }]),
    );
  });
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<WorkChatPane workId={workId} workRunId={firstRunId} />);
  });
  await act(async () => {
    root!.render(<WorkChatPane workId={workId} workRunId={secondRunId} />);
    await Promise.resolve();
  });
  expect(host.textContent).toContain('Current Run response');

  await act(async () => {
    resolveFirst(
      response([{ ...message(1, 'lead'), body: 'Stale first Run response' }]),
    );
    await Promise.resolve();
  });
  expect(host.textContent).toContain('Current Run response');
  expect(host.textContent).not.toContain('Stale first Run response');
});

it('recovers a processing agent reply after navigating away and back', async () => {
  const workRunId = '00000000-0000-4000-8000-000000000200';
  const processing = {
    ...message(1, 'user'),
    body: 'Long-running request',
    status: 'processing' as const,
  };
  const replied = { ...processing, status: 'replied' as const };
  const assistant = { ...message(2, 'lead'), body: 'Durable final response' };
  const chat = vi
    .spyOn(workClient, 'chat')
    .mockResolvedValueOnce(response([processing]))
    .mockResolvedValue(response([replied, assistant]));
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);

  await act(async () => {
    root!.render(<WorkChatPane workId={workId} workRunId={workRunId} />);
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(host.textContent).toContain('Assistant is replying');
  await act(async () => root!.render(<div>Other surface</div>));
  await act(async () => {
    root!.render(<WorkChatPane workId={workId} workRunId={workRunId} />);
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(chat).toHaveBeenCalledTimes(2);
  expect(host.textContent).toContain('Durable final response');
  expect(host.textContent).not.toContain('Assistant is replying');
});

const copyMeasurements: unknown[] = [];
it.each(['en', 'zh-CN'] as const)(
  'fits the WorkRun question placeholder in %s at 1440',
  async (locale) => {
    await page.viewport(1440, 900);
    setLocale(locale);
    try {
      const { host } = await renderChat([]);
      await act(async () =>
        root!.render(
          <WorkChatPane
            workId={workId}
            workRunId="00000000-0000-4000-8000-000000000200"
          />,
        ),
      );
      const control = host.querySelector<HTMLTextAreaElement>(
        '.work-chat-composer textarea#message',
      )!;
      const heading = copyRegressions['work.chat.runLead'][locale];
      copyMeasurements.push({
        locale,
        key: 'work.chat.runLead',
        ...measureCopy(findCopy(host, heading.after), heading.before),
      });
      const copy = copyRegressions['work.chat.runPlaceholder'][locale];
      expect(control.placeholder).toBe(copy.after);
      copyMeasurements.push({
        locale,
        key: 'work.chat.runPlaceholder',
        ...measureControlCopy(control, copy.before, copy.after),
      });
      await commands.writeInventory(
        JSON.stringify({ kind: 'chat-copy', measurements: copyMeasurements }),
        'canary',
      );
    } finally {
      setLocale('en');
    }
  },
);
