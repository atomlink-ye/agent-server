import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { PostgresAgentRegistry } from '../../src/infrastructure/postgres/postgres-agent-registry.js';
import {
  applyDurableKernelMigrations,
  createPostgresPool,
} from '../../src/infrastructure/postgres/postgres.js';
import type { ManagedAgentOwner } from '../../src/domain/agents/managed-agent-owner.js';
import type { ImportAgentAtomicCommand } from '../../src/application/ports/agent-registry.js';
import { createManagedAgentDefinition } from '../../src/domain/agents/managed-agent-definition.js';
import { createManagedAgentDraft } from '../../src/domain/agents/managed-agent-version.js';
import { parseManagedAgentPackage } from '../../src/domain/agents/managed-agent-package.js';

const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
if (!connectionString)
  throw new Error(
    'real PostgreSQL integration requires DATABASE_URL or POSTGRES_URL',
  );

const tenantId = 'agent-multi-principal-test';
const workspaceId = 'c1111111-1111-4111-8111-111111111111';

const sa1: ManagedAgentOwner = {
  tenantId,
  workspaceId,
  principalType: 'service_account',
  principalId: 'sa1-multi-test',
};

const sa2: ManagedAgentOwner = {
  tenantId,
  workspaceId,
  principalType: 'service_account',
  principalId: 'sa2-multi-test',
};

const sa3: ManagedAgentOwner = {
  tenantId: 'agent-multi-principal-test-t2',
  workspaceId,
  principalType: 'service_account',
  principalId: 'sa3-multi-test',
};

const AGENT_PACKAGE_YAML = `apiVersion: agent-server/v1alpha1
kind: ManagedAgent
metadata:
  name: test-agent
spec:
  description: Test agent for multi-principal visibility
  instructions: You are a test agent.
  runtime:
    provider: paseo
    modelPolicyRef: free-only
    mode: isolated
  tools: []
  skills: []
  input:
    schema: { type: object, additionalProperties: false, properties: {} }
    prompt: test
  session: { invocation: fresh_per_invocation, followUps: queued, binding: reusable }
  memory: { policy: workspace_snapshot, proposalLimit: 0 }
  permissions: { network: none, filesystem: none }
  completion: { type: executable, command: done }
`;

describe('Multi-principal Agent Visibility on real PostgreSQL', () => {
  let pool: Pool;
  let registry: PostgresAgentRegistry;
  const createdDefinitionIds: string[] = [];

  beforeAll(async () => {
    pool = createPostgresPool({
      connectionString: connectionString!,
      maxConnections: 2,
    });
    await applyDurableKernelMigrations(pool);
    registry = new PostgresAgentRegistry(pool);

    // Set up workspaces
    for (const owner of [sa1, sa2, sa3]) {
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
          owner.workspaceId,
          owner.tenantId,
          owner.principalType,
          owner.principalId,
          `Workspace for ${owner.principalId}`,
          new Date().toISOString(),
        ],
      );
    }
  });

  afterAll(async () => {
    // Clean up created definitions (delete versions first due to foreign key)
    if (createdDefinitionIds.length) {
      const versionIds = await pool.query(
        'SELECT id FROM agent_versions WHERE definition_id = ANY($1::uuid[])',
        [createdDefinitionIds],
      );
      const ids = versionIds.rows?.map((r: any) => r.id) ?? [];
      if (ids.length) {
        await pool.query(
          'DELETE FROM agent_registry_idempotency WHERE version_id = ANY($1::uuid[])',
          [ids],
        );
      }
      await pool.query(
        'DELETE FROM agent_versions WHERE definition_id = ANY($1::uuid[])',
        [createdDefinitionIds],
      );
      await pool.query(
        'DELETE FROM agent_definitions WHERE id = ANY($1::uuid[])',
        [createdDefinitionIds],
      );
    }
    await pool?.end();
  });

  it('SA1 imports agent A, SA2 can GET the definition and version (cross-principal read visibility)', async () => {
    // SA1 imports agent A
    const definitionId = 'a0000000-0000-4000-8000-000000000001';
    const versionId = 'a1111111-1111-4111-8111-111111111111';

    const definition = createManagedAgentDefinition({
      ...sa1,
      normalizedName: 'test-agent-a',
      displayName: 'Test Agent A',
      id: definitionId,
      now: () => new Date('2026-01-01T00:00:00Z'),
    });

    const parsed = parseManagedAgentPackage(AGENT_PACKAGE_YAML);
    const version = createManagedAgentDraft({
      definition,
      parsed,
      id: versionId,
      now: () => new Date('2026-01-01T00:00:00Z'),
    });

    const importCommand: ImportAgentAtomicCommand = {
      owner: sa1,
      compatibilityWorkspaceId: sa1.workspaceId,
      idempotencyKey: 'import-agent-a-1',
      requestFingerprint: parsed.fingerprint,
      normalizedName: 'test-agent-a',
      definition,
      version,
    };

    await registry.importAgent(importCommand);
    createdDefinitionIds.push(definitionId);

    // Positive: SA2 should be able to GET the definition
    const def = await registry.findDefinition(sa2, definitionId);
    expect(def).toBeDefined();
    expect(def?.id).toBe(definitionId);
    expect(def?.displayName).toBe('Test Agent A');

    // Positive: SA2 should be able to GET the version
    const ver = await registry.findVersion(sa2, versionId);
    expect(ver).toBeDefined();
    expect(ver?.id).toBe(versionId);
    expect(ver?.definitionId).toBe(definitionId);
  });

  it('SA2 cannot import/publish to a definition owned by SA1', async () => {
    // Use the definition from previous test
    const definitionId = 'a0000000-0000-4000-8000-000000000001';
    const versionId = 'a1111111-1111-4111-8111-111111111111';

    // Try to publish: SA2 tries to publish a version owned by SA1 (should fail)
    const publishCommand = {
      owner: sa2, // Different owner!
      idempotencyKey: 'publish-attempt-by-sa2',
      requestFingerprint: 'sha256:def456',
      versionId,
    };

    // This should throw AgentNotFoundError because SA2 doesn't own the version
    // (write authorization still enforces principal ownership)
    try {
      await registry.publishAgentVersion(publishCommand);
      // If we get here, something is wrong - SA2 should not be able to publish SA1's version
      expect.fail(
        'SA2 should not be able to publish a version owned by SA1',
      );
    } catch (err: any) {
      expect(err.constructor.name).toBe('AgentNotFoundError');
    }
  });

  it('SA3 in different tenant T2 cannot GET definition from tenant T1 (404, no info leak)', async () => {
    const definitionId = 'a0000000-0000-4000-8000-000000000001';

    // SA3 is in a different tenant, should not see SA1's definition
    const def = await registry.findDefinition(sa3, definitionId);
    expect(def).toBeNull();
  });
});
