import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

import {
  GetWorkResponseSchema,
  ProductRunTraceSuccessSchema,
  ProductWorkDefinitionVersionSchema,
  ProductWorkRunSuccessSchema,
} from '@atomlink-ye/agent-server/product-contract';
import { WorkDetailPage } from '@/features/work/pages/WorkDetailPage';
import { DefinitionPanel } from './definition-panel';
import { NewWork } from './new-work';
import { workDefinitionClient } from '../clients/work-definition-client';
import { workClient } from '../clients/work-client';
import reworkRecording from '@/test-support/fixtures/product-recordings/rework-once.json';
import { projectWorkRunList } from '@/test-support/product-recording-test-helpers';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const trace = ProductRunTraceSuccessSchema.parse(
  reworkRecording.recording_documents[0],
);
const work = GetWorkResponseSchema.parse({ work: trace.work });
const runs = projectWorkRunList(reworkRecording, work.work.id);
const selectedRun = runs.work_runs[0]!;
const run = ProductWorkRunSuccessSchema.parse({
  work: trace.work,
  work_run: trace.work_run,
  work_items: trace.work_items,
  actors: trace.actors,
  messages: trace.messages,
  projection_status: trace.projection_status,
});
const environmentVersionId = '00000000-0000-4000-8000-000000000811';
const leadVersionId = '00000000-0000-4000-8000-000000000812';
const researcherVersionId = '00000000-0000-4000-8000-000000000813';

const definitionVersion = ProductWorkDefinitionVersionSchema.parse({
  id: work.work.definition_version_id,
  definition_id: work.work.definition_id,
  status: 'published',
  fingerprint: `sha256:${'a'.repeat(64)}`,
  source: {
    apiVersion: 'agentserver.dev/v1alpha1',
    kind: 'WorkDefinition',
    metadata: {
      name: 'supplier-risk-review',
      description: 'Review supplier risk using an authored collaboration.',
    },
    spec: {
      kind: 'collaboration',
      lead: { name: 'Lead', agent_version_id: leadVersionId },
      members: [{ name: 'Researcher', agent_version_id: researcherVersionId }],
      environment_version_id: environmentVersionId,
      memory_version_ids: [],
      input_schema: {
        type: 'object',
        properties: {},
        required: [],
        additional_properties: false,
      },
    },
  },
  source_yaml: `apiVersion: agentserver.dev/v1alpha1
kind: WorkDefinition
metadata:
  name: supplier-risk-review
spec:
  kind: collaboration
`,
  resolved: {
    resource_manifest_fingerprint: `sha256:${'b'.repeat(64)}`,
  },
  created_at: work.work.created_at,
  published_at: work.work.updated_at,
  links: {
    self: `/api/v1/work-definition-versions/${work.work.definition_version_id}`,
    definition: `/api/v1/work-definitions/${work.work.definition_id}`,
  },
});

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

it('validates current Definition source and renders the server-resolved one-way preview', async () => {
  const fetchMock = vi
    .fn()
    .mockImplementation(async (path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'POST' && path === '/api/work-definitions/validate')
        return jsonResponse({
          valid: true,
          fingerprint: `sha256:${'c'.repeat(64)}`,
          diagnostics: [],
        });
      if (method === 'POST' && path === '/api/work-definitions/plan')
        return jsonResponse({
          valid: true,
          fingerprint: `sha256:${'c'.repeat(64)}`,
          resolved: {
            kind: 'collaboration',
            participants: [
              {
                name: 'Lead',
                role: 'lead',
                source: 'referenced',
                agent_version_id: leadVersionId,
                skills: [],
                tools: [],
              },
              {
                name: 'Researcher',
                role: 'member',
                source: 'referenced',
                agent_version_id: researcherVersionId,
                skills: [],
                tools: [],
              },
            ],
            environment: {
              source: 'referenced',
              environment_version_id: environmentVersionId,
            },
            memory_version_ids: [],
            required_runtime_capabilities: ['reusable_session'],
            platform_capabilities: ['collaboration', 'platform_mcp'],
          },
          diagnostics: [],
          operations: [],
        });

      const responses = new Map<string, unknown>([
        [`/api/works/${work.work.id}`, work],
        [`/api/works/${work.work.id}/runs`, runs],
        [
          `/api/work-definition-versions/${work.work.definition_version_id}`,
          { version: definitionVersion },
        ],
        [`/api/works/${work.work.id}/runs/${selectedRun.id}`, run],
        [`/api/works/${work.work.id}/runs/${selectedRun.id}/trace`, trace],
      ]);
      const body = responses.get(path);
      if (!body) throw new Error(`unexpected request: ${method} ${path}`);
      return jsonResponse(body);
    });
  vi.stubGlobal('fetch', fetchMock);

  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(<WorkDetailPage workId={work.work.id} tab="definition" />);
      await new Promise((resolve) => setTimeout(resolve, 25));
    });

    expect(
      host.querySelector('[data-testid="definition-authoring"]'),
    ).not.toBeNull();
    const editor = host.querySelector<HTMLTextAreaElement>(
      '[data-testid="definition-source-editor"]',
    );
    expect(editor).not.toBeNull();
    expect(editor?.value).toContain('kind: collaboration');
    expect(host.textContent).toContain('Current Work version');

    const validate = [
      ...host.querySelectorAll<HTMLButtonElement>('button'),
    ].find((button) => button.textContent?.trim() === 'Validate & plan');
    expect(validate).toBeDefined();
    if (!validate) return;
    await act(async () => {
      validate.click();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(host.textContent).toContain(
      'Definition is valid and its resource plan resolved.',
    );
    expect(host.textContent).toContain('Server-resolved preview');
    expect(host.textContent).toContain('reusable_session');
    expect(host.textContent).toContain('platform_mcp');
    expect(
      fetchMock.mock.calls.some(
        ([path, init]) =>
          path === '/api/work-definitions/validate' &&
          (init as RequestInit | undefined)?.method === 'POST',
      ),
    ).toBe(true);
    expect(
      fetchMock.mock.calls.some(
        ([path, init]) =>
          path === '/api/work-definitions/plan' &&
          (init as RequestInit | undefined)?.method === 'POST',
      ),
    ).toBe(true);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it('applies and creates Work in order after Definition validation and planning', async () => {
  const sequence: string[] = [];
  const validate = vi
    .spyOn(workDefinitionClient, 'validate')
    .mockImplementation(async () => {
      sequence.push('validate');
      return { fingerprint: 'sha256:validated', diagnostics: [] };
    });
  const plan = vi
    .spyOn(workDefinitionClient, 'plan')
    .mockImplementation(async () => {
      sequence.push('plan');
      return {
        fingerprint: 'sha256:planned',
        resolved: {
          kind: 'collaboration',
          participants: [],
          environment: {
            source: 'referenced',
            environment_version_id: environmentVersionId,
          },
          memory_version_ids: [],
          required_runtime_capabilities: [],
          platform_capabilities: [],
        },
      };
    });
  const apply = vi
    .spyOn(workDefinitionClient, 'apply')
    .mockImplementation(async () => {
      sequence.push('apply');
      return {
        definitionId: work.work.definition_id,
        versionId: work.work.definition_version_id,
      };
    });
  const create = vi.spyOn(workClient, 'create').mockImplementation(async () => {
    sequence.push('create');
    throw new Error('stop test before navigation');
  });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(<NewWork />);
    });
    const title = host.querySelector<HTMLInputElement>('#work-title');
    const source = host.querySelector<HTMLTextAreaElement>('#work-definition');
    const submit = host.querySelector<HTMLButtonElement>(
      '[data-testid="new-work-submit"]',
    );
    expect(title).not.toBeNull();
    expect(source).not.toBeNull();
    expect(submit).not.toBeNull();
    setInputValue(title!, 'Supplier risk review');
    setTextAreaValue(source!, 'kind: collaboration');
    await act(async () => {
      submit!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(sequence).toEqual(['validate', 'plan', 'apply', 'create']);
    expect(validate).toHaveBeenCalledWith('kind: collaboration');
    expect(plan).toHaveBeenCalledWith('kind: collaboration');
    expect(apply).toHaveBeenCalledWith('kind: collaboration');
    expect(create).toHaveBeenCalledWith({
      definitionId: work.work.definition_id,
      definitionVersionId: work.work.definition_version_id,
      title: 'Supplier risk review',
    });
  } finally {
    await act(async () => root.unmount());
    host.remove();
    validate.mockRestore();
    plan.mockRestore();
    apply.mockRestore();
    create.mockRestore();
  }
});

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function setTextAreaValue(textarea: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    'value',
  )?.set;
  setter?.call(textarea, value);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

it('applies and pins an authored Definition before returning to Work', async () => {
  const sequence: string[] = [];
  const validate = vi
    .spyOn(workDefinitionClient, 'validate')
    .mockImplementation(async () => {
      sequence.push('validate');
      return { fingerprint: 'sha256:validated', diagnostics: [] };
    });
  const plan = vi
    .spyOn(workDefinitionClient, 'plan')
    .mockImplementation(async () => {
      sequence.push('plan');
      return {
        fingerprint: 'sha256:planned',
        resolved: {
          kind: 'collaboration',
          participants: [],
          environment: {
            source: 'referenced',
            environment_version_id: environmentVersionId,
          },
          memory_version_ids: [],
          required_runtime_capabilities: [],
          platform_capabilities: [],
        },
      };
    });
  const apply = vi
    .spyOn(workDefinitionClient, 'apply')
    .mockImplementation(async () => {
      sequence.push('apply');
      return {
        definitionId: work.work.definition_id,
        versionId: work.work.definition_version_id,
      };
    });
  const pin = vi
    .spyOn(workDefinitionClient, 'pinVersion')
    .mockImplementation(async () => {
      sequence.push('pin');
      throw new Error('stop test before navigation');
    });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(
        <DefinitionPanel
          currentWorkVersionId={work.work.definition_version_id}
          editable
          originConversationId={null}
          selectedVersionId={work.work.definition_version_id}
          version={definitionVersion}
          workDefinitionId={work.work.definition_id}
          workId={work.work.id}
        />,
      );
    });
    const applyButton = [...host.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Apply new version'),
    );
    expect(applyButton).not.toBeUndefined();
    await act(async () => {
      applyButton!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(sequence).toEqual(['validate', 'plan', 'apply', 'pin']);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    validate.mockRestore();
    plan.mockRestore();
    apply.mockRestore();
    pin.mockRestore();
  }
});
