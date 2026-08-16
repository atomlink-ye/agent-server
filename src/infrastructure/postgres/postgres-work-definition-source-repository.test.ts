import { describe, expect, it } from 'vitest';

import { fingerprintWorkDefinitionSource } from '../../domain/work/work-definition-source.js';
import { PostgresWorkDefinitionSourceRepository } from './postgres-work-definition-source-repository.js';

const owner = {
  tenantId: 'tenant',
  workspaceId: '11111111-1111-4111-8111-111111111111',
  principalType: 'service_account',
  principalId: 'principal',
} as const;
const agentVersionId = '22222222-2222-4222-8222-222222222222';
const environmentVersionId = '33333333-3333-4333-8333-333333333333';

describe('PostgresWorkDefinitionSourceRepository', () => {
  it('accepts a jsonb key-order round trip when publishing a source', async () => {
    const source = {
      kind: 'single_agent' as const,
      agentVersionId,
      environmentVersionId,
      memoryVersionIds: [],
    };
    const repository = new PostgresWorkDefinitionSourceRepository({
      async query(sql: string) {
        if (sql.includes('FROM work_definition_source_definitions'))
          return {
            rows: [
              {
                id: 'definition',
                tenant_id: owner.tenantId,
                workspace_id: owner.workspaceId,
                principal_type: owner.principalType,
                principal_id: owner.principalId,
                name: 'Definition',
                description: null,
                created_at: '2026-08-16T00:00:00.000Z',
              },
            ],
          };
        if (sql.includes('FROM work_definition_source_versions'))
          return {
            rows: [
              {
                id: 'version',
                definition_id: 'definition',
                tenant_id: owner.tenantId,
                workspace_id: owner.workspaceId,
                principal_type: owner.principalType,
                principal_id: owner.principalId,
                status: 'published',
                // PostgreSQL jsonb returns keys in storage order, not author order.
                source: {
                  kind: 'single_agent',
                  agentVersionId,
                  memoryVersionIds: [],
                  environmentVersionId,
                },
                fingerprint: fingerprintWorkDefinitionSource(source),
                created_at: '2026-08-16T00:00:00.000Z',
                published_at: '2026-08-16T00:00:00.000Z',
              },
            ],
          };
        return { rows: [] };
      },
    });

    await expect(
      repository.publish({
        definitionId: 'definition',
        versionId: 'version',
        owner,
        name: 'Definition',
        description: null,
        source,
        fingerprint: fingerprintWorkDefinitionSource(source),
        now: '2026-08-16T00:00:00.000Z',
      }),
    ).resolves.toMatchObject({
      version: { id: 'version', source },
    });
  });
});
