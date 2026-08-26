import { afterEach, describe, expect, it, vi } from 'vitest';

import { WorkDefinitionClient } from './work-definition-client';

const definitionId = '11111111-1111-4111-8111-111111111111';
const versionId = '22222222-2222-4222-8222-222222222222';

afterEach(() => vi.unstubAllGlobals());

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
