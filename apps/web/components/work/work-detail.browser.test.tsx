import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

import { WorkDetailShell } from '@/components/work/work-shell';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

it('renders the read-only Work-first detail shell without a contract DTO', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(null, { status: 501 }));
  vi.stubGlobal('fetch', fetchMock);

  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(<WorkDetailShell workId="stage-1-work" />);
    });

    expect(
      host.querySelector('[data-testid="work-detail-shell"]'),
    ).not.toBeNull();
    expect(host.textContent).toContain('read-only Work-first surface');
    expect(host.textContent).toContain('Controls are explicitly unavailable.');
    expect(fetchMock).toHaveBeenCalledWith('/api/works/stage-1-work', {
      method: 'GET',
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
