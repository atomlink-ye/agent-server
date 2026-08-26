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

it('blocks Work creation for an unselected required boolean and accepts explicit No', async () => {
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
          { error: { code: 'stop_after_create', message: 'stop' } },
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
      await Promise.resolve();
      submit!.click();
      await Promise.resolve();
    });
    const createRequest = requests.find(
      (request) => request.input === '/api/works',
    );
    expect(createRequest).toBeDefined();
    expect(JSON.parse(String(createRequest?.init?.body))).toMatchObject({
      definition_version_id: 'capability-a',
    });
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
