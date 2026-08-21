import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

import { createManagedAgentDefinition } from '../../src/domain/agents/managed-agent-definition.js';
import { createManagedAgentDraft } from '../../src/domain/agents/managed-agent-version.js';
import { parseManagedAgentPackage } from '../../src/domain/agents/managed-agent-package.js';
import { applyDurableKernelMigrations } from '../../src/infrastructure/postgres/postgres.js';
import { PostgresAgentRegistry } from '../../src/infrastructure/postgres/postgres-agent-registry.js';
import { AgentNotFoundError } from '../../src/application/agents/errors.js';

const now = '2026-07-23T10:00:00.000Z';
const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
if (process.env.REAL_POSTGRES_REQUIRED === '1' && !connectionString) {
  throw new Error(
    'REAL_POSTGRES_REQUIRED=1 requires DATABASE_URL or POSTGRES_URL for the real PostgreSQL integration lane',
  );
}
const workspaceId = '10000000-0000-4000-8000-000000000000';

const serviceAccountOwner = {
  tenantId: 'tenant_user_principal',
  workspaceId,
  principalType: 'service_account',
  principalId: 'principal_sa_owner',
};

const userOwner = {
  tenantId: 'tenant_user_principal',
  workspaceId,
  principalType: 'user',
  principalId: 'human_reader',
};

const source = `apiVersion: agent-server/v1alpha1
kind: ManagedAgent
metadata:
  name: User Principal Test Agent
spec:
  description: test description
  instructions: test instructions
  runtime:
    provider: paseo
    modelPolicyRef: free-only
    mode: isolated
  tools: []
  skills: []
  input:
    schema:
      type: object
      additionalProperties: false
      properties: {}
    prompt: hello
  session:
    invocation: fresh_per_invocation
    followUps: queued
    binding: reusable
  memory:
    policy: workspace_snapshot
    proposalLimit: 1
  permissions:
    network: none
    filesystem: none
  completion:
    type: executable
    command: done
`;

async function database(): Promise<PGlite> {
  const db = new PGlite();
  await applyDurableKernelMigrations(db);
  return db;
}

describe('agent registry user principal authorization', () => {
  it('user principal can read definitions owned by a service account (tenant-wide read)', async () => {
    const db = await database();
    const registry = new PostgresAgentRegistry(db);
    const parsed = parseManagedAgentPackage(source);

    const definitionId = '00000000-0000-4000-8000-0000000d0001';
    const versionId = '00000000-0000-4000-8000-0000000d0101';

    const definition = createManagedAgentDefinition({
      ...serviceAccountOwner,
      normalizedName: 'user-principal-test-agent',
      displayName: 'User Principal Test Agent',
      id: definitionId,
      now: () => new Date(now),
    });

    const version = createManagedAgentDraft({
      definition,
      parsed,
      id: versionId,
      now: () => new Date(now),
    });

    // Service account imports and publishes an agent
    const imported = await registry.importAgent({
      owner: serviceAccountOwner,
      compatibilityWorkspaceId: workspaceId,
      idempotencyKey: 'import-user-principal-test',
      requestFingerprint: 'fp-user-principal-test-import',
      normalizedName: 'user-principal-test-agent',
      definition,
      version,
    });

    expect(imported.kind).toBe('created');

    const published = await registry.publishAgentVersion({
      owner: serviceAccountOwner,
      idempotencyKey: 'publish-user-principal-test',
      requestFingerprint: 'fp-user-principal-test-publish',
      versionId,
    });

    expect(published.status).toBe('published');

    // User principal CAN read the definition (tenant-wide read access)
    const userCanRead = await registry.findManagedDefinitionByTenant({
      tenantId: userOwner.tenantId,
      definitionId,
    });
    expect(userCanRead).not.toBeNull();
    expect(userCanRead?.id).toBe(definitionId);
    expect(userCanRead?.displayName).toBe('User Principal Test Agent');
  });

  it('user principal can list versions for a definition owned by a service account (tenant-wide read)', async () => {
    const db = await database();
    const registry = new PostgresAgentRegistry(db);
    const parsed = parseManagedAgentPackage(source);

    const definitionId = '00000000-0000-4000-8000-0000000d0002';
    const versionId = '00000000-0000-4000-8000-0000000d0102';

    const definition = createManagedAgentDefinition({
      ...serviceAccountOwner,
      normalizedName: 'user-principal-list-test',
      displayName: 'User Principal List Test',
      id: definitionId,
      now: () => new Date(now),
    });

    const version = createManagedAgentDraft({
      definition,
      parsed,
      id: versionId,
      now: () => new Date(now),
    });

    // Service account imports and publishes
    await registry.importAgent({
      owner: serviceAccountOwner,
      compatibilityWorkspaceId: workspaceId,
      idempotencyKey: 'import-list-test',
      requestFingerprint: 'fp-list-test-import',
      normalizedName: 'user-principal-list-test',
      definition,
      version,
    });

    await registry.publishAgentVersion({
      owner: serviceAccountOwner,
      idempotencyKey: 'publish-list-test',
      requestFingerprint: 'fp-list-test-publish',
      versionId,
    });

    // User principal CAN list versions (tenant-wide read access)
    const page = await registry.listVersionsByTenant({
      tenantId: userOwner.tenantId,
      command: {
        definitionId,
        cursor: null,
        limit: 10,
      },
    });

    expect(page).not.toBeNull();
    expect(page?.items).toHaveLength(1);
    expect(page?.items[0]?.id).toBe(versionId);
    expect(page?.items[0]?.status).toBe('published');
  });

  it('user principal cannot publish a service-account-owned version (principal-scoped write rejection)', async () => {
    const db = await database();
    const registry = new PostgresAgentRegistry(db);
    const parsed = parseManagedAgentPackage(source);

    const definitionId = '00000000-0000-4000-8000-0000000d0003';
    const versionId = '00000000-0000-4000-8000-0000000d0103';

    const definition = createManagedAgentDefinition({
      ...serviceAccountOwner,
      normalizedName: 'user-principal-publish-test',
      displayName: 'User Principal Publish Test',
      id: definitionId,
      now: () => new Date(now),
    });

    const version = createManagedAgentDraft({
      definition,
      parsed,
      id: versionId,
      now: () => new Date(now),
    });

    // Service account imports (leaving as draft, not published)
    await registry.importAgent({
      owner: serviceAccountOwner,
      compatibilityWorkspaceId: workspaceId,
      idempotencyKey: 'import-publish-test',
      requestFingerprint: 'fp-publish-test-import',
      normalizedName: 'user-principal-publish-test',
      definition,
      version,
    });

    // User principal CANNOT publish the service-account-owned version
    // (principal-scoped write gate rejects non-owner)
    await expect(
      registry.publishAgentVersion({
        owner: userOwner,
        idempotencyKey: 'publish-publish-test-user',
        requestFingerprint: 'fp-publish-test-user-publish',
        versionId,
      }),
    ).rejects.toThrow(AgentNotFoundError);
  });
});
