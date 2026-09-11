import { surfaceMetrics } from '@/test-support/surface-metrics';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';

import '../../index.css';

import WhispersPage from './WhispersPage';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}

async function renderPage(host: HTMLElement) {
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <div className="app-shell" style={{ height: '900px' }}>
        <WhispersPage />
      </div>,
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
  return root;
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

it('shows the nudge copy when there are no whisper channels', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => jsonResponse({ whispers: [] })),
  );
  const host = document.createElement('div');
  document.body.appendChild(host);
  await renderPage(host);

  expect(host.textContent).toContain(
    'Send a message in a group to nudge an agent to whisper.',
  );
});

it('lists a whisper channel and peeks its messages without offering a compose box', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/messages')) {
        return jsonResponse({
          messages: [
            {
              message_id: 'm-1',
              whisper_channel_id: 'w-1',
              sequence: 1,
              author_agent_id: 'agent-a',
              body: 'Need to align privately.',
              created_at: '2026-01-01T00:00:00.000Z',
            },
          ],
        });
      }
      return jsonResponse({
        whispers: [
          {
            whisper_channel_id: 'w-1',
            topic: 'align on W-1',
            members: ['agent-a', 'agent-b'],
            initiated_by: 'agent-a',
            origin: {
              conversation_id: 'conv-1',
              trigger_message_id: null,
              work_ref: 'W-1',
            },
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
          },
        ],
      });
    }),
  );
  const host = document.createElement('div');
  document.body.appendChild(host);
  await renderPage(host);
  await act(async () => {
    await Promise.resolve();
  });

    await surfaceMetrics(host, "whispers", [".title-bar", "header.whisper-observer-badge", ".whisper-message", ".whispers-list button", ".whisper-message-log"]);
  expect(host.textContent).toContain('agent-a ↔ agent-b');
  expect(host.textContent).toContain('Need to align privately.');
  expect(host.textContent).toContain('Observer mode');
  expect(host.querySelector('textarea')).toBeNull();
  expect(host.querySelector('input[type="text"]')).toBeNull();
});

it('scrolls the real whisper channel and message panels to their final content on desktop', async () => {
  const channels = Array.from({ length: 48 }, (_, index) => ({
    whisper_channel_id: `w-${index}`,
    topic: `Private alignment ${index}`,
    members: ['agent-a', `agent-${index}`],
    initiated_by: 'agent-a',
    origin: {
      conversation_id: 'conv-1',
      trigger_message_id: null,
      work_ref: 'W-1',
    },
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  }));
  const messages = Array.from({ length: 48 }, (_, index) => ({
    message_id: `m-${index}`,
    whisper_channel_id: 'w-0',
    sequence: index,
    author_agent_id: 'agent-a',
    body:
      index === 47 ? 'Final real whisper message' : `Private update ${index}`,
    created_at: '2026-01-01T00:00:00.000Z',
  }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) =>
      jsonResponse(
        String(input).includes('/messages')
          ? { messages }
          : { whispers: channels },
      ),
    ),
  );
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = await renderPage(host);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  try {
    for (const selector of ['.whispers-list', '.whisper-message-log']) {
      const region = host.querySelector<HTMLElement>(selector);
      expect(region).not.toBeNull();
      expect(region!.scrollHeight).toBeGreaterThan(region!.clientHeight);
      region!.scrollTop = region!.scrollHeight;
      expect(region!.scrollTop).toBeGreaterThan(0);
    }
    const finalMessage = [...host.querySelectorAll('.whisper-message')].at(-1)!;
    const region = host.querySelector<HTMLElement>('.whisper-message-log')!;
    expect(finalMessage.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      region.getBoundingClientRect().bottom + 1,
    );
    await page.screenshot({
      path: '../../../../../.local/whispers-scroll-desktop.png',
    });
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
