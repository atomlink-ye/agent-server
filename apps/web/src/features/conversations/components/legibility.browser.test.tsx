import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';

import { ChatComposer } from './ChatComposer';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

it('does not expose an attachment control without an attachment action', async () => {
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
    expect(host.querySelector('.composer-tool')).toBeNull();
    expect(host.querySelector('[role="tooltip"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
