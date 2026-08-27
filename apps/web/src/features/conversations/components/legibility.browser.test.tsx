import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';

import { ChatComposer } from './ChatComposer';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

it('explains why disabled conversation actions cannot be used', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <ChatComposer
        draft=""
        sending={false}
        disabled={false}
        sendError={null}
        canRetry={false}
        onDraftChange={() => {}}
        onSend={() => {}}
        onRetry={() => {}}
      />,
    );
  });
  try {
    const attach = host.querySelector<HTMLButtonElement>('.composer-tool');
    expect(attach?.disabled).toBe(true);
    expect(attach?.getAttribute('aria-describedby')).toBe(
      'conversation-attachments-reason',
    );
    expect(host.textContent).toContain(
      'File attachments aren’t available in conversations yet.',
    );
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
