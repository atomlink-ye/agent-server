import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiTransport } from '@/api/transport';
import { WorkDefinitionClient } from './work-definition-client';

const fingerprint = `sha256:${'a'.repeat(64)}`;
const workerVersionId = '10000000-0000-4000-8000-000000000001';
const environmentVersionId = '20000000-0000-4000-8000-000000000001';
const definitionId = '11111111-1111-4111-8111-111111111111';
const versionId = '22222222-2222-4222-8222-222222222222';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('WorkDefinitionClient canonical Worker contract', () => {
  it('maps the shared single_worker plan into the browser view model', async () => {
    vi.spyOn(apiTransport, 'request').mockResolvedValue({
      valid: true,
      fingerprint,
      metadata: { normalized_name: 'research-work' },
      resolved: {
        kind: 'single_worker',
        participants: [
          {
            name: 'research-worker',
            role: 'primary',
            source: 'referenced',
            worker_version_id: workerVersionId,
            skills: [],
            tools: [],
          },
        ],
        environment: {
          source: 'referenced',
          environment_version_id: environmentVersionId,
        },
        memory_version_ids: [],
        required_runtime_capabilities: ['external_workspace'],
        platform_capabilities: [],
        materialization: {
          inline_workers: 0,
          inline_environment: false,
          internal_team: false,
        },
      },
      diagnostics: [],
    });

    const plan = await new WorkDefinitionClient().plan('source');

    expect(plan.resolved.kind).toBe('single_worker');
    expect(plan.resolved.participants).toEqual([
      {
        name: 'research-worker',
        role: 'primary',
        source: 'referenced',
        workerVersionId,
        skills: [],
        tools: [],
      },
    ]);
    expect(plan.resolved.environment.environmentVersionId).toBe(
      environmentVersionId,
    );
  });

  it('rejects the retired Agent-shaped Work plan instead of silently decoding it', async () => {
    vi.spyOn(apiTransport, 'request').mockResolvedValue({
      valid: true,
      fingerprint,
      metadata: { normalized_name: 'legacy-work' },
      resolved: {
        kind: 'single_agent',
        participants: [
          {
            name: 'legacy-agent',
            role: 'primary',
            source: 'referenced',
            agent_version_id: workerVersionId,
            skills: [],
            tools: [],
          },
        ],
        environment: {
          source: 'referenced',
          environment_version_id: environmentVersionId,
        },
        memory_version_ids: [],
        required_runtime_capabilities: [],
        platform_capabilities: [],
        materialization: {
          inline_workers: 0,
          inline_environment: false,
          internal_team: false,
        },
      },
      diagnostics: [],
    });

    await expect(new WorkDefinitionClient().plan('source')).rejects.toThrow();
  });
});

describe('Work Definition apply client mapping', () => {
  it('keeps distinct definition and version identities for Capability binding', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              result: 'created',
              definition: {
                id: definitionId,
                normalized_name: 'competitor-research',
                description: 'Research competitors.',
                created_at: '2026-08-26T00:00:00.000Z',
                latest_version_id: versionId,
                links: {
                  self: `/api/v1/work-definitions/${definitionId}`,
                  versions: `/api/v1/work-definitions/${definitionId}/versions`,
                },
              },
              version: {
                id: versionId,
                definition_id: definitionId,
                status: 'published',
                fingerprint: `sha256:${'a'.repeat(64)}`,
                source: { apiVersion: 'agentserver.dev/v1alpha1' },
                source_yaml: 'apiVersion: agentserver.dev/v1alpha1',
                resolved: {
                  resource_manifest_fingerprint: `sha256:${'b'.repeat(64)}`,
                },
                created_at: '2026-08-26T00:00:00.000Z',
                published_at: '2026-08-26T00:00:00.000Z',
                links: {
                  self: `/api/v1/work-definition-versions/${versionId}`,
                  definition: `/api/v1/work-definitions/${definitionId}`,
                },
              },
              resolved: {
                resource_manifest_fingerprint: `sha256:${'b'.repeat(64)}`,
              },
            }),
            { status: 201, headers: { 'content-type': 'application/json' } },
          ),
      ),
    );

    const result = await new WorkDefinitionClient().apply('generated source');
    expect(result).toEqual({ definitionId, versionId });
    expect(result.definitionId).not.toBe(result.versionId);
  });
});

describe('Work Definition catalog client', () => {
  it('keeps a published unbound Definition visible in the catalog', async () => {
    const source = {
      apiVersion: 'agentserver.dev/v1alpha1',
      kind: 'WorkDefinition',
      metadata: { name: 'Shared Research', description: 'Reusable brief.' },
      spec: { kind: 'single_worker' },
    };
    vi.spyOn(apiTransport, 'request').mockImplementation(async (path) => {
      if (path === '/api/work-definitions')
        return {
          items: [
            {
              definitionId,
              displayName: 'Shared Research',
              currentPublishedVersionId: versionId,
            },
          ],
        };
      if (path === `/api/work-definition-versions/${versionId}`)
        return {
          version: {
            id: versionId,
            definition_id: definitionId,
            status: 'published',
            fingerprint,
            source,
            source_yaml: 'kind: WorkDefinition',
            resolved: { resource_manifest_fingerprint: null },
            created_at: '2026-08-26T00:00:00.000Z',
            published_at: '2026-08-26T00:00:00.000Z',
            links: {
              self: `/api/v1/work-definition-versions/${versionId}`,
              definition: `/api/v1/work-definitions/${definitionId}`,
            },
          },
        };
      if (path === `/api/work-definitions/${definitionId}/agents`)
        return {
          definition_id: definitionId,
          definition_version_id: versionId,
          agents: [],
        };
      if (path === '/api/work-definitions/plan')
        return {
          valid: true,
          fingerprint,
          metadata: { normalized_name: 'shared-research' },
          resolved: {
            kind: 'single_worker',
            participants: [],
            environment: {
              source: 'referenced',
              environment_version_id: environmentVersionId,
            },
            memory_version_ids: [],
            required_runtime_capabilities: [],
            platform_capabilities: [],
            materialization: {
              inline_workers: 0,
              inline_environment: false,
              internal_team: false,
            },
          },
          diagnostics: [],
        };
      throw new Error(`unexpected request: ${String(path)}`);
    });

    const catalog = await new WorkDefinitionClient().listCatalog();
    expect(catalog).toHaveLength(1);
    expect(catalog[0]).toMatchObject({
      definitionId,
      definitionVersionId: versionId,
      name: 'Shared Research',
      description: 'Reusable brief.',
      availableTo: [],
    });
  });
});
