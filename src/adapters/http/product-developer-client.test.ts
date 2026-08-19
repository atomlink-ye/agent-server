import { describe, expect, it, vi } from 'vitest';

import { ProductDeveloperClient } from './product-developer-client.js';

const definitionId = '11111111-1111-4111-8111-111111111111';
const definitionVersionId = '22222222-2222-4222-8222-222222222222';
const workId = '33333333-3333-4333-8333-333333333333';
const workRunId = '44444444-4444-4444-8444-444444444444';
const taskId = '55555555-5555-4555-8555-555555555555';
const workspaceId = '66666666-6666-4666-8666-666666666666';
const at = '2026-08-16T00:00:00.000Z';

const source = `apiVersion: agentserver.dev/v1alpha1
kind: WorkDefinition
metadata:
  name: quickstart
spec:
  kind: single_agent
  agent_version_id: 77777777-7777-4777-8777-777777777777
  environment_version_id: 88888888-8888-4888-8888-888888888888
`;

describe('ProductDeveloperClient', () => {
  it('composes Definition -> Work -> Run without exposing technical orchestration', async () => {
    const calls: Array<{
      url: string;
      method: string;
      body: unknown;
      idempotencyKey: string | null;
    }> = [];
    const request = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({
        url,
        method: init?.method ?? 'GET',
        body,
        idempotencyKey: headers.get('idempotency-key'),
      });
      if (url.endsWith('/api/v1/work-definitions:apply'))
        return jsonResponse(
          {
            result: 'created',
            definition: {
              id: definitionId,
              normalized_name: 'quickstart',
              description: null,
              created_at: at,
              latest_version_id: definitionVersionId,
              links: {
                self: `/api/v1/work-definitions/${definitionId}`,
                versions: `/api/v1/work-definitions/${definitionId}/versions`,
              },
            },
            version: {
              id: definitionVersionId,
              definition_id: definitionId,
              status: 'published',
              fingerprint: `sha256:${'a'.repeat(64)}`,
              source_yaml: source,
              source: {
                apiVersion: 'agentserver.dev/v1alpha1',
                kind: 'WorkDefinition',
              },
              resolved: {
                resource_manifest_fingerprint: `sha256:${'b'.repeat(64)}`,
              },
              created_at: at,
              published_at: at,
              links: {
                self: `/api/v1/work-definition-versions/${definitionVersionId}`,
                definition: `/api/v1/work-definitions/${definitionId}`,
              },
            },
            resolved: {
              resource_manifest_fingerprint: `sha256:${'b'.repeat(64)}`,
            },
          },
          201,
        );
      if (url.endsWith('/api/v1/works'))
        return jsonResponse(
          {
            work: {
              id: workId,
              tenant_id: 'tenant-1',
              workspace_id: workspaceId,
              definition_id: definitionId,
              definition_version_id: definitionVersionId,
              title: 'Quickstart work',
              origin: 'created',
              archived_at: null,
              created_at: at,
              updated_at: at,
            },
          },
          201,
        );
      if (url.endsWith(`/api/v1/works/${workId}/runs`))
        return jsonResponse(
          {
            work_run: {
              id: workRunId,
              work_id: workId,
              definition_version_id: definitionVersionId,
              trigger_kind: 'manual',
              trigger_ref: 'manual',
              expires_at: '2026-08-17T00:00:00.000Z',
              bound_at: at,
              created_at: at,
              updated_at: at,
            },
            execution_receipt: {
              reused: false,
              source_refs: { task_id: taskId },
            },
          },
          202,
        );
      throw new Error(`unexpected URL ${url}`);
    });

    const client = new ProductDeveloperClient({
      baseUrl: 'http://agent-server.test',
      token: 'token',
      fetch: request as typeof fetch,
    });
    const result = await client.runDefinition({
      source,
      title: 'Quickstart work',
      input: { question: 'Why durable identity?' },
      idempotencyKey: 'quickstart-apply-1',
    });

    expect(result.definition.id).toBe(definitionId);
    expect(result.version.id).toBe(definitionVersionId);
    expect(result.work.id).toBe(workId);
    expect(result.workRun.id).toBe(workRunId);
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      '/api/v1/work-definitions:apply',
      '/api/v1/works',
      `/api/v1/works/${workId}/runs`,
    ]);
    expect(calls[0]?.idempotencyKey).toBe('quickstart-apply-1');
    expect(calls[2]?.body).toMatchObject({
      trigger_kind: 'manual',
      input: { question: 'Why durable identity?' },
    });
    expect(JSON.stringify(result)).not.toContain('runtime_session');
    expect(JSON.stringify(result)).not.toContain('team_run');
  });
});

function jsonResponse(value: unknown, status: number): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
