import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AccessContext } from '../../src/application/control-plane/access-context.js';
import type { ChannelOutboxInput } from '../../src/domain/channels/channel-delivery.js';
import type { ChannelIngressInput } from '../../src/domain/channels/channel-event.js';
import { GetTask } from '../../src/application/tasks/get-task.js';
import { InvokeTask } from '../../src/application/tasks/invoke-task.js';
import { createAgentDefinition } from '../../src/domain/invokables/agent-definition.js';
import {
  createDraftAgentVersion,
  publishAgentVersion,
} from '../../src/domain/invokables/agent-version.js';
import {
  applyDurableKernelMigrations,
  createPostgresPool,
} from '../../src/infrastructure/postgres/postgres.js';
import { PostgresAdmissionRepository } from '../../src/infrastructure/postgres/postgres-admission-repository.js';
import { PostgresChannelRepository } from '../../src/infrastructure/postgres/postgres-channel-repository.js';
import { PostgresInvokableRepository } from '../../src/infrastructure/postgres/postgres-invokable-repository.js';
import { PostgresTaskRepository } from '../../src/infrastructure/postgres/postgres-task-repository.js';
import { PostgresSessionRepository } from '../../src/infrastructure/postgres/postgres-session-repository.js';
import { ResolveLarkBinding } from '../../src/application/channels/resolve-lark-binding.js';
import { sha256Preview } from '../../src/domain/channels/lark-memory-review-surface.js';
import type { LarkMemoryReviewSurface } from '../../src/domain/channels/lark-memory-review-surface.js';
import { PostgresLarkReviewSurfaceRepository } from '../../src/infrastructure/postgres/postgres-lark-review-surface-repository.js';

const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
const required = process.env.REAL_POSTGRES_REQUIRED === '1';

if (required && !connectionString) {
  throw new Error(
    'REAL_POSTGRES_REQUIRED=1 requires DATABASE_URL or POSTGRES_URL for the real PostgreSQL integration lane',
  );
}

const describeRealPostgres = connectionString ? describe : describe.skip;

const owner: AccessContext = {
  tenantId: 'real_pg_admission_test',
  workspaceId: 'real_pg_workspace',
  principalType: 'service_account',
  principalId: 'real_pg_owner',
  policySnapshotVersion: 'real-pg-policy-v1',
};
const agentDefinitionId = '00000000-0000-4000-8000-0000000a1001';
const agentVersionId = '00000000-0000-4000-8000-0000000a1101';

describeRealPostgres('real PostgreSQL admission pool', () => {
  const pool = connectionString
    ? createPostgresPool({ connectionString, maxConnections: 2 })
    : null;
  const readerPool = connectionString
    ? createPostgresPool({ connectionString, maxConnections: 2 })
    : null;
  const invoke = pool
    ? new InvokeTask(
        new PostgresAdmissionRepository(pool),
        // Keep the pre-admission published-version lookup off the two
        // transaction connections used by the admission pool.
        new PostgresInvokableRepository(readerPool!),
        () => new Date('2026-07-23T12:00:00.000Z'),
      )
    : null;

  beforeAll(async () => {
    if (!pool) return;

    await applyDurableKernelMigrations(pool);
    await cleanTestRows(pool);

    const definition = createAgentDefinition({
      id: agentDefinitionId,
      ...owner,
      name: 'Real PostgreSQL admission agent',
      description: 'Admission integration fixture',
      now: () => new Date('2026-07-23T11:00:00.000Z'),
    });
    const version = publishAgentVersion(
      createDraftAgentVersion({
        id: agentVersionId,
        definitionId: definition.id,
        ...owner,
        name: 'Real PostgreSQL admission agent v1',
        description: 'Published admission integration fixture',
        instructions: 'Return the input unchanged.',
        now: () => new Date('2026-07-23T11:00:00.000Z'),
      }),
      () => new Date('2026-07-23T11:05:00.000Z'),
    );
    const invokables = new PostgresInvokableRepository(pool);
    await invokables.saveAgentDefinition(definition);
    await invokables.saveAgentVersion(version);
  });

  afterAll(async () => {
    await Promise.all([pool?.end(), readerPool?.end()]);
  });

  it('commits an invocation and reloads the task and run through a separate pool connection', async () => {
    const result = await invoke!.execute({
      idempotencyKey: 'real-pg-first-invocation',
      invokable: { kind: 'agent', versionId: agentVersionId },
      input: { text: 'first real postgres prompt' },
      accessContext: owner,
    });

    expect(result.reused).toBe(false);
    const loaded = await new GetTask(
      new PostgresTaskRepository(readerPool!),
    ).execute(result.task.task.id, owner);

    expect(loaded).toMatchObject({
      task: {
        id: result.task.task.id,
        tenantId: owner.tenantId,
        workspaceId: owner.workspaceId,
        principalId: owner.principalId,
      },
      latestRun: {
        runId: result.task.latestRun?.runId,
        status: 'queued',
      },
    });
  });

  it('persists review surfaces with exact replay, owner isolation, CAS, and immutable resolution', async () => {
    const database = pool!;
    const repository = new PostgresLarkReviewSurfaceRepository(database);
    const proposalId = '00000000-0000-4000-8000-00000000a901';
    const bindingId = 'real-pg-task9-binding';
    const workspaceRowId = '00000000-0000-4000-8000-00000000a902';
    const sessionId = '00000000-0000-4000-8000-00000000a903';
    const creatingIngressId = 'real-pg-task9-create';
    const commandIngressId = 'real-pg-task9-command';
    const previewIngressId = 'real-pg-task9-preview';
    const resolvingIngressId = 'real-pg-task9-resolve';
    const connectionKey = 'real-pg-task9';
    const ownerScope = {
      tenantId: owner.tenantId,
      workspaceId: owner.workspaceId,
      principalType: owner.principalType,
      principalId: owner.principalId,
    };
    const makeSurface = (
      overrides: Partial<LarkMemoryReviewSurface> = {},
    ): LarkMemoryReviewSurface => ({
      id: 'real-pg-task9-surface-1',
      ...ownerScope,
      proposalId,
      bindingId,
      version: 1,
      mode: 'card_with_doc',
      status: 'active_card_with_doc',
      cardMessageId: 'real-pg-task9-card-1',
      docToken: 'real-pg-task9-doc-1',
      docRevision: 'real-pg-task9-revision-1',
      previewContent: null,
      previewSha256: null,
      actionTokenHash: '1'.repeat(64),
      creatingIngressId,
      resolvingIngressId: null,
      createdAt: '2026-07-25T00:00:00.000Z',
      updatedAt: '2026-07-25T00:00:00.000Z',
      ...overrides,
    });

    try {
      await database.query(
        `INSERT INTO workspaces(id, tenant_id, principal_type, principal_id, name, created_at, updated_at)
         VALUES ($1,$2,$3,$4,'Task 9 review workspace',now(),now())`,
        [
          workspaceRowId,
          owner.tenantId,
          owner.principalType,
          owner.principalId,
        ],
      );
      await database.query(
        `INSERT INTO product_sessions(id, workspace_id, tenant_id, principal_type, principal_id, published_agent_version_id, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,'task9-agent',now(),now())`,
        [
          sessionId,
          workspaceRowId,
          owner.tenantId,
          owner.principalType,
          owner.principalId,
        ],
      );
      await database.query(
        `INSERT INTO workspace_memory_proposals
          (id, tenant_id, workspace_id, principal_type, principal_id, original_content,
           original_category, source_session_id, proposer_snapshot, status, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,'Task 9 proposal','constraint',$6,'{}','pending',now(),now())`,
        [
          proposalId,
          owner.tenantId,
          owner.workspaceId,
          owner.principalType,
          owner.principalId,
          sessionId,
        ],
      );
      await database.query(
        `INSERT INTO channel_ingress_events
          (id, connection_key, kind, external_key, external_message_id, chat_id, root_message_id, normalization_version)
         VALUES ($1,$2,'message','real-pg-task9-message','real-pg-task9-root','real-pg-task9-chat',NULL,'lark-v1'),
                 ($3,$2,'command','real-pg-task9-command','real-pg-task9-command-id','real-pg-task9-chat','real-pg-task9-root','lark-v1'),
                 ($4,$2,'card_action','real-pg-task9-action','real-pg-task9-card-1','real-pg-task9-chat',NULL,'lark-v1')`,
        [
          creatingIngressId,
          connectionKey,
          commandIngressId,
          resolvingIngressId,
        ],
      );
      await database.query(
        `INSERT INTO channel_ingress_events
          (id, connection_key, kind, external_key, external_message_id, chat_id, root_message_id,
           external_actor_id, action, normalization_version, status, attempt_count, lease_owner, lease_expires_at)
         VALUES ($1,$2,'card_action','real-pg-task9-preview','real-pg-task9-card-1','real-pg-task9-chat',NULL,
                 'real-pg-task9-actor',$3,'lark-v1','processing',1,'real-pg-task9-worker',now()+interval '1 minute')`,
        [
          previewIngressId,
          connectionKey,
          JSON.stringify({ action: 'preview_doc', digest: '2'.repeat(64) }),
        ],
      );
      await database.query(
        `INSERT INTO channel_conversation_bindings
          (id, connection_key, chat_id, root_message_id, session_id, creating_ingress_id)
         VALUES ($1,$2,'real-pg-task9-chat','real-pg-task9-root',$3,$4)`,
        [bindingId, connectionKey, sessionId, creatingIngressId],
      );

      const first = await repository.createSurface(makeSurface());
      await expect(
        repository.createSurface(makeSurface()),
      ).resolves.toMatchObject({ id: first.id });
      const contentionProposalId = '00000000-0000-4000-8000-00000000a905';
      await database.query(
        `INSERT INTO workspace_memory_proposals(id, tenant_id, workspace_id, principal_type, principal_id, original_content, original_category, source_session_id, proposer_snapshot, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,'contention','constraint',$6,'{}','pending',now(),now())`,
        [
          contentionProposalId,
          owner.tenantId,
          owner.workspaceId,
          owner.principalType,
          owner.principalId,
          sessionId,
        ],
      );
      const contentionSurface = await repository.createSurface(
        makeSurface({
          id: 'contention-surface',
          proposalId: contentionProposalId,
          creatingIngressId: commandIngressId,
          actionTokenHash: '6'.repeat(64),
        }),
      );
      const contentionLockClient = await database.connect();
      await contentionLockClient.query('BEGIN');
      await contentionLockClient.query(
        'SELECT id FROM workspace_memory_proposals WHERE id = $1 FOR UPDATE',
        [contentionProposalId],
      );
      const contention = Promise.allSettled([
        new PostgresLarkReviewSurfaceRepository(database).claimActiveVersion({
          surface: makeSurface({
            id: 'contention-replacement',
            proposalId: contentionProposalId,
            version: 2,
            creatingIngressId: commandIngressId,
            actionTokenHash: '7'.repeat(64),
          }),
          expectedActiveVersion: 1,
        }),
        new PostgresLarkReviewSurfaceRepository(database).resolveSurface({
          id: contentionSurface.id,
          owner: ownerScope,
          version: 1,
          ingressId: resolvingIngressId,
          now: '2026-07-25T00:07:00.000Z',
        }),
      ]);
      await contentionLockClient.query('COMMIT');
      contentionLockClient.release();
      const contentionResult = await Promise.race([
        contention,
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('claim/resolve contention timeout')),
            5000,
          ),
        ),
      ]);
      expect(
        contentionResult.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      const contentionActiveCount = await database.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM lark_memory_review_surfaces WHERE proposal_id = $1 AND status IN ('planned','publishing','active_card','active_card_with_doc','command_only','processing')",
        [contentionProposalId],
      );
      expect(contentionActiveCount.rows[0]?.count).toBeLessThanOrEqual(1);
      await expect(
        repository.createSurface(makeSurface({ id: 'real-pg-task9-conflict' })),
      ).rejects.toThrow('logical conflict');
      await expect(
        repository.getSurface(first.id, {
          ...ownerScope,
          tenantId: 'other-tenant',
        }),
      ).resolves.toBeNull();
      await expect(
        repository.getSurfaceByActionTokenHash({
          actionTokenHash: '1'.repeat(64),
          owner: ownerScope,
        }),
      ).resolves.toMatchObject({ id: first.id });
      await expect(
        repository.createSurface(
          makeSurface({
            id: 'real-pg-task9-surface-2',
            version: 2,
            creatingIngressId: commandIngressId,
            actionTokenHash: '2'.repeat(64),
          }),
        ),
      ).rejects.toThrow();

      const second = await repository.claimActiveVersion({
        surface: makeSurface({
          id: 'real-pg-task9-surface-2',
          version: 2,
          creatingIngressId: commandIngressId,
          actionTokenHash: '2'.repeat(64),
          updatedAt: '2026-07-25T00:01:00.000Z',
        }),
        expectedActiveVersion: 1,
      });
      expect(second.version).toBe(2);
      await expect(
        repository.claimActiveVersion({
          surface: makeSurface({
            id: 'real-pg-task9-surface-3',
            version: 3,
            creatingIngressId: commandIngressId,
            actionTokenHash: '3'.repeat(64),
          }),
          expectedActiveVersion: 1,
        }),
      ).rejects.toThrow('stale');

      const content = 'immutable real PostgreSQL preview ✓';
      const preview = await repository.savePreview({
        id: second.id,
        owner: ownerScope,
        content,
        sha256: sha256Preview(content),
        creatingIngressId: previewIngressId,
        now: '2026-07-25T00:02:00.000Z',
      });
      expect(preview).toMatchObject({
        previewContent: content,
        previewSha256: sha256Preview(content),
      });
      await expect(
        repository.savePreview({
          id: preview.id,
          owner: ownerScope,
          content: 'late edit',
          sha256: sha256Preview('late edit'),
          creatingIngressId: previewIngressId,
          now: '2026-07-25T00:03:00.000Z',
        }),
      ).rejects.toThrow('immutable');
      await expect(
        repository.resolveSurface({
          id: preview.id,
          owner: ownerScope,
          version: preview.version,
          ingressId: resolvingIngressId,
          now: '2026-07-25T00:04:00.000Z',
        }),
      ).resolves.toMatchObject({ status: 'resolved', resolvingIngressId });
      await expect(
        repository.resolveSurface({
          id: preview.id,
          owner: ownerScope,
          version: preview.version,
          ingressId: resolvingIngressId,
          now: '2026-07-25T00:05:00.000Z',
        }),
      ).resolves.toMatchObject({ status: 'resolved', resolvingIngressId });
      await expect(
        database.query(
          "INSERT INTO lark_memory_review_surfaces (id,tenant_id,workspace_id,principal_type,principal_id,proposal_id,binding_id,version,mode,status,action_token_hash,creating_ingress_id,created_at,updated_at) VALUES ('real-pg-task9-invalid',$1,$2,$3,$4,'00000000-0000-4000-8000-00000000a999',$5,1,'card','active_card',$6,$7,now(),now())",
          [
            owner.tenantId,
            owner.workspaceId,
            owner.principalType,
            owner.principalId,
            bindingId,
            '4'.repeat(64),
            creatingIngressId,
          ],
        ),
      ).rejects.toThrow();
      const lockedProposalId = '00000000-0000-4000-8000-00000000a904';
      await database.query(
        `INSERT INTO workspace_memory_proposals(id, tenant_id, workspace_id, principal_type, principal_id, original_content, original_category, source_session_id, proposer_snapshot, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,'locked race','constraint',$6,'{}','pending',now(),now())`,
        [
          lockedProposalId,
          owner.tenantId,
          owner.workspaceId,
          owner.principalType,
          owner.principalId,
          sessionId,
        ],
      );
      const lockClient = await database.connect();
      await lockClient.query('BEGIN');
      await lockClient.query(
        'SELECT id FROM workspace_memory_proposals WHERE id = $1 FOR UPDATE',
        [lockedProposalId],
      );
      const blockedClaim = repository.claimActiveVersion({
        surface: makeSurface({
          id: 'locked-race-surface',
          proposalId: lockedProposalId,
          creatingIngressId: commandIngressId,
          actionTokenHash: '1'.repeat(64),
        }),
        expectedActiveVersion: null,
      });
      await lockClient.query(
        `UPDATE workspace_memory_proposals SET status = 'accepted', review_outcome = 'accept', reviewer_snapshot = '{}', reviewed_at = now(), updated_at = now() WHERE id = $1`,
        [lockedProposalId],
      );
      await lockClient.query('COMMIT');
      lockClient.release();
      await expect(blockedClaim).rejects.toThrow('pending');
      await expect(
        database.query(
          'SELECT count(*)::int AS count FROM lark_memory_review_surfaces WHERE proposal_id = $1',
          [lockedProposalId],
        ),
      ).resolves.toMatchObject({ rows: [{ count: 0 }] });
    } finally {
      await database.query(
        'DELETE FROM lark_memory_review_surfaces WHERE binding_id = $1',
        [bindingId],
      );
      await database.query(
        'DELETE FROM channel_conversation_bindings WHERE id = $1',
        [bindingId],
      );
      await database.query(
        'DELETE FROM channel_ingress_events WHERE connection_key = $1',
        [connectionKey],
      );
      await database.query(
        'DELETE FROM workspace_memory_proposals WHERE id = $1',
        [proposalId],
      );
      await database.query(
        `DELETE FROM workspace_memory_proposals WHERE id IN ('00000000-0000-4000-8000-00000000a904','00000000-0000-4000-8000-00000000a905')`,
      );
      await database.query('DELETE FROM product_sessions WHERE id = $1', [
        sessionId,
      ]);
      await database.query('DELETE FROM workspaces WHERE id = $1', [
        workspaceRowId,
      ]);
    }
  });

  it('replays the same canonical task and run for the same key and body', async () => {
    const request = {
      idempotencyKey: 'real-pg-replay',
      invokable: { kind: 'agent' as const, versionId: agentVersionId },
      input: { text: 'replayable real postgres prompt' },
      accessContext: owner,
    };
    const first = await invoke!.execute(request);
    const replay = await invoke!.execute(request);

    expect(first.reused).toBe(false);
    expect(replay.reused).toBe(true);
    expect(replay.task.task.id).toBe(first.task.task.id);
    expect(replay.task.latestRun?.runId).toBe(first.task.latestRun?.runId);
  });

  it('settles concurrent same-key calls to one committed task and run without rollback leakage', async () => {
    const concurrentInvoke = new InvokeTask(
      new PostgresAdmissionRepository(pool!),
      new BarrierInvokableRepository(readerPool!, createTwoPartyBarrier()),
      () => new Date('2026-07-23T12:00:00.000Z'),
    );
    const request = {
      idempotencyKey: 'real-pg-concurrent',
      invokable: { kind: 'agent' as const, versionId: agentVersionId },
      input: { text: 'concurrent real postgres prompt' },
      accessContext: owner,
    };
    const results = await Promise.all(
      Array.from({ length: 2 }, () => concurrentInvoke.execute(request)),
    );
    const taskIds = new Set(results.map((result) => result.task.task.id));
    const runIds = new Set(
      results.map((result) => result.task.latestRun?.runId),
    );

    expect(taskIds.size).toBe(1);
    expect(runIds.size).toBe(1);
    expect(results.map((result) => result.reused).sort()).toEqual([
      false,
      true,
    ]);

    const rows = await readerPool!.query<{
      task_count: string;
      run_count: string;
    }>(
      `
        SELECT
          (SELECT count(*) FROM tasks WHERE tenant_id = $1 AND input_fingerprint = $2) AS task_count,
          (SELECT count(*) FROM runs WHERE task_id = $3) AS run_count
      `,
      [
        owner.tenantId,
        results[0]!.task.task.inputFingerprint,
        results[0]!.task.task.id,
      ],
    );
    expect(rows.rows?.[0]).toEqual({ task_count: '1', run_count: '1' });
  });

  it('does not expose the committed task to another owner scope', async () => {
    const result = await invoke!.execute({
      idempotencyKey: 'real-pg-owner-scope',
      invokable: { kind: 'agent', versionId: agentVersionId },
      input: { text: 'owner scoped prompt' },
      accessContext: owner,
    });

    await expect(
      new GetTask(new PostgresTaskRepository(readerPool!)).execute(
        result.task.task.id,
        { ...owner, principalId: 'real_pg_other_owner' },
      ),
    ).resolves.toBeNull();
  });

  it('converges channel duplicates and reclaims a lease after a worker restart', async () => {
    const channel = new PostgresChannelRepository(pool!);
    const input = realChannelIngress('real-pg-channel-concurrent');
    const results = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        channel.insertIngress({ ...input, id: `real-channel-${index}` }),
      ),
    );
    expect(results.filter((result) => result.inserted)).toHaveLength(1);
    expect(new Set(results.map((result) => result.record.id)).size).toBe(1);

    const claimed = await channel.claimIngress('real-worker-a', 60_000);
    expect(claimed?.leaseOwner).toBe('real-worker-a');
    await expect(
      channel.claimIngress('real-worker-b', 60_000),
    ).resolves.toBeNull();
    await readerPool!.query(
      `UPDATE channel_ingress_events SET lease_expires_at = now() - interval '1 second' WHERE connection_key = $1`,
      [input.connectionKey],
    );

    const restartedWorker = new PostgresChannelRepository(readerPool!);
    await expect(
      restartedWorker.claimIngress('real-worker-restarted', 60_000),
    ).resolves.toMatchObject({
      leaseOwner: 'real-worker-restarted',
      attemptCount: 2,
    });
  });

  it('proves real-PG binding/outbox convergence, claim exclusivity, and attempt replay atomicity', async () => {
    const channel = new PostgresChannelRepository(pool!);
    const reader = new PostgresChannelRepository(readerPool!);
    const bindingIngress = realChannelIngress('real-pg-binding');
    const secondIngress = realChannelIngress('real-pg-binding-second');
    await channel.insertIngress(bindingIngress);
    await channel.insertIngress(secondIngress);

    const bindingResults = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        channel.resolveBinding({
          id: `real-binding-${index}`,
          connectionKey: bindingIngress.connectionKey,
          chatId: 'real-binding-chat',
          rootMessageId: 'real-binding-root',
          creatingIngressId: bindingIngress.id,
        }),
      ),
    );
    expect(new Set(bindingResults.map((result) => result.id)).size).toBe(1);
    await expect(
      channel.resolveBinding({
        id: 'real-binding-conflict',
        connectionKey: bindingIngress.connectionKey,
        chatId: 'real-binding-chat',
        rootMessageId: 'real-binding-root',
        creatingIngressId: secondIngress.id,
      }),
    ).rejects.toThrow(/conflict/);

    const outboxInput = realChannelOutbox('real-pg-outbox');
    const outboxResults = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        channel.saveOutbox({ ...outboxInput, id: `real-outbox-${index}` }),
      ),
    );
    expect(outboxResults.filter((result) => result.inserted)).toHaveLength(1);
    await expect(
      channel.saveOutbox({
        ...outboxInput,
        id: 'real-outbox-conflict',
        payload: '{"text":"different"}',
      }),
    ).rejects.toThrow(/conflict/);
    await pool!.query(
      `UPDATE channel_outbox SET status = 'delivered' WHERE connection_key = $1`,
      [bindingIngress.connectionKey],
    );

    await channel.completeIngressAdministrative({
      ingressId: bindingIngress.id,
      status: 'processed',
    });
    await channel.completeIngressAdministrative({
      ingressId: secondIngress.id,
      status: 'processed',
    });
    const claimInput = realChannelIngress('real-pg-claim-exclusive');
    await channel.insertIngress(claimInput);
    const ingressClaims = await Promise.all(
      ['real-claim-a', 'real-claim-b'].map((worker) =>
        channel.claimIngress(worker, 60_000),
      ),
    );
    expect(ingressClaims.filter((claim) => claim !== null)).toHaveLength(1);
    await readerPool!.query(
      `UPDATE channel_ingress_events SET lease_expires_at = now() - interval '1 second' WHERE id = $1`,
      [claimInput.id],
    );
    await expect(
      reader.claimIngress('real-claim-restarted', 60_000),
    ).resolves.toMatchObject({
      id: claimInput.id,
      attemptCount: 2,
    });

    const outboxClaimInput = realChannelOutbox('real-pg-outbox-claim');
    const outboxClaimRecord = await channel.saveOutbox(outboxClaimInput);
    const outboxClaims = await Promise.all(
      ['real-outbox-claim-a', 'real-outbox-claim-b'].map((worker) =>
        channel.claimOutbox(worker, 60_000),
      ),
    );
    expect(outboxClaims.filter((claim) => claim !== null)).toHaveLength(1);
    await readerPool!.query(
      `UPDATE channel_outbox SET lease_expires_at = now() - interval '1 second' WHERE id = $1`,
      [outboxClaimRecord.record.id],
    );
    await expect(
      reader.claimOutbox('real-outbox-claim-restarted', 60_000),
    ).resolves.toMatchObject({
      id: outboxClaimRecord.record.id,
      attemptCount: 2,
    });
    await channel.recordAttempt({
      id: 'real-outbox-claim-attempt',
      outboxId: outboxClaimRecord.record.id,
      attemptNumber: 2,
      providerRequestId: outboxClaimInput.providerRequestId,
      result: 'delivered',
    });

    const attemptResults = [
      ['delivered', 'delivered'],
      ['permanent_failure', 'permanent_failed'],
      ['unknown', 'delivery_unknown'],
      ['retryable_failure', 'retry_wait'],
    ] as const;
    for (const [result, status] of attemptResults) {
      const saved = await channel.saveOutbox(
        realChannelOutbox(`attempt-${result}`),
      );
      await channel.claimOutbox(`real-delivery-${result}`, 60_000);
      await channel.recordAttempt({
        id: `real-attempt-${result}`,
        outboxId: saved.record.id,
        attemptNumber: 1,
        providerRequestId: `real-request-${result}`,
        result,
        ...(result !== 'delivered' ? { safeErrorCode: `safe-${result}` } : {}),
      });
      await expect(
        readerPool!.query<{ status: string }>(
          'SELECT status FROM channel_outbox WHERE id = $1',
          [saved.record.id],
        ),
      ).resolves.toMatchObject({ rows: [{ status }] });
      if (result === 'delivered') {
        const replay = {
          id: 'real-attempt-delivered',
          outboxId: saved.record.id,
          attemptNumber: 1,
          providerRequestId: 'real-request-delivered',
          result: 'delivered' as const,
        };
        await expect(channel.recordAttempt(replay)).resolves.toBeUndefined();
        await expect(
          channel.recordAttempt({
            ...replay,
            id: 'real-conflict',
            result: 'unknown',
          }),
        ).rejects.toThrow(/conflict/);
      }
    }

    const rollbackOutbox = await channel.saveOutbox(
      realChannelOutbox('attempt-rollback'),
    );
    await expect(
      channel.recordAttempt({
        id: 'real-attempt-rollback',
        outboxId: rollbackOutbox.record.id,
        attemptNumber: 1,
        result: 'delivered',
      }),
    ).rejects.toThrow();
    await expect(
      readerPool!.query(
        'SELECT * FROM channel_delivery_attempts WHERE outbox_id = $1',
        [rollbackOutbox.record.id],
      ),
    ).resolves.toMatchObject({ rows: [] });
  });

  it('elects one binding and Product Session across concurrent real-PG callers', async () => {
    const sessions = new PostgresSessionRepository(pool!);
    const workspace = await sessions.createWorkspace(
      'task6-real-pg-workspace',
      owner,
    );
    const sessionOwner = { ...owner, workspaceId: workspace.id };
    const definition = createAgentDefinition({
      id: crypto.randomUUID(),
      ...sessionOwner,
      name: 'Task 6 real PG agent',
      description: 'Task 6 fixture',
      now: () => new Date('2026-07-23T11:00:00.000Z'),
    });
    const version = publishAgentVersion(
      createDraftAgentVersion({
        id: crypto.randomUUID(),
        definitionId: definition.id,
        ...sessionOwner,
        name: 'Task 6 real PG agent v1',
        description: 'Task 6 fixture',
        instructions: 'Return the input unchanged.',
        now: () => new Date('2026-07-23T11:00:00.000Z'),
      }),
      () => new Date('2026-07-23T11:05:00.000Z'),
    );
    const invokables = new PostgresInvokableRepository(pool!);
    await invokables.saveAgentDefinition(definition);
    await invokables.saveAgentVersion(version);
    const channel = new PostgresChannelRepository(pool!);
    const input = {
      id: crypto.randomUUID(),
      connectionKey: `task6-real-${crypto.randomUUID()}`,
      kind: 'message' as const,
      externalKey: crypto.randomUUID(),
      externalMessageId: crypto.randomUUID(),
      chatId: 'task6-real-chat',
      rootMessageId: 'task6-real-root',
      externalActorId: 'task6-real-user',
      botMentionVerified: true,
      text: 'task 6',
      normalizationVersion: 'lark-v1',
    };
    const stored = (await channel.insertIngress(input)).record;
    const config = {
      enabled: true as const,
      connectionKey: input.connectionKey,
      appId: 'task6-real-app',
      domain: 'lark' as const,
      appSecret: 'task6-real-secret',
      botOpenId: 'task6-real-bot',
      allowedChatId: input.chatId,
      allowedOpenId: input.externalActorId!,
      tenantId: sessionOwner.tenantId,
      workspaceId: workspace.id,
      serviceAccountId: sessionOwner.principalId,
      publishedAgentVersionId: version.id,
      policyVersion: sessionOwner.policySnapshotVersion,
    };
    const results = await Promise.all(
      [pool!, readerPool!].map((database) =>
        new ResolveLarkBinding(
          new PostgresChannelRepository(database),
          config,
        ).execute(stored),
      ),
    );
    const first = results[0];
    const second = results[1];
    expect(first).toMatchObject({ accepted: true });
    expect(second).toMatchObject({ accepted: true });
    if (!first?.accepted || !second?.accepted) throw new Error('not accepted');
    expect(first.sessionId).toBe(second.sessionId);
    await expect(
      pool!.query(
        'SELECT COUNT(*)::int AS count FROM product_sessions WHERE workspace_id = $1',
        [workspace.id],
      ),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
    await expect(
      pool!.query(
        'SELECT COUNT(*)::int AS count FROM session_lanes WHERE session_id = $1',
        [first.sessionId],
      ),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
  });

  it('fails closed when an existing binding session is outside the caller owner or version scope', async () => {
    const sessions = new PostgresSessionRepository(pool!);
    const validWorkspace = await sessions.createWorkspace(
      'task6-cross-scope-owner-workspace',
      owner,
    );
    const foreignOwner = {
      ...owner,
      tenantId: 'task6-foreign-tenant',
      principalId: 'task6-foreign-principal',
    };
    const foreignWorkspace = await sessions.createWorkspace(
      'task6-cross-scope-foreign-workspace',
      foreignOwner,
    );
    const cases = [
      {
        label: 'owner',
        sessionOwner: {
          ...foreignOwner,
          workspaceId: foreignWorkspace.id,
        },
        versionId: 'task6-foreign-version',
      },
      {
        label: 'published version',
        sessionOwner: { ...owner, workspaceId: validWorkspace.id },
        versionId: 'task6-different-published-version',
      },
    ];
    for (const testCase of cases) {
      const connectionKey = `task6-cross-scope-${testCase.label}-${crypto.randomUUID()}`;
      const sessionId = crypto.randomUUID();
      await pool!.query(
        `INSERT INTO product_sessions
         (id, workspace_id, tenant_id, principal_type, principal_id,
          published_agent_version_id, generation, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 0, 'active', now(), now())`,
        [
          sessionId,
          testCase.sessionOwner.workspaceId,
          testCase.sessionOwner.tenantId,
          testCase.sessionOwner.principalType,
          testCase.sessionOwner.principalId,
          testCase.versionId,
        ],
      );
      await pool!.query(
        'INSERT INTO session_lanes(session_id, generation) VALUES ($1, 0)',
        [sessionId],
      );
      const input = {
        id: crypto.randomUUID(),
        connectionKey,
        kind: 'message' as const,
        externalKey: crypto.randomUUID(),
        externalMessageId: crypto.randomUUID(),
        chatId: 'task6-cross-scope-chat',
        rootMessageId: `task6-cross-scope-root-${crypto.randomUUID()}`,
        externalActorId: 'task6-cross-scope-user',
        botMentionVerified: true,
        text: 'must not reuse',
        normalizationVersion: 'lark-v1',
      };
      const channel = new PostgresChannelRepository(pool!);
      const stored = (await channel.insertIngress(input)).record;
      await channel.resolveBinding({
        id: crypto.randomUUID(),
        connectionKey,
        chatId: input.chatId,
        rootMessageId: input.rootMessageId,
        sessionId,
        creatingIngressId: input.id,
      });
      await expect(
        new ResolveLarkBinding(channel, {
          enabled: true,
          connectionKey,
          appId: 'task6-cross-scope-app',
          domain: 'lark',
          appSecret: 'task6-cross-scope-secret',
          botOpenId: 'task6-cross-scope-bot',
          allowedChatId: input.chatId,
          allowedOpenId: input.externalActorId,
          tenantId: owner.tenantId,
          workspaceId: validWorkspace.id,
          serviceAccountId: owner.principalId,
          publishedAgentVersionId: agentVersionId,
          policyVersion: owner.policySnapshotVersion,
        }).execute(stored),
      ).rejects.toThrow('not_found');
    }
  });
});

class BarrierInvokableRepository extends PostgresInvokableRepository {
  public constructor(
    database: ConstructorParameters<typeof PostgresInvokableRepository>[0],
    private readonly arrive: () => Promise<void>,
  ) {
    super(database);
  }

  public override async findPublishedAgentVersionById(
    ...args: Parameters<
      PostgresInvokableRepository['findPublishedAgentVersionById']
    >
  ) {
    const version = await super.findPublishedAgentVersionById(...args);
    await this.arrive();
    return version;
  }
}

function createTwoPartyBarrier(): () => Promise<void> {
  let arrivals = 0;
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });

  return async () => {
    arrivals += 1;
    if (arrivals === 2) {
      release();
    }
    await released;
  };
}

async function cleanTestRows(
  pool: ReturnType<typeof createPostgresPool>,
): Promise<void> {
  await pool.query(
    `
      DELETE FROM channel_delivery_attempts
      WHERE outbox_id IN (
        SELECT id FROM channel_outbox WHERE connection_key = 'real-pg-channel-task5'
      )
    `,
  );
  await pool.query(
    `DELETE FROM channel_outbox WHERE connection_key = 'real-pg-channel-task5'`,
  );
  await pool.query(
    `DELETE FROM channel_conversation_bindings WHERE connection_key = 'real-pg-channel-task5'`,
  );
  await pool.query(
    `DELETE FROM channel_ingress_events WHERE connection_key = 'real-pg-channel-task5'`,
  );
  await pool.query(
    `
      DELETE FROM run_dispatches
      WHERE run_id IN (
        SELECT runs.id FROM runs INNER JOIN tasks ON tasks.id = runs.task_id
        WHERE tasks.tenant_id = $1
      )
    `,
    [owner.tenantId],
  );
  await pool.query('DELETE FROM admissions WHERE tenant_id = $1', [
    owner.tenantId,
  ]);
  await pool.query(
    `DELETE FROM runs USING tasks WHERE runs.task_id = tasks.id AND tasks.tenant_id = $1`,
    [owner.tenantId],
  );
  await pool.query('DELETE FROM tasks WHERE tenant_id = $1', [owner.tenantId]);
  await pool.query('DELETE FROM agent_versions WHERE tenant_id = $1', [
    owner.tenantId,
  ]);
  await pool.query('DELETE FROM agent_definitions WHERE tenant_id = $1', [
    owner.tenantId,
  ]);
}

function realChannelIngress(externalKey: string): ChannelIngressInput {
  return {
    id: `real-channel-${externalKey}`,
    connectionKey: 'real-pg-channel-task5',
    kind: 'message',
    externalKey,
    providerEventId: `event-${externalKey}`,
    externalMessageId: `message-${externalKey}`,
    chatId: 'real-chat',
    rootMessageId: 'real-root',
    externalActorId: 'real-actor',
    text: 'real postgres channel test',
    normalizationVersion: 'lark-v1',
  };
}

function realChannelOutbox(id: string): ChannelOutboxInput {
  return {
    id: `real-outbox-${id}`,
    connectionKey: 'real-pg-channel-task5',
    bindingId: null,
    targetId: 'real-chat',
    deliveryKind: 'message',
    aggregateId: id,
    aggregateVersion: 1,
    payload: '{"text":"real postgres channel test"}',
    providerRequestId: `real-provider-${id}`,
  };
}
