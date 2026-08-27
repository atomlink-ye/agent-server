import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ProductWorkDefinitionVersionSchema } from '@atomlink-ye/agent-server/product-contract';

import { RunTrigger } from '@/features/work/components/run-trigger';
import {
  workDefinitionClient,
  type DefinitionPlan,
} from '@/features/work/clients/work-definition-client';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const workId = '00000000-0000-4000-8000-000000000001';
const definitionVersion = ProductWorkDefinitionVersionSchema.parse({
  id: '00000000-0000-4000-8000-000000000002',
  definition_id: '00000000-0000-4000-8000-000000000003',
  status: 'published',
  fingerprint: `sha256:${'a'.repeat(64)}`,
  source: {
    apiVersion: 'agentserver.dev/v1alpha1',
    kind: 'WorkDefinition',
    metadata: { name: 'external-workspace-work' },
    spec: { kind: 'single_worker' },
  },
  source_yaml: 'apiVersion: agentserver.dev/v1alpha1\nkind: WorkDefinition\n',
  resolved: { resource_manifest_fingerprint: `sha256:${'b'.repeat(64)}` },
  created_at: '2026-08-15T00:00:00.000Z',
  published_at: '2026-08-15T00:00:00.000Z',
  links: {
    self: '/api/v1/work-definition-versions/2',
    definition: '/api/v1/work-definitions/3',
  },
});

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

it('projects an incompatible pinned Work before the user clicks Start Run', async () => {
  const fetchMock = vi.fn(async (path: string) => {
    if (path === '/api/runtime-capabilities')
      return {
        ok: true,
        status: 200,
        json: async () => ({ supported_runtime_capabilities: [] }),
      } as Response;
    if (path === '/api/work-definitions/plan')
      return {
        ok: true,
        status: 200,
        json: async () => ({
          valid: true,
          fingerprint: `sha256:${'c'.repeat(64)}`,
          metadata: { normalized_name: 'external-workspace-work' },
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
        }),
      } as Response;
    throw new Error(`unexpected request: ${path}`);
  });
  vi.stubGlobal('fetch', fetchMock);

  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <RunTrigger workId={workId} definitionVersion={definitionVersion} />,
    );
    await Promise.resolve();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  try {
    expect(host.textContent).toContain('Run unavailable');
    expect(host.textContent).toContain(
      'This Work can’t run in this deployment.',
    );
    expect(host.textContent).toContain(
      'It requires External workspace, which isn’t available here.',
    );
    const button = host.querySelector<HTMLButtonElement>('button')!;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain('Can’t start Run');
    expect(button.getAttribute('aria-describedby')).toBe(
      `run-unavailable-${workId}`,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/runtime-capabilities',
      expect.objectContaining({ method: 'GET' }),
    );
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it('exposes a bounded projection error and retries only that read', async () => {
  let capabilityReads = 0;
  const fetchMock = vi.fn(async () => {
    capabilityReads += 1;
    return capabilityReads === 1
      ? errorResponse(502, 'upstream_unavailable', 'temporary')
      : ({
          ok: true,
          status: 200,
          json: async () => ({
            supported_runtime_capabilities: ['external_workspace'],
          }),
        } as Response);
  });
  const plan = {
    fingerprint: `sha256:${'c'.repeat(64)}`,
    resolved: { requiredRuntimeCapabilities: ['external_workspace'] },
  } as DefinitionPlan;
  const planSpy = vi
    .spyOn(workDefinitionClient, 'plan')
    .mockResolvedValue(plan);
  vi.stubGlobal('fetch', fetchMock);

  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <RunTrigger workId={workId} definitionVersion={definitionVersion} />,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  try {
    expect(host.textContent).toContain(
      'We couldn’t check whether this Work can run here.',
    );
    expect(host.textContent).toContain('Retry availability check');
    expect(host.textContent).toContain('Start Run');

    await act(async () => {
      const retry = [
        ...host.querySelectorAll<HTMLButtonElement>('button'),
      ].find((button) =>
        button.textContent?.includes('Retry availability check'),
      );
      retry?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(host.textContent).not.toContain(
      'We couldn’t check whether this Work can run here.',
    );
    expect(host.textContent).toContain('Start Run');
    expect(capabilityReads).toBe(2);
    expect(planSpy).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    planSpy.mockRestore();
    vi.unstubAllGlobals();
  }
});

it('keeps feature-unavailable distinct from a missing current DefinitionVersion', async () => {
  const fetchMock = vi.fn(async (path: string) => {
    if (path === '/api/runtime-capabilities')
      return {
        ok: true,
        status: 200,
        json: async () => ({ supported_runtime_capabilities: [] }),
      } as Response;
    return errorResponse(
      503,
      'feature_unavailable',
      'Work management is not available in this environment.',
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <RunTrigger workId={workId} definitionVersion={definitionVersion} />,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  try {
    expect(host.textContent).toContain(
      'Work management is not available in this environment.',
    );
    expect(host.textContent).not.toContain(
      'The current Work Definition version could not be loaded',
    );
    expect(host.textContent).not.toContain('Retry availability check');
    expect(host.querySelector<HTMLButtonElement>('button')?.disabled).toBe(
      true,
    );
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
