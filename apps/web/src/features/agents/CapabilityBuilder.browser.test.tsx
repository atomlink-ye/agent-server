import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

import { CapabilityBuilder } from '@/features/agents/AuthoringPanels';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const agent = {
  id: '00000000-0000-4000-8000-000000000001',
  displayName: 'Coworker',
  roleLabel: 'Specialist',
} as unknown as Parameters<typeof CapabilityBuilder>[0]['agent'];

function unavailableResponse(): Response {
  return {
    ok: false,
    status: 503,
    json: async () => ({
      error: {
        code: 'feature_unavailable',
        message: 'Work management is not available in this environment.',
      },
    }),
  } as Response;
}

function catalogResponse(): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      skills: [
        {
          ref: 'agent-server/memory-api',
          name: 'agent-server/memory-api',
          required_tool_refs: ['agent-server/memory-read'],
        },
      ],
    }),
  } as Response;
}

async function renderBuilder(host: HTMLElement) {
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <CapabilityBuilder
        agent={agent}
        onCancel={() => {}}
        onSaved={() => {}}
        onStart={() => {}}
      />,
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
  return root;
}

function buttonNamed(host: HTMLElement, label: string): HTMLButtonElement {
  const found = Array.from(host.querySelectorAll('button')).find((button) =>
    (button.textContent ?? '').trim().startsWith(label),
  );
  if (!found) throw new Error(`no button labelled ${label}`);
  return found as HTMLButtonElement;
}

it('disables authoring actions when the Skill catalog reports the surface is unavailable', async () => {
  // The catalog is installed by the same productWorkSurface fact as the
  // work-definition routes this builder saves through, so an unavailable
  // catalog means saving can never succeed — the controls must say so up
  // front rather than after a failed attempt.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => unavailableResponse()),
  );
  const host = document.createElement('div');
  document.body.append(host);
  const root = await renderBuilder(host);

  expect(host.textContent).toContain('doesn’t currently offer Skills');
  expect(buttonNamed(host, 'Preview plan').disabled).toBe(true);
  expect(buttonNamed(host, 'Save capability').disabled).toBe(true);
  expect(buttonNamed(host, 'Save & start Work').disabled).toBe(true);
  // `unavailable` must never offer a Retry, because a retry cannot succeed.
  expect(host.textContent?.toLowerCase()).not.toContain('retry');

  await act(async () => {
    root.unmount();
  });
  host.remove();
  vi.unstubAllGlobals();
});

it('names the tools a Skill transitively grants at selection time', async () => {
  // A Skill carries `requiredToolRefs`, so picking one widens what the
  // compiled Worker may do. The author must be able to see what they are
  // granting before they grant it.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => catalogResponse()),
  );
  const host = document.createElement('div');
  document.body.append(host);
  const root = await renderBuilder(host);

  expect(host.textContent).toContain('agent-server/memory-api');
  expect(host.textContent).toContain('grants agent-server/memory-read');

  await act(async () => {
    root.unmount();
  });
  host.remove();
  vi.unstubAllGlobals();
});
