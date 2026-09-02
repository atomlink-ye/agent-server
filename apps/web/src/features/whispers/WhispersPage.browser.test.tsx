import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

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
    root.render(<WhispersPage />);
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

  expect(host.textContent).toContain('agent-a ↔ agent-b');
  expect(host.textContent).toContain('Need to align privately.');
  expect(host.textContent).toContain('Observer mode');
  expect(host.querySelector('textarea')).toBeNull();
  expect(host.querySelector('input[type="text"]')).toBeNull();
});
