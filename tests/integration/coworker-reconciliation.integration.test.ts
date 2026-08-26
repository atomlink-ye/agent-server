import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';

import { EnsureCoworkerConversation } from '../../src/application/chat/ensure-coworker-conversation.js';
import { ReconcileCoworkerConversations } from '../../src/application/chat/reconcile-coworker-conversations.js';
import { createManagedAgentDefinition } from '../../src/domain/agents/managed-agent-definition.js';
import { parseManagedAgentPackage } from '../../src/domain/agents/managed-agent-package.js';
import { createManagedAgentDraft } from '../../src/domain/agents/managed-agent-version.js';
import { PostgresAgentRegistry } from '../../src/infrastructure/postgres/postgres-agent-registry.js';
import { PostgresConversationRepository } from '../../src/infrastructure/postgres/postgres-conversation-repository.js';
import { PostgresConversationWorkEntitlementRepository } from '../../src/infrastructure/postgres/postgres-conversation-work-entitlement-repository.js';
import { applyDurableKernelMigrations } from '../../src/infrastructure/postgres/postgres.js';

const tenantId = 'tenant_coworker_reconcile';
const ownerWorkspaceId = '83000000-0000-4000-8000-000000000101';
const peerWorkspaceId = '83000000-0000-4000-8000-000000000102';
const ownerPrincipalId = 'svc_reconcile_owner';
const peerPrincipalId = 'svc_reconcile_peer';
const definitionId = '83000000-0000-4000-8000-000000000001';
const versionId = '84000000-0000-4000-8000-000000000001';
const now = () => new Date('2026-08-22T10:00:00.000Z');

let database: PGlite | undefined;

afterEach(async () => {
  await database?.close();
  database = undefined;
});

describe('published Coworker reconciliation', () => {
  it('backfills old published coworkers idempotently and grants Work only to the owner', async () => {
    database = new PGlite();
    await applyDurableKernelMigrations(database);
    for (const [workspaceId, principalId] of [
      [ownerWorkspaceId, ownerPrincipalId],
      [peerWorkspaceId, peerPrincipalId],
    ] as const) {
      await database.query(
        `INSERT INTO workspaces
           (id,tenant_id,principal_type,principal_id,name,created_at,updated_at)
         VALUES($1,$2,'service_account',$3,$4,$5,$5)`,
        [workspaceId, tenantId, principalId, principalId, now().toISOString()],
      );
    }

    const registry = new PostgresAgentRegistry(database);
    const definition = createManagedAgentDefinition({
      id: definitionId,
      tenantId,
      workspaceId: ownerWorkspaceId,
      principalType: 'service_account',
      principalId: ownerPrincipalId,
      normalizedName: 'legacy-published-coworker',
      displayName: 'Legacy Published Coworker',
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
      idempotencyKey: 'legacy-coworker-import',
      requestFingerprint: parsed.fingerprint,
      normalizedName: definition.normalizedName,
      definition,
      version: draft,
    });
    await registry.publishAgentVersion({
      owner: definition,
      idempotencyKey: 'legacy-coworker-publish',
      requestFingerprint: draft.fingerprint,
      versionId: draft.id,
    });

    expect(
      (
        await database.query<{ count: number }>(
          'SELECT COUNT(*)::int AS count FROM conversations WHERE tenant_id=$1',
          [tenantId],
        )
      ).rows[0]?.count,
    ).toBe(0);

    const provisioner = new EnsureCoworkerConversation(
      new PostgresConversationRepository(database),
      new PostgresConversationWorkEntitlementRepository(database),
    );
    const reconciler = new ReconcileCoworkerConversations(
      registry,
      provisioner,
    );

    await expect(
      reconciler.execute(access(ownerPrincipalId, ownerWorkspaceId)),
    ).resolves.toEqual({
      scanned: 1,
      converged: 1,
    });
    await expect(
      reconciler.execute(access(peerPrincipalId, peerWorkspaceId)),
    ).resolves.toEqual({
      scanned: 1,
      converged: 1,
    });
    await reconciler.execute(access(ownerPrincipalId, ownerWorkspaceId));

    const conversations = await database.query<{
      direct_pair_key: string;
      id: string;
    }>(
      `SELECT id,direct_pair_key FROM conversations
        WHERE tenant_id=$1 ORDER BY direct_pair_key ASC`,
      [tenantId],
    );
    expect(conversations.rows.map((row) => row.direct_pair_key)).toEqual([
      `direct:${tenantId}:${ownerPrincipalId}:${definitionId}`,
      `direct:${tenantId}:${peerPrincipalId}:${definitionId}`,
    ]);

    const entitlements = await database.query<{
      principal_id: string;
      workspace_id: string;
    }>(
      `SELECT principal_id,workspace_id FROM conversation_work_entitlements
        WHERE tenant_id=$1 ORDER BY principal_id ASC`,
      [tenantId],
    );
    expect(entitlements.rows).toEqual([
      {
        principal_id: ownerPrincipalId,
        workspace_id: ownerWorkspaceId,
      },
    ]);
  });
});

function access(principalId: string, workspaceId: string) {
  return {
    tenantId,
    workspaceId,
    principalType: 'service_account' as const,
    principalId,
    serviceAccountId: principalId,
    policySnapshotVersion: 'policy-coworker-reconcile',
  };
}

function source(): string {
  return `apiVersion: agent-server/v1alpha1
kind: ManagedAgent
metadata:
  name: Legacy Published Coworker
spec:
  description: Coworker that existed before Direct Chat provisioning.
  instructions: Discuss first and start formal Work when required.
  runtime:
    provider: paseo
    modelPolicyRef: free-only
    mode: isolated
  tools: []
  skills: []
  input:
    schema: { type: object, additionalProperties: false, properties: {} }
    prompt: hello
  session: { invocation: fresh_per_invocation, followUps: queued, binding: reusable }
  memory: { policy: workspace_snapshot, proposalLimit: 1 }
  permissions: { network: none, filesystem: none }
  completion: { type: executable, command: done }
`;
}
