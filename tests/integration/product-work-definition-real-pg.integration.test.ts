import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { ProductWorkDefinitionApi } from '../../src/application/work/product-work-definition-api.js';
import { ResolveWorkDefinition } from '../../src/application/work/resolve-work-definition.js';
import { WorkIdentityApi } from '../../src/application/work/work-identity-api.js';
import { PostgresWorkDefinitionSourceRepository } from '../../src/infrastructure/postgres/postgres-work-definition-source-repository.js';
import { PostgresWorkIdentityRepository } from '../../src/infrastructure/postgres/postgres-work-identity-repository.js';
import {
  applyDurableKernelMigrations,
  createPostgresPool,
} from '../../src/infrastructure/postgres/postgres.js';
import type { AccessContext } from '../../src/domain/access-context.js';

const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
if (!connectionString)
  throw new Error(
    'real PostgreSQL integration requires DATABASE_URL or POSTGRES_URL',
  );

const tenantId = 'product_definition_real_pg_tenant';
const workspaceId = 'b1111111-1111-4111-8111-111111111111';
const principalId = 'product-definition-real-pg';
const agentVersionId = 'b2222222-2222-4222-8222-222222222222';
const environmentVersionId = 'b3333333-3333-4333-8333-333333333333';
const at = '2026-08-16T00:00:00.000Z';

const access: AccessContext = {
  tenantId,
  workspaceId,
  principalType: 'service_account',
  principalId,
  policySnapshotVersion: 'product-definition-real-pg-v1',
};
const foreignAccess: AccessContext = {
  ...access,
  principalId: 'product-definition-real-pg-foreign',
};

const SOURCE = `apiVersion: agentserver.dev/v1alpha1
kind: WorkDefinition
metadata:
  name: api-earnings-research
  description: Research an earnings event through the Product API.
spec:
  kind: single_agent
  agent_version_id: ${agentVersionId}
  environment_version_id: ${environmentVersionId}
  input_schema:
    type: object
    properties:
      symbol:
        type: string
    required: [symbol]
    additional_properties: false
`;

describe('Product Work Definition API persistence on real PostgreSQL', () => {
  let pool: Pool;
  const createdWorkIds: string[] = [];

  beforeAll(async () => {
    pool = createPostgresPool({
      connectionString: connectionString!,
      maxConnections: 2,
    });
    await applyDurableKernelMigrations(pool);
    await pool.query(
      `INSERT INTO workspaces
       (id,tenant_id,principal_type,principal_id,name,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$6)
       ON CONFLICT (id) DO UPDATE SET
         tenant_id=EXCLUDED.tenant_id,
         principal_type=EXCLUDED.principal_type,
         principal_id=EXCLUDED.principal_id,
         updated_at=EXCLUDED.updated_at`,
      [
        workspaceId,
        tenantId,
        access.principalType,
        principalId,
        'Product Definition PG',
        at,
      ],
    );
  });

  afterAll(async () => {
    if (createdWorkIds.length)
      await pool.query('DELETE FROM works WHERE id = ANY($1::uuid[])', [
        createdWorkIds,
      ]);
    await pool?.end();
  });

  it('applies, owner-isolates exact reads, converges versions, then creates Work', async () => {
    const sources = new PostgresWorkDefinitionSourceRepository(pool);
    const agentResolution = {
      async resolvePublished(id: string) {
        return id === agentVersionId
          ? ({
              source: 'managed',
              id,
              instructions: 'research the typed input',
              modelPolicyRef: 'free-only',
              proposalLimit: 0,
              skills: [],
              toolRefs: [],
            } as any)
          : null;
      },
    };
    const environmentRead = {
      async findVersion(_owner: unknown, id: string) {
        return id === environmentVersionId
          ? ({
              id,
              status: 'published',
              fingerprint: `sha256:${'e'.repeat(64)}`,
            } as any)
          : null;
      },
    };
    const resolver = new ResolveWorkDefinition({
      agents: {
        findDefinition: async () => null,
        findVersion: async () => null,
      } as any,
      agentResolution,
      definitions: {
        findTeamDefinitionById: async () => null,
        findPublishedTeamVersionById: async () => null,
      },
      environments: environmentRead,
      authoredDefinitions: sources,
      memories: { findVersion: async () => null },
    });
    const product = new ProductWorkDefinitionApi({
      repository: sources,
      resolver,
      agents: agentResolution,
      invokables: {
        saveTeamDefinition: async () => undefined,
        findTeamDefinitionById: async () => null,
        saveTeamVersion: async () => undefined,
        findTeamVersionById: async () => null,
      },
      environments: environmentRead as any,
      memories: { findVersion: async () => null },
      now: () => new Date(at),
    });

    const created = await product.apply({
      source: SOURCE,
      idempotencyKey: 'real-pg-apply-1',
      accessContext: access,
    });
    const replayed = await product.apply({
      source: SOURCE,
      idempotencyKey: 'real-pg-apply-1',
      accessContext: access,
    });
    const converged = await product.apply({
      source: SOURCE.replace('required: [symbol]', 'required:\n      - symbol'),
      idempotencyKey: 'real-pg-apply-2',
      accessContext: access,
    });
    const changed = await product.apply({
      source: SOURCE.replace(
        'Research an earnings event',
        'Research the next earnings event',
      ),
      idempotencyKey: 'real-pg-apply-3',
      accessContext: access,
    });

    expect(created.result).toBe('created');
    expect(replayed.result).toBe('replayed');
    expect(converged.result).toBe('converged');
    expect(replayed.version.version.id).toBe(created.version.version.id);
    expect(converged.version.version.id).toBe(created.version.version.id);
    expect(changed.version.version.id).not.toBe(created.version.version.id);
    expect(created.version.authorSource).toMatchObject({
      spec: { kind: 'single_agent', agent_version_id: agentVersionId },
    });
    expect(created.version.resolvedFingerprint).toMatch(
      /^sha256:[0-9a-f]{64}$/,
    );

    const exact = await product.getVersion({
      versionId: created.version.version.id,
      accessContext: access,
    });
    expect(exact.authorFingerprint).toBe(created.version.authorFingerprint);
    await expect(
      product.getVersion({
        versionId: created.version.version.id,
        accessContext: foreignAccess,
      }),
    ).rejects.toMatchObject({ code: 'work_definition_not_found' });

    const identity = new WorkIdentityApi({
      repository: new PostgresWorkIdentityRepository(pool),
      definitions: {
        findTeamDefinitionById: async () => null,
        findPublishedTeamVersionById: async () => null,
      },
      definitionResolution: resolver,
      now: () => new Date(at),
    });
    const work = await identity.createWork({
      owner: { tenantId, workspaceId },
      accessContext: access,
      definitionId: created.definition.id,
      definitionVersionId: created.version.version.id,
      title: 'Product Definition Real PG Work',
    });
    createdWorkIds.push(work.id);
    expect(work.definitionId).toBe(created.definition.id);
    expect(work.currentDefinitionVersionId).toBe(created.version.version.id);
  });
});
