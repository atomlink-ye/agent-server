import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { surfaceMetrics } from '@/test-support/surface-metrics';

import '../../index.css';
import { AppShell } from '../../app/shell/AppShell';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

it('uses shared card padding and gutters in the Files workspace in both locales', async () => {
  const coworkers = Array.from({ length: 48 }, (_, index) => ({
    id: `agent-${index}`,
    display_name: `Real coworker ${index}`,
    role_label: 'Researcher',
    summary: 'A fixture coworker used by the real Files scope list.',
    active_agent_version_id: `agent-version-${index}`,
    runtime_status: 'available',
  }));
  const entries = Array.from({ length: 48 }, (_, index) => ({
    id: `file-${index}`,
    path: index === 47 ? 'final-real-file.md' : `notes/${index}.md`,
    current_version: 1,
    content_sha256: 'a'.repeat(64),
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      // Browser fetch supplies a Request from a different realm than the
      // test, so `instanceof Request` is false. Read its public URL/method
      // fields directly and match the transport's actual request shape.
      const request =
        typeof input === 'object' && input !== null && 'url' in input
          ? (input as Request)
          : null;
      const url = new URL(request?.url ?? String(input), window.location.href);
      const method = request?.method ?? 'GET';
      if (method !== 'GET')
        throw new Error(`unexpected Files request method: ${method}`);

      let body: unknown;
      if (url.pathname === '/api/context/files') {
        expect(url.searchParams.get('scope')).toBe('workspace');
        body = { access: 'read_write', scope: {}, entries };
      } else if (url.pathname === '/api/context/file') {
        expect(url.searchParams.get('scope')).toBe('workspace');
        expect(url.searchParams.get('path')).toBe('final-real-file.md');
        body = {
          entry: {
            ...entries[47],
            content: Array.from({ length: 96 }, (_, index) =>
              index === 95
                ? '## Final real file preview paragraph'
                : `Preview paragraph ${index + 1}`,
            ).join('\n\n'),
          },
        };
      } else if (url.pathname === '/api/agents') {
        body = { items: coworkers };
      } else if (url.pathname === '/api/conversations') {
        body = { conversations: [] };
      } else if (url.pathname === '/api/works') {
        body = { works: [], next_cursor: null };
      } else {
        throw new Error(`unexpected Files request URL: ${url.pathname}`);
      }
      return {
        ok: true,
        status: 200,
        json: async () => body,
      } as Response;
    }),
  );
  const host = document.createElement('div');
  host.style.height = '900px';
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/files']}>
          <AppShell commands={{ loadCoworkers: async () => [], loadConversations: async () => [], loadMessages: async () => [], createConversation: async () => { throw new Error("unused"); }, sendMessage: async () => { throw new Error("unused"); } }} />
        </MemoryRouter>,
      );
      for (let turn = 0; turn < 5; turn += 1)
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(host.textContent).toContain('final-real-file.md');
    await surfaceMetrics(host, 'files', ['.title-bar', '.files-files-header', '.files-file-viewer', '.files-file-list button', '.files-main', '.files-files-grid']);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
