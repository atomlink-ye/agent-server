import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

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

it('shows visible progress while waiting for a Coworker reply', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <ChatComposer
        draft="Submitted prompt"
        sending
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
    const progress = host.querySelector('[role="status"]');
    expect(progress?.textContent).toBe('Waiting for Coworker…');
    expect(progress?.classList.contains('composer-progress')).toBe(true);
    expect(host.querySelector('.composer-hint')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it('keeps an IME composition Enter from submitting the draft', async () => {
  const onSend = vi.fn();
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <ChatComposer
        draft="composing"
        sending={false}
        disabled={false}
        sendError={null}
        canRetry={false}
        onDraftChange={() => {}}
        onSend={onSend}
        onRetry={() => {}}
      />,
    );
  });
  try {
    const field = host.querySelector('textarea')!;
    field.focus();
    await act(async () => {
      field.dispatchEvent(
        new KeyboardEvent('keydown', {
          bubbles: true,
          key: 'Enter',
          isComposing: true,
        }),
      );
    });
    expect(document.activeElement).toBe(field);
    expect(onSend).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
