import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';

import { ChatSurface, type Message } from '@/components/chat/chat-surface';
import fixture from '@/lib/__fixtures__/s1-product-session-run-events.jsonl?raw';
import {
  applyTimelineEnvelopes,
  FALLBACK_TOOL_LABELS,
  initialTimelineState,
  parseRunStreamEvent,
} from '@/lib/stream-reducer';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

it('S6 Step1 renders the golden fixture without fallback tool labels', async () => {
  const runId = 'run-s5-product-session-cumulative';
  const timeline = applyTimelineEnvelopes(
    initialTimelineState,
    fixture
      .trim()
      .split('\n')
      .flatMap((line) => {
        const event = parseRunStreamEvent(line);
        return event
          ? [{ runId, update: { kind: 'runEvent' as const, event } }]
          : [];
      }),
  );
  const messages: Message[] = [
    {
      id: 'prompt',
      role: 'user',
      text: 'Use the shell tool exactly once.',
      status: 'completed',
      task_id: 'task-golden',
      run_id: runId,
    },
  ];
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(
        <ChatSurface
          messages={messages}
          entries={timeline}
          capabilities={{
            surface: 'product',
            canCompose: true,
            canRetry: true,
          }}
          now="2026-08-08T00:00:00.000Z"
          replayStatus={{ [runId]: 'ready' }}
          status="completed"
          retryText=""
          text=""
          setText={() => undefined}
          pending={false}
          onPrompt={() => undefined}
          onSend={() => undefined}
          onRetry={() => undefined}
        />,
      );
    });

    const renderedText = [...host.querySelectorAll('*')].map(
      (element) => element.textContent,
    );
    for (const label of Object.values(FALLBACK_TOOL_LABELS))
      expect(renderedText).not.toContain(label);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
