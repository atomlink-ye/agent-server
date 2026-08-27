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

it('shows and retains an affirmative save result without navigating', async () => {
  const definitionId = '33333333-3333-4333-8333-333333333333';
  const versionId = '44444444-4444-4444-8444-444444444444';
  const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (path === '/api/skills') return catalogResponse();
    if (method === 'POST' && path === '/api/work-definitions/validate')
      return jsonResponse({
        valid: true,
        fingerprint: `sha256:${'a'.repeat(64)}`,
        metadata: { normalized_name: 'competitor-research' },
        diagnostics: [],
      });
    if (method === 'POST' && path === '/api/work-definitions/plan')
      return jsonResponse({
        valid: true,
        fingerprint: `sha256:${'a'.repeat(64)}`,
        metadata: { normalized_name: 'competitor-research' },
        resolved: {
          kind: 'single_worker',
          participants: [
            {
              name: 'specialist',
              role: 'primary',
              source: 'inline',
              worker_version_id: null,
              skills: [],
              tools: [],
            },
          ],
          environment: { source: 'inline', environment_version_id: null },
          memory_version_ids: [],
          required_runtime_capabilities: ['external_workspace'],
          platform_capabilities: [],
          materialization: {
            inline_workers: 1,
            inline_environment: true,
            internal_team: false,
          },
        },
        diagnostics: [],
      });
    if (method === 'POST' && path === '/api/work-definitions/apply')
      return jsonResponse({
        result: 'created',
        definition: {
          id: definitionId,
          normalized_name: 'competitor-research',
          description: 'Research competitors.',
          created_at: '2026-08-15T00:00:00.000Z',
          latest_version_id: versionId,
          links: {
            self: '/api/v1/work-definitions/3',
            versions: '/api/v1/work-definitions/3/versions',
          },
        },
        version: {
          id: versionId,
          definition_id: definitionId,
          status: 'published',
          fingerprint: `sha256:${'a'.repeat(64)}`,
          source: {},
          source_yaml: 'kind: WorkDefinition',
          resolved: {
            resource_manifest_fingerprint: `sha256:${'b'.repeat(64)}`,
          },
          created_at: '2026-08-15T00:00:00.000Z',
          published_at: '2026-08-15T00:00:00.000Z',
          links: {
            self: `/api/v1/work-definition-versions/${versionId}`,
            definition: `/api/v1/work-definitions/${definitionId}`,
          },
        },
        resolved: {
          resource_manifest_fingerprint: `sha256:${'b'.repeat(64)}`,
        },
      });
    if (method === 'POST' && path.includes('/api/agents/'))
      return jsonResponse({ associated: true });
    throw new Error(`unexpected request: ${method} ${path}`);
  });
  vi.stubGlobal('fetch', fetchMock);

  const host = document.createElement('div');
  document.body.append(host);
  const root = await renderBuilder(host);
  try {
    const textInputs = host.querySelectorAll<HTMLInputElement>('input');
    const setValue = (input: HTMLInputElement, value: string): void => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    await act(async () => {
      setValue(textInputs[0]!, 'Competitor Research');
      const description = host.querySelector('textarea')!;
      const textareaSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      textareaSetter?.call(
        description,
        'Research competitors and compare their positioning.',
      );
      description.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      buttonNamed(host, 'Preview plan').click();
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
    await act(async () => {
      buttonNamed(host, 'Save capability').click();
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
    expect(
      host.querySelector('[data-testid="capability-save-success"]'),
    ).not.toBeNull();
    await act(async () =>
      setValue(textInputs[0]!, 'Competitor Research Updated'),
    );
    expect(host.textContent).toContain(
      'Capability saved to this Coworker’s Work Catalog.',
    );
    expect(window.location.pathname).not.toContain('/work');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}
