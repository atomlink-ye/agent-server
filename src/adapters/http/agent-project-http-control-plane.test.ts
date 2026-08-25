import { afterEach, describe, expect, it, vi } from 'vitest';

import { AgentProjectHttpControlPlane } from './agent-project-http-control-plane.js';

const definitionId = '00000000-0000-4000-8000-000000000101';
const versionId = '00000000-0000-4000-8000-000000000102';
const fingerprint = `sha256:${'a'.repeat(64)}`;

afterEach(() => vi.unstubAllGlobals());

describe('Project Worker HTTP control plane', () => {
  it('uses the formal Worker lifecycle endpoints and returns immutable version pins', async () => {
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/v1/worker-packages:validate')
        return Response.json({
          valid: true,
          fingerprint,
          metadata: { normalized_name: 'project-worker' },
          compiler: {
            pattern_dialect: 're2',
            pattern_compiler_version: 're2js-2.8.6',
          },
        });
      if (path === '/api/v1/workers:import')
        return Response.json({
          result: 'created',
          worker: { id: definitionId },
          version: {
            id: versionId,
            definition_id: definitionId,
            fingerprint,
            status: 'draft',
          },
        });
      return Response.json({
        id: versionId,
        definition_id: definitionId,
        fingerprint,
        status: 'published',
      });
    });
    vi.stubGlobal('fetch', fetch);
    const controlPlane = new AgentProjectHttpControlPlane(
      'https://control.example/',
      'token',
      'workspace',
    );

    await expect(controlPlane.validateWorker('source')).resolves.toEqual({
      fingerprint,
    });
    await expect(
      controlPlane.importWorker('source', 'import-key'),
    ).resolves.toMatchObject({ definitionId, versionId, status: 'draft' });
    await expect(
      controlPlane.publishWorker(versionId, 'publish-key'),
    ).resolves.toMatchObject({ definitionId, versionId, status: 'published' });

    expect(
      fetch.mock.calls.map(([input]) => new URL(String(input)).pathname),
    ).toEqual([
      '/api/v1/worker-packages:validate',
      '/api/v1/workers:import',
      `/api/v1/worker-versions/${versionId}:publish`,
    ]);
  });
});
