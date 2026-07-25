import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it, vi } from 'vitest';
import { applyDurableKernelMigrations } from '../../src/infrastructure/postgres/postgres.js';
import { ManagedMemory } from '../../src/application/memory/managed-memory.js';
import { PostgresWorkspaceMemoryRepository } from '../../src/infrastructure/postgres/postgres-workspace-memory-repository.js';
import { ReviewMemoryProposal } from '../../src/application/memory/review-memory-proposal.js';
import { createMemoryProposal } from '../../src/domain/workspace-memory/memory-proposal.js';

describe('managed memory projection receipts', () => {
  it('rejects an owned projection row without the exact canonical Entry identity', async () => {
    const db = new PGlite();
    await applyDurableKernelMigrations(db);
    const proposalId = '00000000-0000-4000-8000-000000000051';
    await db.query(
      `INSERT INTO workspace_memory_proposals (id,tenant_id,workspace_id,principal_type,principal_id,original_content,original_category,proposer_snapshot,status,created_at,updated_at) VALUES ($1,'tenant','workspace','service_account','svc','Canonical.','rule','{}','pending',now(),now())`,
      [proposalId],
    );
    await expect(
      db.query(
        `INSERT INTO workspace_memory_owned_entries (entry_id,proposal_id,tenant_id,workspace_id,principal_type,principal_id,content,content_hash,category,proposer_snapshot,reviewer_snapshot,accepted_at) VALUES ('00000000-0000-4000-8000-000000000052',$1,'tenant','workspace','service_account','svc','Forged.','hash','rule','{}','{}',now())`,
        [proposalId],
      ),
    ).rejects.toThrow();
    await db.close();
  });

  it('C6 reuses one receipt/snapshot on concurrent exact replay and C8 preserves old membership', async () => {
    const db = new PGlite();
    await applyDurableKernelMigrations(db);
    const published: string[] = [];
    const memory = new ManagedMemory(
      db,
      {
        publish: async (snapshot) => {
          published.push(snapshot.snapshotId);
        },
        readVerified: async () => 'verified',
      },
      () => 'receipt-owner-1',
    );
    const entry = {
      id: '00000000-0000-4000-8000-000000000101',
      proposalId: '00000000-0000-4000-8000-000000000102',
      tenantId: 'tenant',
      workspaceId: 'workspace',
      principalType: 'service_account',
      principalId: 'svc',
      content: 'Use UTC.',
      category: 'rule',
      sourceTaskId: null,
      sourceSessionId: null,
      sourceMessageId: null,
      sourceRunId: null,
      sourceAgentVersionId: null,
      sourceCandidateIndex: null,
      proposerSnapshot: {
        principalType: 'service_account',
        principalId: 'svc',
        policySnapshotVersion: 'p',
      },
      reviewerSnapshot: {
        principalType: 'service_account',
        principalId: 'svc',
        policySnapshotVersion: 'p',
      },
      reviewOutcome: 'accept' as const,
      acceptedAt: '2026-01-01T00:00:00.000Z',
    };
    await db.query(
      `INSERT INTO workspace_memory_proposals (id,tenant_id,workspace_id,principal_type,principal_id,original_content,original_category,proposer_snapshot,status,review_outcome,reviewer_snapshot,reviewed_at,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'accepted','accept',$8,now(),now(),now())`,
      [
        entry.proposalId,
        entry.tenantId,
        entry.workspaceId,
        entry.principalType,
        entry.principalId,
        entry.content,
        entry.category,
        JSON.stringify(entry.proposerSnapshot),
      ],
    );
    await db.query(
      `INSERT INTO workspace_memory_entries (id,proposal_id,tenant_id,workspace_id,principal_type,principal_id,content,category,proposer_snapshot,reviewer_snapshot,review_outcome,accepted_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,'accept',$10)`,
      [
        entry.id,
        entry.proposalId,
        entry.tenantId,
        entry.workspaceId,
        entry.principalType,
        entry.principalId,
        entry.content,
        entry.category,
        JSON.stringify(entry.proposerSnapshot),
        entry.acceptedAt,
      ],
    );
    const [first, second] = await Promise.all([
      memory.acceptEntry(entry),
      memory.acceptEntry(entry),
    ]);
    expect(second.snapshotId).toBe(first.snapshotId);
    expect(second.version).toBe(first.version);
    expect(published).toEqual([first.snapshotId]);
    expect(
      (await db.query('SELECT * FROM workspace_memory_projection_receipts'))
        .rows,
    ).toHaveLength(1);
    expect(
      (await db.query('SELECT * FROM workspace_memory_snapshot_entries')).rows,
    ).toHaveLength(1);
    const laterProposal = '00000000-0000-4000-8000-000000000103';
    const laterEntry = '00000000-0000-4000-8000-000000000104';
    const actor = JSON.stringify(entry.proposerSnapshot);
    await db.query(
      `INSERT INTO workspace_memory_proposals (id,tenant_id,workspace_id,principal_type,principal_id,original_content,original_category,proposer_snapshot,status,review_outcome,reviewer_snapshot,reviewed_at,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,'Later.','rule',$6,'accepted','accept',$6,now(),now(),now())`,
      [
        laterProposal,
        entry.tenantId,
        entry.workspaceId,
        entry.principalType,
        entry.principalId,
        actor,
      ],
    );
    await db.query(
      `INSERT INTO workspace_memory_entries (id,proposal_id,tenant_id,workspace_id,principal_type,principal_id,content,category,proposer_snapshot,reviewer_snapshot,review_outcome,accepted_at) VALUES ($1,$2,$3,$4,$5,$6,'Later.','rule',$7,$7,'accept',$8)`,
      [
        laterEntry,
        laterProposal,
        entry.tenantId,
        entry.workspaceId,
        entry.principalType,
        entry.principalId,
        actor,
        entry.acceptedAt,
      ],
    );
    const later = await memory.acceptEntry({
      ...entry,
      id: laterEntry,
      proposalId: laterProposal,
      content: 'Later.',
    });
    expect(later.version).toBe(first.version + 1);
    expect(
      (
        await db.query(
          'SELECT * FROM workspace_memory_snapshot_entries WHERE snapshot_id=$1',
          [first.snapshotId],
        )
      ).rows,
    ).toHaveLength(1);
    await db.close();
  });

  it('commits controller-keyed review once and replays the canonical entry', async () => {
    const db = new PGlite();
    await applyDurableKernelMigrations(db);
    const proposalId = '00000000-0000-4000-8000-000000000201';
    await db.query(
      `INSERT INTO workspace_memory_proposals (id,tenant_id,workspace_id,principal_type,principal_id,original_content,original_category,proposer_snapshot,status,created_at,updated_at) VALUES ($1,'tenant','workspace','service_account','svc','Remember this.','rule',$2,'pending',now(),now())`,
      [
        proposalId,
        JSON.stringify({
          principalType: 'service_account',
          principalId: 'svc',
          policySnapshotVersion: 'p',
        }),
      ],
    );
    await db.query(
      `INSERT INTO channel_ingress_events (id,connection_key,kind,external_key,chat_id,external_actor_id,action,normalization_version,status,lease_owner,lease_expires_at) VALUES ('ingress-controller','lark','command','event','chat','svc',$1,'v1','processing','worker',now()+interval '1 minute')`,
      [
        JSON.stringify({
          name: 'memory_review',
          decision: 'accept',
          proposalId,
        }),
      ],
    );
    const review = new ReviewMemoryProposal(
      new PostgresWorkspaceMemoryRepository(db),
    );
    const accessContext = {
      tenantId: 'tenant',
      workspaceId: 'workspace',
      principalType: 'service_account' as const,
      principalId: 'svc',
      serviceAccountId: 'svc',
      policySnapshotVersion: 'p',
    };
    const first = await review.execute({
      proposalId,
      action: 'accept',
      accessContext,
      controller: { kind: 'channel_ingress', ingressId: 'ingress-controller' },
    });
    const second = await review.execute({
      proposalId,
      action: 'accept',
      accessContext,
      controller: { kind: 'channel_ingress', ingressId: 'ingress-controller' },
    });
    expect(second.replayed).toBe(true);
    expect(second.entry?.id).toBe(first.entry?.id);
    expect(
      (
        await db.query(
          'SELECT * FROM workspace_memory_entries WHERE proposal_id=$1',
          [proposalId],
        )
      ).rows,
    ).toHaveLength(1);
    await db.close();
  });

  it('manually rebuilds nonempty membership with exact owner fields without a receipt', async () => {
    const db = new PGlite();
    await applyDurableKernelMigrations(db);
    const memory = new ManagedMemory(db, {
      publish: async () => undefined,
      readVerified: async () => 'verified',
    });
    const proposalId = '00000000-0000-4000-8000-000000000251';
    const entryId = '00000000-0000-4000-8000-000000000252';
    const memoryRepository = new PostgresWorkspaceMemoryRepository(db);
    const actor = {
      principalType: 'service_account',
      principalId: 'svc',
      policySnapshotVersion: 'p',
    };
    await memoryRepository.createProposal(
      createMemoryProposal({
        id: proposalId,
        tenantId: 'tenant',
        workspaceId: 'workspace',
        principalType: 'service_account',
        principalId: 'svc',
        originalContent: 'Manual.',
        originalCategory: 'rule',
        proposerSnapshot: actor,
        now: () => new Date('2026-01-01T00:00:00.000Z'),
      }),
    );
    const reviewed = await memoryRepository.reviewProposal({
      proposalId,
      ownerScope: {
        tenantId: 'tenant',
        workspaceId: 'workspace',
        principalType: 'service_account',
        principalId: 'svc',
      },
      outcome: 'accept',
      reviewedContent: null,
      reviewerSnapshot: actor,
      now: () => new Date('2026-01-01T00:01:00.000Z'),
      entryIdFactory: () => entryId,
    });
    const canonicalEntry = reviewed.entry!;
    await db.query(
      `INSERT INTO workspace_memory_owned_entries(entry_id,proposal_id,tenant_id,workspace_id,principal_type,principal_id,content,content_hash,category,proposer_snapshot,reviewer_snapshot,accepted_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        canonicalEntry.id,
        canonicalEntry.proposalId,
        canonicalEntry.tenantId,
        canonicalEntry.workspaceId,
        canonicalEntry.principalType,
        canonicalEntry.principalId,
        canonicalEntry.content,
        'hash',
        canonicalEntry.category,
        JSON.stringify(canonicalEntry.proposerSnapshot),
        JSON.stringify(canonicalEntry.reviewerSnapshot),
        canonicalEntry.acceptedAt,
      ],
    );
    const snapshot = await memory.rebuild({
      tenantId: 'tenant',
      workspaceId: 'workspace',
    });
    expect(snapshot.projectionStatus).toBe('ready');
    expect(snapshot.version).toBe(1);
    expect(
      (
        await db.query<any>(
          'SELECT next_version FROM workspace_memory_projection_scopes WHERE tenant_id=$1 AND workspace_id=$2',
          ['tenant', 'workspace'],
        )
      ).rows[0].next_version,
    ).toBe(2);
    const membership = (
      await db.query<any>(
        'SELECT * FROM workspace_memory_snapshot_entries WHERE snapshot_id=$1',
        [snapshot.snapshotId],
      )
    ).rows[0];
    expect(membership).toMatchObject({
      entry_id: entryId,
      tenant_id: 'tenant',
      workspace_id: 'workspace',
      principal_type: 'service_account',
      principal_id: 'svc',
      ordinal: 0,
    });
    expect(
      (await db.query('SELECT * FROM workspace_memory_projection_receipts'))
        .rows,
    ).toHaveLength(0);
    await db.query(
      `INSERT INTO workspace_memory_projection_receipts (proposal_id,entry_id,snapshot_id,tenant_id,workspace_id,principal_type,principal_id,state) VALUES ($1,$2,$3,'tenant','workspace','service_account','svc','ready')`,
      [proposalId, entryId, snapshot.snapshotId],
    );
    await expect(
      db.query(
        `INSERT INTO workspace_memory_projection_receipts (proposal_id,entry_id,snapshot_id,tenant_id,workspace_id,principal_type,principal_id,state) VALUES ($1,$2,$3,'wrong','workspace','service_account','svc','ready')`,
        [proposalId, entryId, snapshot.snapshotId],
      ),
    ).rejects.toThrow();
    const secondProposal = '00000000-0000-4000-8000-000000000253';
    const secondEntry = '00000000-0000-4000-8000-000000000254';
    await db.query(
      `INSERT INTO workspace_memory_proposals (id,tenant_id,workspace_id,principal_type,principal_id,original_content,original_category,proposer_snapshot,status,review_outcome,reviewer_snapshot,reviewed_at,created_at,updated_at) VALUES ($1,'tenant','workspace','service_account','svc','Other.','rule',$2,'accepted','accept',$2,now(),now(),now())`,
      [
        secondProposal,
        JSON.stringify({
          principalType: 'service_account',
          principalId: 'svc',
          policySnapshotVersion: 'p',
        }),
      ],
    );
    await db.query(
      `INSERT INTO workspace_memory_entries (id,proposal_id,tenant_id,workspace_id,principal_type,principal_id,content,category,proposer_snapshot,reviewer_snapshot,review_outcome,accepted_at) VALUES ($1,$2,'tenant','workspace','service_account','svc','Other.','rule',$3,$3,'accept',now())`,
      [
        secondEntry,
        secondProposal,
        JSON.stringify({
          principalType: 'service_account',
          principalId: 'svc',
          policySnapshotVersion: 'p',
        }),
      ],
    );
    await db.query(
      `INSERT INTO workspace_memory_owned_entries (entry_id,proposal_id,tenant_id,workspace_id,principal_type,principal_id,content,content_hash,category,proposer_snapshot,reviewer_snapshot,accepted_at) VALUES ($1,$2,'tenant','workspace','service_account','svc','Other.','hash','rule',$3,$3,now())`,
      [
        secondEntry,
        secondProposal,
        JSON.stringify({
          principalType: 'service_account',
          principalId: 'svc',
          policySnapshotVersion: 'p',
        }),
      ],
    );
    await expect(
      db.query(
        `INSERT INTO workspace_memory_projection_receipts (proposal_id,entry_id,snapshot_id,tenant_id,workspace_id,principal_type,principal_id,state) VALUES ($1,$2,$3,'tenant','workspace','service_account','svc','ready')`,
        [secondProposal, entryId, snapshot.snapshotId],
      ),
    ).rejects.toThrow();
    await expect(
      db.query(
        `INSERT INTO workspace_memory_projection_receipts (proposal_id,entry_id,snapshot_id,tenant_id,workspace_id,principal_type,principal_id,state) VALUES ($1,$2,$3,'tenant','workspace','service_account','svc','ready')`,
        [secondProposal, secondEntry, snapshot.snapshotId],
      ),
    ).rejects.toThrow();
    await db.close();
  });

  it('recovers a failed receipt with the same snapshot identity', async () => {
    const db = new PGlite();
    await applyDurableKernelMigrations(db);
    let fail = true;
    const memory = new ManagedMemory(db, {
      publish: async () => {
        if (fail) {
          fail = false;
          throw new Error('store unavailable');
        }
      },
      readVerified: async () => 'verified',
    });
    const entry: any = {
      id: '00000000-0000-4000-8000-000000000301',
      proposalId: '00000000-0000-4000-8000-000000000302',
      tenantId: 'tenant',
      workspaceId: 'workspace',
      principalType: 'service_account',
      principalId: 'svc',
      content: 'Keep receipts.',
      category: 'rule',
      sourceTaskId: null,
      sourceSessionId: null,
      sourceMessageId: null,
      sourceRunId: null,
      sourceAgentVersionId: null,
      sourceCandidateIndex: null,
      proposerSnapshot: {
        principalType: 'service_account',
        principalId: 'svc',
        policySnapshotVersion: 'p',
      },
      reviewerSnapshot: {
        principalType: 'service_account',
        principalId: 'svc',
        policySnapshotVersion: 'p',
      },
      reviewOutcome: 'accept',
      acceptedAt: '2026-01-01T00:00:00.000Z',
    };
    await db.query(
      `INSERT INTO workspace_memory_proposals (id,tenant_id,workspace_id,principal_type,principal_id,original_content,original_category,proposer_snapshot,status,review_outcome,reviewer_snapshot,reviewed_at,created_at,updated_at) VALUES ($1,'tenant','workspace','service_account','svc',$2,'rule',$3,'accepted','accept',$3,now(),now(),now())`,
      [entry.proposalId, entry.content, JSON.stringify(entry.proposerSnapshot)],
    );
    await db.query(
      `INSERT INTO workspace_memory_entries (id,proposal_id,tenant_id,workspace_id,principal_type,principal_id,content,category,proposer_snapshot,reviewer_snapshot,review_outcome,accepted_at) VALUES ($1,$2,'tenant','workspace','service_account','svc',$3,'rule',$4,$4,'accept',$5)`,
      [
        entry.id,
        entry.proposalId,
        entry.content,
        JSON.stringify(entry.proposerSnapshot),
        entry.acceptedAt,
      ],
    );
    await expect(memory.acceptEntry(entry)).rejects.toThrow(
      'store unavailable',
    );
    const failed = (
      await db.query<any>(
        'SELECT snapshot_id FROM workspace_memory_projection_receipts WHERE proposal_id=$1',
        [entry.proposalId],
      )
    ).rows[0].snapshot_id;
    const recovered = await memory.acceptEntry(entry);
    expect(recovered.snapshotId).toBe(failed);
    await db.close();
  });

  it('C1 claims a pending receipt and completes it', async () => {
    const db = new PGlite();
    await applyDurableKernelMigrations(db);
    const fixture = await seedProjectionEntry(db, '601');
    const first = await new ManagedMemory(db, {
      publish: async () => undefined,
      readVerified: async () => 'verified',
    }).acceptEntry(fixture.entry);
    await db.query(
      `UPDATE workspace_memory_projection_receipts SET state='pending', lease_owner=NULL, lease_expires_at=NULL WHERE proposal_id=$1`,
      [fixture.entry.proposalId],
    );
    await db.query(
      `UPDATE workspace_memory_snapshots SET projection_status='pending' WHERE snapshot_id=$1`,
      [first.snapshotId],
    );
    const recovered = await new ManagedMemory(
      db,
      { publish: async () => undefined, readVerified: async () => 'verified' },
      () => 'pending-owner',
    ).acceptEntry(fixture.entry);
    expect(recovered.snapshotId).toBe(first.snapshotId);
    expect(recovered.projectionStatus).toBe('ready');
    await db.close();
  });
  it('C3 does not reclaim an unexpired publishing receipt owned by another worker', async () => {
    const db = new PGlite();
    await applyDurableKernelMigrations(db);
    const fixture = await seedProjectionEntry(db, '602');
    const first = await new ManagedMemory(db, {
      publish: async () => undefined,
      readVerified: async () => 'verified',
    }).acceptEntry(fixture.entry);
    await db.query(
      `UPDATE workspace_memory_projection_receipts SET state='publishing', lease_owner='other-worker', lease_expires_at=now()+interval '10 minutes' WHERE proposal_id=$1`,
      [fixture.entry.proposalId],
    );
    await expect(
      new ManagedMemory(
        db,
        { publish: vi.fn(), readVerified: async () => 'verified' },
        () => 'contender',
      ).acceptEntry(fixture.entry),
    ).rejects.toThrow('claim unavailable');
    expect(first.snapshotId).toBe(
      (
        await db.query<any>(
          'SELECT snapshot_id FROM workspace_memory_projection_receipts WHERE proposal_id=$1',
          [fixture.entry.proposalId],
        )
      ).rows[0].snapshot_id,
    );
    await db.close();
  });
  it('C4 takes over an expired publishing receipt with the same snapshot', async () => {
    const db = new PGlite();
    await applyDurableKernelMigrations(db);
    const fixture = await seedProjectionEntry(db, '603');
    const first = await new ManagedMemory(db, {
      publish: async () => undefined,
      readVerified: async () => 'verified',
    }).acceptEntry(fixture.entry);
    await db.query(
      `UPDATE workspace_memory_projection_receipts SET state='publishing', lease_owner='expired-worker', lease_expires_at=now()-interval '1 minute' WHERE proposal_id=$1`,
      [fixture.entry.proposalId],
    );
    const recovered = await new ManagedMemory(
      db,
      { publish: async () => undefined, readVerified: async () => 'verified' },
      () => 'takeover',
    ).acceptEntry(fixture.entry);
    expect(recovered.snapshotId).toBe(first.snapshotId);
    await db.close();
  });
  it('C5 rejects stale owner completion after lease takeover', async () => {
    const db = new PGlite();
    await applyDurableKernelMigrations(db);
    const fixture = await seedProjectionEntry(db, '604');
    await expect(
      new ManagedMemory(
        db,
        {
          publish: async () => {
            await db.query(
              `UPDATE workspace_memory_projection_receipts SET lease_owner='new-owner', attempt_count=attempt_count+1 WHERE proposal_id=$1`,
              [fixture.entry.proposalId],
            );
          },
          readVerified: async () => 'verified',
        },
        () => 'stale-owner',
      ).acceptEntry(fixture.entry),
    ).rejects.toThrow('lease fence');
    await db.close();
  });
  it('C7 serializes concurrent different Entries into distinct versions', async () => {
    const db = new PGlite();
    await applyDurableKernelMigrations(db);
    const first = await seedProjectionEntry(db, '605', 'shared-workspace');
    const second = await seedProjectionEntry(db, '606', 'shared-workspace');
    const memory = new ManagedMemory(db, {
      publish: async () => undefined,
      readVerified: async () => 'verified',
    });
    const results = await Promise.all([
      memory.acceptEntry(first.entry),
      memory.acceptEntry(second.entry),
    ]);
    expect(new Set(results.map((item) => item.version)).size).toBe(2);
    await db.close();
  });
  it('C10 rejects caller Entry content mismatch against canonical accepted Entry', async () => {
    const db = new PGlite();
    await applyDurableKernelMigrations(db);
    const fixture = await seedProjectionEntry(db, '607');
    await expect(
      new ManagedMemory(db, {
        publish: async () => undefined,
        readVerified: async () => 'verified',
      }).acceptEntry({ ...fixture.entry, content: 'forged' }),
    ).rejects.toThrow('canonical entry conflict');
    await db.close();
  });

  it('rejects keyed controller conflicts and replays Reject/Edit-and-Accept exactly', async () => {
    const db = new PGlite();
    await applyDurableKernelMigrations(db);
    const repository = new PostgresWorkspaceMemoryRepository(db);
    const review = new ReviewMemoryProposal(repository);
    const accessContext = {
      tenantId: 'tenant',
      workspaceId: 'workspace',
      principalType: 'service_account' as const,
      principalId: 'svc',
      serviceAccountId: 'svc',
      policySnapshotVersion: 'p',
    };
    const proposal = async (id: string) =>
      db.query(
        `INSERT INTO workspace_memory_proposals (id,tenant_id,workspace_id,principal_type,principal_id,original_content,original_category,proposer_snapshot,status,created_at,updated_at) VALUES ($1,'tenant','workspace','service_account','svc','Remember.','rule',$2,'pending',now(),now())`,
        [
          id,
          JSON.stringify({
            principalType: 'service_account',
            principalId: 'svc',
            policySnapshotVersion: 'p',
          }),
        ],
      );
    const ingress = async (id: string) =>
      db.query(
        `INSERT INTO channel_ingress_events (id,connection_key,kind,external_key,chat_id,external_actor_id,action,normalization_version,status,lease_owner,lease_expires_at) VALUES ($1,'lark','command',$1,'chat','svc','{}','v1','processing','worker',now()+interval '1 minute')`,
        [id],
      );
    const rejectId = '00000000-0000-4000-8000-000000000401';
    await proposal(rejectId);
    await ingress('reject-ingress');
    const rejected = await review.execute({
      proposalId: rejectId,
      action: 'reject',
      accessContext,
      controller: { kind: 'channel_ingress', ingressId: 'reject-ingress' },
    });
    const rejectedReplay = await review.execute({
      proposalId: rejectId,
      action: 'reject',
      accessContext,
      controller: { kind: 'channel_ingress', ingressId: 'reject-ingress' },
    });
    expect(rejected.entry).toBeNull();
    expect(rejectedReplay.replayed).toBe(true);
    await ingress('reject-other-ingress');
    await expect(
      review.execute({
        proposalId: rejectId,
        action: 'accept',
        accessContext,
        controller: {
          kind: 'channel_ingress',
          ingressId: 'reject-other-ingress',
        },
      }),
    ).rejects.toThrow();
    const editId = '00000000-0000-4000-8000-000000000402';
    await proposal(editId);
    await ingress('edit-ingress');
    const edited = await review.execute({
      proposalId: editId,
      action: 'edit_and_accept',
      content: 'Edited.',
      accessContext,
      controller: { kind: 'channel_ingress', ingressId: 'edit-ingress' },
    });
    const editedReplay = await review.execute({
      proposalId: editId,
      action: 'edit_and_accept',
      content: 'Edited.',
      accessContext,
      controller: { kind: 'channel_ingress', ingressId: 'edit-ingress' },
    });
    expect(editedReplay.replayed).toBe(true);
    expect(editedReplay.entry?.id).toBe(edited.entry?.id);
    await expect(
      review.execute({
        proposalId: editId,
        action: 'edit_and_accept',
        content: 'Changed.',
        accessContext,
        controller: { kind: 'channel_ingress', ingressId: 'edit-ingress' },
      }),
    ).rejects.toThrow();
    await db.close();
  });

  it('D6 fails closed when a legacy terminal proposal has no controller key', async () => {
    const db = new PGlite();
    await applyDurableKernelMigrations(db);
    const proposalId = '00000000-0000-4000-8000-000000000451';
    const actor = JSON.stringify({
      principalType: 'service_account',
      principalId: 'svc',
      policySnapshotVersion: 'p',
    });
    await db.query(
      `INSERT INTO workspace_memory_proposals (id,tenant_id,workspace_id,principal_type,principal_id,original_content,original_category,proposer_snapshot,status,review_outcome,reviewer_snapshot,reviewed_at,created_at,updated_at) VALUES ($1,'tenant','workspace','service_account','svc','Legacy.','rule',$2,'accepted','accept',$2,now(),now(),now())`,
      [proposalId, actor],
    );
    await db.query(
      `INSERT INTO channel_ingress_events(id,connection_key,kind,external_key,chat_id,external_actor_id,action,normalization_version,status,lease_owner,lease_expires_at) VALUES ('legacy-controller','lark','command','legacy-controller','chat','svc','{}','v1','processing','worker',now()+interval '1 minute')`,
    );
    const review = new ReviewMemoryProposal(
      new PostgresWorkspaceMemoryRepository(db),
    );
    await expect(
      review.execute({
        proposalId,
        action: 'accept',
        accessContext: {
          tenantId: 'tenant',
          workspaceId: 'workspace',
          principalType: 'service_account',
          principalId: 'svc',
          serviceAccountId: 'svc',
          policySnapshotVersion: 'p',
        },
        controller: { kind: 'channel_ingress', ingressId: 'legacy-controller' },
      }),
    ).rejects.toThrow();
    await db.close();
  });
});

async function seedProjectionEntry(
  db: PGlite,
  suffix: string,
  workspaceId = `workspace-${suffix}`,
) {
  const proposalId = `00000000-0000-4000-8000-0000000${suffix}01`;
  const entryId = `00000000-0000-4000-8000-0000000${suffix}02`;
  const actor = JSON.stringify({
    principalType: 'service_account',
    principalId: 'svc',
    policySnapshotVersion: 'p',
  });
  const entry: any = {
    id: entryId,
    proposalId,
    tenantId: 'tenant',
    workspaceId: workspaceId,
    principalType: 'service_account',
    principalId: 'svc',
    content: `Content ${suffix}`,
    category: 'rule',
    sourceTaskId: null,
    sourceSessionId: null,
    sourceMessageId: null,
    sourceRunId: null,
    sourceAgentVersionId: null,
    sourceCandidateIndex: null,
    proposerSnapshot: JSON.parse(actor),
    reviewerSnapshot: JSON.parse(actor),
    reviewOutcome: 'accept',
    acceptedAt: '2026-01-01T00:00:00.000Z',
  };
  await db.query(
    `INSERT INTO workspace_memory_proposals (id,tenant_id,workspace_id,principal_type,principal_id,original_content,original_category,proposer_snapshot,status,review_outcome,reviewer_snapshot,reviewed_at,created_at,updated_at) VALUES ($1,$2,$3,'service_account','svc',$4,'rule',$5,'accepted','accept',$5,now(),now(),now())`,
    [proposalId, entry.tenantId, entry.workspaceId, entry.content, actor],
  );
  await db.query(
    `INSERT INTO workspace_memory_entries (id,proposal_id,tenant_id,workspace_id,principal_type,principal_id,content,category,proposer_snapshot,reviewer_snapshot,review_outcome,accepted_at) VALUES ($1,$2,$3,$4,'service_account','svc',$5,'rule',$6,$6,'accept',$7)`,
    [
      entryId,
      proposalId,
      entry.tenantId,
      entry.workspaceId,
      entry.content,
      actor,
      entry.acceptedAt,
    ],
  );
  return { entry };
}
