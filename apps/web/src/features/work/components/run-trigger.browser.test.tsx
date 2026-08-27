import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

import { RunTrigger } from '@/features/work/components/run-trigger';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const workId = '00000000-0000-4000-8000-000000000001';

function errorResponse(
  status: number,
  code: string,
  message: string,
): Response {
  return {
    ok: false,
    status,
    json: async () => ({ error: { code, message } }),
  } as Response;
}

async function renderAndClickStart(host: HTMLElement) {
  const root = createRoot(host);
  await act(async () => {
    root.render(<RunTrigger workId={workId} />);
  });
  const button = host.querySelector<HTMLButtonElement>('button')!;
  await act(async () => {
    button.click();
    await Promise.resolve();
  });
  return root;
}

it('disables the control and offers no Retry for a permanent Run-start failure', async () => {
  const fetchMock = vi.fn(async () =>
    errorResponse(
      409,
      'unsupported_runtime_capability',
      'The Work requires unsupported runtime capability: external_workspace.',
    ),
  );
  vi.stubGlobal('fetch', fetchMock);

  const host = document.createElement('div');
  document.body.append(host);
  const root = await renderAndClickStart(host);
  try {
    const button = host.querySelector<HTMLButtonElement>('button')!;
    // The specific, real reason must reach the user instead of a generic
    // constant, and there must be no enabled Retry — a retry here cannot
    // succeed.
    expect(host.textContent).toContain(
      'The Work requires unsupported runtime capability: external_workspace.',
    );
    expect(button.disabled).toBe(true);
    expect(host.textContent).not.toContain('Retry');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it('keeps an enabled Retry for a transient Run-start failure', async () => {
  const fetchMock = vi.fn(async () =>
    errorResponse(502, 'upstream_unavailable', 'The service is unavailable.'),
  );
  vi.stubGlobal('fetch', fetchMock);

  const host = document.createElement('div');
  document.body.append(host);
  const root = await renderAndClickStart(host);
  try {
    const button = host.querySelector<HTMLButtonElement>('button')!;
    expect(button.disabled).toBe(false);
    expect(button.textContent).toContain('Retry');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it('disables the control for a feature-unavailable Run-start failure', async () => {
  const fetchMock = vi.fn(async () =>
    errorResponse(
      503,
      'feature_unavailable',
      'Work management is not available in this environment.',
    ),
  );
  vi.stubGlobal('fetch', fetchMock);

  const host = document.createElement('div');
  document.body.append(host);
  const root = await renderAndClickStart(host);
  try {
    const button = host.querySelector<HTMLButtonElement>('button')!;
    expect(button.disabled).toBe(true);
    expect(host.textContent).not.toContain('Retry');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
