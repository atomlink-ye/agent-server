import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';

import { EnsureCoworkerConversation } from '../../src/application/chat/ensure-coworker-conversation.js';
import { createManagedAgentDefinition } from '../../src/domain/agents/managed-agent-definition.js';
import { parseManagedAgentPackage } from '../../src/domain/agents/managed-agent-package.js';
import { createManagedAgentDraft } from '../../src/domain/agents/managed-agent-version.js';
import { PostgresAgentRegistry } from '../../src/infrastructure/postgres/postgres-agent-registry.js';
import { PostgresConversationRepository } from '../../src/infrastructure/postgres/postgres-conversation-repository.js';
import { PostgresConversationWorkEntitlementRepository } from '../../src/infrastructure/postgres/postgres-conversation-work-entitlement-repository.js';
import { applyDurableKernelMigrations } from '../../src/infrastructure/postgres/postgres.js';

const tenantId = 'tenant_coworker_provisioning';
const workspaceId = '81000000-0000-4000-8000-000000000101';
const ownerPrincipalId = 'svc_coworker_owner';
const sharedPrincipalId = 'svc_coworker_peer';
const definitionId = '81000000-0000-4000-8000-000000000001';
const versionId = '82000000-0000-4000-8000-000000000001';
const now = () => new Date('2026-08-22T09:00:00.000Z');

let database: PGlite | undefined;

afterEach(async () => {
  await database?.close();
  database = undefined;
});

describe('Cumora-style Coworker lifecycle provisioning', () => {
  it('lists Coworkers only in the authenticated workspace and principal scope', async () => {
    database = new PGlite();
    await applyDurableKernelMigrations(database);
    const owner = {
      tenantId,
      workspaceId,
      principalType: 'service_account',
      principalId: ownerPrincipalId,
    } as const;
    const foreign = {
      tenantId,
      workspaceId: '81000000-0000-4000-8000-000000000102',
      principalType: 'service_account',
      principalId: sharedPrincipalId,
    } as const;
    const rows = [
      {
        id: '83000000-0000-4000-8000-000000000101',
        owner,
        name: 'Owner Coworker',
      },
      {
        id: '83000000-0000-4000-8000-000000000102',
        owner: foreign,
        name: 'Foreign Coworker',
      },
    ];
    for (const row of rows) {
      await database.query(
        `INSERT INTO agent_definitions
           (id,tenant_id,workspace_id,principal_type,principal_id,name,managed_discriminator,normalized_name,created_at,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,'managed_agent_v1',$7,$8,$8)`,
        [
          row.id,
          row.owner.tenantId,
          row.owner.workspaceId,
          row.owner.principalType,
          row.owner.principalId,
          row.name,
          row.name.toLowerCase().replace(' ', '-'),
          now().toISOString(),
        ],
      );
      await database.query(
        `INSERT INTO agent_chat_runtimes
           (tenant_id,agent_definition_id,active_agent_version_id,epoch,status,created_at,updated_at)
         VALUES($1,$2,$3,1,'available',$4,$4)`,
        [row.owner.tenantId, row.id, row.id, now().toISOString()],
      );
    }

    const registry = new PostgresAgentRegistry(database);
    const page = await registry.listManagedDefinitionsForOwner({
      owner,
      command: { cursor: null, limit: 20 },
    });

    expect(page.items.map((item) => item.definition.id)).toEqual([rows[0]!.id]);
  });

  it('keeps a migrated Work-internal Agent out of the Coworker roster', async () => {
    database = new PGlite();
    await applyDurableKernelMigrations(database);
    const legacyDefinitionId = '83000000-0000-4000-8000-000000000001';
    const legacyVersionId = '84000000-0000-4000-8000-000000000001';
    await database.query(
      `INSERT INTO agent_definitions
       (id,tenant_id,workspace_id,principal_type,principal_id,name,managed_discriminator,normalized_name,created_at,updated_at)
       VALUES($1,$2,$3,'service_account',$4,'Legacy Work Worker','managed_agent_v1','legacy-work-worker',$5,$5)`,
      [
        legacyDefinitionId,
        tenantId,
        workspaceId,
        ownerPrincipalId,
        now().toISOString(),
      ],
    );
    await database.query(
      `INSERT INTO agent_versions
       (id,definition_id,tenant_id,workspace_id,principal_type,principal_id,status,name,instructions,managed_discriminator,canonical_package,fingerprint,pattern_metadata,compiler_metadata,policy_snapshot,reference_snapshot,tool_skill_snapshot,validation_report,compiled_package,execution_snapshot,created_at,updated_at,published_at)
       VALUES($1,$2,$3,$4,'service_account',$5,'published','Legacy Work Worker','execute','managed_agent_v1','{"kind":"ManagedAgent","spec":{"tools":[],"skills":[],"runtime":{"modelPolicyRef":"free-only"}}}',$6,'{}','{}','{}','{}','{}','{}','{}','{}',$7,$7,$7)`,
      [
        legacyVersionId,
        legacyDefinitionId,
        tenantId,
        workspaceId,
        ownerPrincipalId,
        'a'.repeat(64),
        now().toISOString(),
      ],
    );
    await database.query(
      `INSERT INTO worker_definitions (id,tenant_id,workspace_id,principal_type,principal_id,name,normalized_name,description,created_at,updated_at)
       VALUES($1,$2,$3,'service_account',$4,'Legacy Work Worker','legacy-work-worker',NULL,$5,$5)
       ON CONFLICT DO NOTHING`,
      [
        legacyDefinitionId,
        tenantId,
        workspaceId,
        ownerPrincipalId,
        now().toISOString(),
      ],
    );
    await database.query(
      `INSERT INTO worker_versions (id,definition_id,tenant_id,workspace_id,principal_type,principal_id,status,name,description,instructions,canonical_package,fingerprint,compiler_metadata,created_at,updated_at,published_at)
       VALUES($1,$2,$3,$4,'service_account',$5,'published','Legacy Work Worker',NULL,'execute','{"kind":"Worker","spec":{"tools":[],"skills":[],"runtime":{"modelPolicyRef":"free-only"}}}',$6,'{}',$7,$7,$7)
       ON CONFLICT DO NOTHING`,
      [
        legacyVersionId,
        legacyDefinitionId,
        tenantId,
        workspaceId,
        ownerPrincipalId,
        'a'.repeat(64),
        now().toISOString(),
      ],
    );
    await database.query(
      `INSERT INTO agent_chat_runtimes
       (tenant_id,agent_definition_id,active_agent_version_id,epoch,status,created_at,updated_at)
       VALUES($1,$2,$3,1,'available',$4,$4)`,
      [tenantId, legacyDefinitionId, legacyVersionId, now().toISOString()],
    );
    await database.query(
      `INSERT INTO agent_identity_classes
       (tenant_id,agent_definition_id,identity_class,created_at,updated_at)
       VALUES($1,$2,'legacy_work_internal',$3,$3)
       ON CONFLICT (tenant_id,agent_definition_id) DO UPDATE
         SET identity_class='legacy_work_internal',updated_at=EXCLUDED.updated_at`,
      [tenantId, legacyDefinitionId, now().toISOString()],
    );
    const registry = new PostgresAgentRegistry(database);
    const roster = await registry.listManagedDefinitionsByTenant({
      tenantId,
      command: { cursor: null, limit: 20 },
    });
    expect(roster.items).toEqual([]);
  });

  it('lists published Coworkers, reuses the Direct Chat, and auto-binds Work only for the unambiguous owner', async () => {
    database = new PGlite();
    await applyDurableKernelMigrations(database);
    await database.query(
      `INSERT INTO workspaces
         (id,tenant_id,principal_type,principal_id,name,created_at,updated_at)
       VALUES($1,$2,'service_account',$3,$4,$5,$5)`,
      [
        workspaceId,
        tenantId,
        ownerPrincipalId,
        'Coworker Workspace',
        now().toISOString(),
      ],
    );

    const registry = new PostgresAgentRegistry(database);
    const definition = createManagedAgentDefinition({
      id: definitionId,
      tenantId,
      workspaceId,
      principalType: 'service_account',
      principalId: ownerPrincipalId,
      normalizedName: 'research-coworker',
      displayName: 'Research Coworker',
      roleLabel: 'Researcher',
      summary: 'Finds evidence and starts formal Work when needed.',
      now,
    });
    const parsed = parseManagedAgentPackage(source());
    const draft = createManagedAgentDraft({
      definition,
      parsed,
      id: versionId,
      now,
    });
    await registry.importAgent({
      owner: definition,
      compatibilityWorkspaceId: workspaceId,
      idempotencyKey: 'coworker-import',
      requestFingerprint: parsed.fingerprint,
      normalizedName: definition.normalizedName,
      definition,
      version: draft,
    });
    const published = await registry.publishAgentVersion({
      owner: definition,
      idempotencyKey: 'coworker-publish',
      requestFingerprint: draft.fingerprint,
      versionId: draft.id,
    });

    const roster = await registry.listManagedDefinitionsByTenant({
      tenantId,
      command: { cursor: null, limit: 20 },
    });
    expect(roster).toEqual({
      items: [
        {
          definition: expect.objectContaining({
            id: definitionId,
            displayName: 'Research Coworker',
            roleLabel: 'Researcher',
            summary: 'Finds evidence and starts formal Work when needed.',
          }),
          activeAgentVersionId: published.id,
          runtimeStatus: 'available',
        },
      ],
      nextCursor: null,
    });

    const conversations = new PostgresConversationRepository(database);
    const entitlements = new PostgresConversationWorkEntitlementRepository(
      database,
    );
    const provisioner = new EnsureCoworkerConversation(
      conversations,
      entitlements,
    );
    const ownerAccess = access(ownerPrincipalId, workspaceId);

    const first = await provisioner.execute({
      accessContext: ownerAccess,
      definition,
    });
    const replay = await provisioner.execute({
      accessContext: ownerAccess,
      definition,
    });
    expect(replay.conversation.id).toBe(first.conversation.id);
    expect(first.workEntitlement).toMatchObject({
      conversationId: first.conversation.id,
      workspaceId,
      principalId: ownerPrincipalId,
    });
    expect(replay.workEntitlement).toMatchObject({
      conversationId: first.conversation.id,
      workspaceId,
      principalId: ownerPrincipalId,
    });

    const ownerConversationCount = await database.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
         FROM conversations
        WHERE tenant_id=$1 AND direct_pair_key=$2`,
      [tenantId, `direct:${tenantId}:${ownerPrincipalId}:${definitionId}`],
    );
    expect(ownerConversationCount.rows[0]?.count).toBe(1);
    const entitlementCount = await database.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
         FROM conversation_work_entitlements
        WHERE tenant_id=$1 AND conversation_id=$2`,
      [tenantId, first.conversation.id],
    );
    expect(entitlementCount.rows[0]?.count).toBe(1);

    const shared = await provisioner.execute({
      accessContext: access(sharedPrincipalId, 'workspace-not-owned-by-peer'),
      definition,
    });
    expect(shared.conversation.id).not.toBe(first.conversation.id);
    expect(shared.workEntitlement).toBeNull();
    const sharedEntitlementCount = await database.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
         FROM conversation_work_entitlements
        WHERE tenant_id=$1 AND conversation_id=$2`,
      [tenantId, shared.conversation.id],
    );
    expect(sharedEntitlementCount.rows[0]?.count).toBe(0);
  });
});

function access(principalId: string, accessWorkspaceId: string) {
  return {
    tenantId,
    workspaceId: accessWorkspaceId,
    principalType: 'service_account' as const,
    principalId,
    serviceAccountId: principalId,
    policySnapshotVersion: 'policy-coworker-test',
  };
}

function source(): string {
  return `apiVersion: agent-server/v1alpha1
kind: ManagedAgent
metadata:
  name: Research Coworker
spec:
  description: Research coworker capability
  instructions: Discuss first; start formal Work for durable execution.
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
}
