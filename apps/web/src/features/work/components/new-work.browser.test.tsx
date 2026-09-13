import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { setLocale } from '../../../i18n';
import { workDefinitionClient } from '../clients/work-definition-client';
import '../../../index.css';
import './work-detail.css';
import '../work-page.css';

import { NewWork } from './new-work';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const definitionId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const versionId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
function definitionVersion() {
  return {
    id: versionId,
    definition_id: definitionId,
    status: 'published',
    fingerprint: `sha256:${'a'.repeat(64)}`,
    source: {
      apiVersion: 'agentserver.dev/v1alpha1',
      kind: 'WorkDefinition',
      metadata: {
        name: 'competitor-research',
        description: 'Research competitors.',
      },
      spec: {
        kind: 'single_worker',
        input_schema: {
          type: 'object',
          properties: { include_private: { type: 'boolean' } },
          required: ['include_private'],
          additional_properties: false,
        },
      },
    },
    source_yaml: 'kind: WorkDefinition',
    resolved: { resource_manifest_fingerprint: `sha256:${'b'.repeat(64)}` },
    created_at: '2026-08-26T00:00:00.000Z',
    published_at: '2026-08-26T00:00:00.000Z',
    links: { self: 'version', definition: 'definition' },
  };
}

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

it('does not silently replace an unavailable Definition in a legacy profile link', async () => {
  const fetchMock = vi.fn(async () =>
    response({ error: { code: 'not_found', message: 'missing' } }, 404),
  );
  vi.stubGlobal('fetch', fetchMock);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(<NewWork initialCapabilityVersionId="capability-missing" />);
    });
    await settle();
    expect(host.querySelector('#work-coworker')).toBeNull();
    expect(host.textContent).toContain(
      'This Work Definition is no longer available',
    );
    expect(fetchMock.mock.calls).toHaveLength(1);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it('blocks an unselected required boolean, then starts Run in the same turn after Work creation', async () => {
  const requests: Array<{ input: string; init?: RequestInit }> = [];
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ input: String(input), init });
      if (String(input) === `/api/work-definition-versions/${versionId}`)
        return response({ version: definitionVersion() });
      if (String(input) === '/api/works')
        return response(
          {
            work: {
              id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              tenant_id: 'tenant',
              workspace_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
              definition_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
              definition_version_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
              title: 'Competitor Research',
              origin: 'created',
              archived_at: null,
              created_at: '2026-08-26T00:00:00.000Z',
              updated_at: '2026-08-26T00:00:00.000Z',
            },
          },
          201,
        );
      if (
        String(input) === '/api/works/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/runs'
      )
        return response(
          { error: { code: 'stop_after_run_request', message: 'stop' } },
          500,
        );
      throw new Error(`unexpected request: ${String(input)}`);
    },
  );
  vi.stubGlobal('fetch', fetchMock);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(<NewWork initialCapabilityVersionId={versionId} />);
    });
    await settle();
    const submit = host.querySelector<HTMLButtonElement>(
      '[data-testid="new-work-submit"]',
    );
    const choice = host.querySelector<HTMLSelectElement>(
      '#work-input-include_private',
    );
    expect(submit).not.toBeNull();
    expect(choice).not.toBeNull();
    await act(async () => {
      submit!.click();
      await Promise.resolve();
    });
    expect(host.textContent).toContain(
      'Complete the required input: Include Private.',
    );
    expect(host.textContent).not.toContain('Retry Work creation');
    expect(document.activeElement).toBe(choice);
    expect(requests.some((request) => request.input === '/api/works')).toBe(
      false,
    );

    await act(async () => {
      choice!.value = 'false';
      choice!.dispatchEvent(new Event('change', { bubbles: true }));
      submit!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(requests.slice(-2).map((request) => request.input)).toEqual([
      '/api/works',
      '/api/works/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/runs',
    ]);
    const createRequest = requests.find(
      (request) => request.input === '/api/works',
    );
    expect(createRequest).toBeDefined();
    expect(JSON.parse(String(createRequest?.init?.body))).toMatchObject({
      definition_version_id: versionId,
    });
    const runRequest = requests.find((request) =>
      request.input.endsWith(
        '/api/works/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/runs',
      ),
    );
    expect(runRequest).toBeDefined();
    expect(JSON.parse(String(runRequest?.init?.body))).toMatchObject({
      trigger_kind: 'manual',
      input: { include_private: false },
    });
    await page.screenshot({
      path: '../../../../__screenshots__/ux-review/run-start-failure.png',
    });
    expect(submit!.disabled).toBe(true);
    const retry = [...host.querySelectorAll('button')].find(
      (button) => button.textContent === 'Retry WorkRun',
    )!;
    await act(async () => {
      retry.click();
      await settle();
    });
    expect(
      requests.filter((request) => request.input === '/api/works'),
    ).toHaveLength(1);
    expect(
      requests.filter((request) => request.input.endsWith('/runs')),
    ).toHaveLength(2);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it('creates and starts Work from a Definition without exposing an initiator choice', async () => {
  const definitionId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const versionId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const requests: Array<{ input: string; init?: RequestInit }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      requests.push({ input: path, init });
      if (path === `/api/work-definition-versions/${versionId}`)
        return response({
          version: {
            id: versionId,
            definition_id: definitionId,
            status: 'published',
            fingerprint: `sha256:${'a'.repeat(64)}`,
            source: {
              apiVersion: 'agentserver.dev/v1alpha1',
              kind: 'WorkDefinition',
              metadata: {
                name: 'competitor-research',
                description: 'Research competitors.',
              },
              spec: {
                kind: 'single_worker',
                worker: { inline: { name: 'researcher' } },
                input: {
                  schema: { type: 'object', additionalProperties: false },
                },
              },
            },
            source_yaml: 'kind: WorkDefinition',
            resolved: {
              resource_manifest_fingerprint: `sha256:${'b'.repeat(64)}`,
            },
            created_at: '2026-08-26T00:00:00.000Z',
            published_at: '2026-08-26T00:00:00.000Z',
            links: { self: 'version', definition: 'definition' },
          },
        });
      if (path === '/api/works')
        return response(
          {
            work: {
              id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              tenant_id: 'tenant',
              workspace_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
              definition_id: definitionId,
              definition_version_id: versionId,
              title: 'Competitor Research',
              origin: 'created',
              archived_at: null,
              created_at: '2026-08-26T00:00:00.000Z',
              updated_at: '2026-08-26T00:00:00.000Z',
            },
          },
          201,
        );
      if (path.endsWith('/runs'))
        return response(
          { error: { code: 'observed_start', message: 'observed' } },
          500,
        );
      throw new Error(`unexpected request: ${path}`);
    }),
  );
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(
        <NewWork
          initialDefinitionId={definitionId}
          initialDefinitionVersionId={versionId}
        />,
      );
    });
    await settle();
    await page.screenshot({
      path: '../../../../__screenshots__/ux-review/catalog-start.png',
    });
    expect(host.querySelector('#work-coworker')).toBeNull();
    expect(host.textContent).not.toContain('initiator');
    expect(host.textContent).not.toContain('发起者');
    await act(async () => {
      host
        .querySelector<HTMLButtonElement>('[data-testid="new-work-submit"]')!
        .click();
      await settle();
    });
    expect(requests.slice(-2).map(({ input }) => input)).toEqual([
      '/api/works',
      '/api/works/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/runs',
    ]);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it('offers Definitions at the generic start entry without requiring a Coworker', async () => {
  const catalog = vi
    .spyOn(workDefinitionClient, 'listCatalog')
    .mockResolvedValue([
      {
        definitionId,
        definitionVersionId: versionId,
        name: 'competitor-research',
        description: 'Research competitors.',
        composition: 'single_worker',
        roster: [],
        availableTo: [],
      },
    ]);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input) => {
      if (String(input) === `/api/work-definition-versions/${versionId}`)
        return response({ version: definitionVersion() });
      return response({ items: [], next_cursor: null });
    }),
  );
  const host = document.createElement('div');
  host.style.cssText = 'width: 900px; margin: 60px auto';
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(<NewWork />);
    });
    await settle();
    await page.screenshot({
      path: '../../../../__screenshots__/ux-review/generic-start.png',
    });
    expect(host.querySelector('#work-coworker')).toBeNull();
    expect(host.querySelector('#work-definition-choice')).not.toBeNull();
    expect(host.querySelectorAll('#work-title')).toHaveLength(0);
    expect(host.querySelectorAll('#advanced-work-title')).toHaveLength(1);
    expect(host.textContent).toContain('Competitor Research');
    expect(host.textContent).not.toContain('Create a Coworker');
    await act(async () => {
      const select = host.querySelector<HTMLSelectElement>(
        '#work-definition-choice',
      )!;
      select.value = versionId;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await settle();
    });
    expect(host.querySelectorAll('#work-title')).toHaveLength(1);
    expect(host.querySelectorAll('#advanced-work-title')).toHaveLength(1);
    expect(host.querySelector('#work-input-include_private')).not.toBeNull();
    await page.screenshot({
      path: '../../../../__screenshots__/ux-review/generic-inputs.png',
    });
  } finally {
    await act(async () => root.unmount());
    host.remove();
    catalog.mockRestore();
    vi.unstubAllGlobals();
  }
});

it('distinguishes a failed Definition read from an empty catalog and retries it', async () => {
  const catalog = vi
    .spyOn(workDefinitionClient, 'listCatalog')
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue([]);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(<NewWork />);
    });
    await settle();
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(host.textContent).not.toContain('No published Definitions');
    await act(async () => {
      [...host.querySelectorAll('button')]
        .find((button) => button.textContent === 'Try again')!
        .click();
      await settle();
    });
    expect(catalog).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain(
      'Publish a Definition before creating Work',
    );
    expect(host.querySelector('#work-coworker')).toBeNull();
    await act(async () => {
      setLocale('zh-CN');
      await settle();
    });
    expect(host.textContent).toContain('选择 Definition');
    expect(host.textContent).not.toContain('Choose a Definition');
    await page.screenshot({
      path: '../../../../__screenshots__/ux-review/empty-catalog-zh.png',
    });
  } finally {
    await act(async () => root.unmount());
    host.remove();
    catalog.mockRestore();
    setLocale('en');
  }
});
