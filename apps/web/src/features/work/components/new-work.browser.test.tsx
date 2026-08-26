import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

import { NewWork } from './new-work';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const agent = {
  id: 'agent-a',
  display_name: 'Maya',
  role_label: 'Research Analyst',
  summary: 'Researches competitors.',
  active_agent_version_id: 'version-a',
  runtime_status: 'available',
};

function profile(capabilityVersionId = 'capability-a') {
  return {
    agent,
    capabilities: {
      model_policy_ref: 'free-only',
      proposal_limit: 0,
      tools: [],
      skills: [],
    },
    work_catalog: [
      {
        definition_id: 'definition-a',
        definition_version_id: capabilityVersionId,
        name: 'competitor-research',
        description: 'Research competitors.',
        input_schema: {
          type: 'object',
          properties: {
            include_private: { type: 'boolean' },
          },
          required: ['include_private'],
          additional_properties: false,
        },
      },
    ],
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

it('does not silently replace an unavailable deep-link Coworker or Capability', async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) === '/api/agents')
      return response({ items: [agent], next_cursor: null });
    if (String(input) === '/api/agents/missing/profile')
      return response(
        { error: { code: 'agent_not_found', message: 'missing' } },
        404,
      );
    throw new Error(`unexpected request: ${String(input)}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(
        <NewWork
          initialAgentId="missing"
          initialCapabilityVersionId="capability-missing"
        />,
      );
    });
    await settle();
    expect(host.querySelector<HTMLSelectElement>('#work-coworker')?.value).toBe(
      '',
    );
    expect(host.textContent).toContain('That Coworker is no longer available');
    expect(
      fetchMock.mock.calls.some(([input]) => String(input) === '/api/works'),
    ).toBe(false);
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
      if (String(input) === '/api/agents')
        return response({ items: [agent], next_cursor: null });
      if (String(input) === '/api/agents/agent-a/profile')
        return response(profile());
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
      root.render(
        <NewWork
          initialAgentId="agent-a"
          initialCapabilityVersionId="capability-a"
        />,
      );
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
      definition_version_id: 'capability-a',
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
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
