import { describe, expect, it, vi } from 'vitest';
import type { ChannelOutbox } from '../../domain/channels/channel-delivery.js';
import { DeliverChannelOutbox } from './deliver-channel-outbox.js';
import { createMemoryReviewActionTokenDeriver } from './memory-review-action-token.js';
import { PGlite } from '@electric-sql/pglite';
import { applyDurableKernelMigrations } from '../../infrastructure/postgres/postgres.js';
import { PostgresChannelRepository } from '../../infrastructure/postgres/postgres-channel-repository.js';
import { testMemoryReviewCardRenderer } from './memory-review-card-renderer.test-helper.js';

const outbox = {
  id: 'outbox-1',
  connectionKey: 'lark-canary',
  bindingId: 'binding-1',
  aggregateId: 'proposal-1',
  aggregateVersion: 1,
  targetId: 'target-1',
  payload: 'payload',
  providerRequestId: 'request-1',
  attemptCount: 2,
  leaseOwner: 'worker-1',
  deliveryKind: 'agent_run_result',
} as ChannelOutbox;

const cardPayload = JSON.stringify({
  schema: '2.0',
  config: { update_multi: true, enable_forward: false, width_mode: 'default' },
  header: { template: 'blue', title: { tag: 'plain_text', content: 'Review' } },
  body: { elements: [] },
});

describe('DeliverChannelOutbox', () => {
  it('B8 preserves canonical Memory while a provider Card-patch failure changes only outbox retry state', async () => {
    const db = new PGlite();
    await applyDurableKernelMigrations(db);
    const actor = JSON.stringify({
      principalType: 'service_account',
      principalId: 'svc',
      policySnapshotVersion: 'p',
    });
    const proposalId = '00000000-0000-4000-8000-000000000981';
    const entryId = '00000000-0000-4000-8000-000000000982';
    const snapshotId = '00000000-0000-4000-8000-000000000983';
    await db.query(
      `INSERT INTO channel_ingress_events(id,connection_key,kind,external_key,external_message_id,chat_id,external_actor_id,action,normalization_version,status,attempt_count,lease_owner,lease_expires_at) VALUES ('patch-ingress','lark','card_action','patch-ingress','card-1','chat','actor',$1,'v1','processing',1,'worker',now()+interval '1 minute')`,
      [JSON.stringify({ action: 'accept', digest: 'a'.repeat(64) })],
    );
    await db.query(
      `INSERT INTO workspace_memory_proposals(id,tenant_id,workspace_id,principal_type,principal_id,original_content,original_category,proposer_snapshot,status,review_outcome,reviewed_content,reviewer_snapshot,reviewed_at,review_controller_ingress_id,review_decision_sha256,created_at,updated_at) VALUES ($1,'tenant','workspace','service_account','svc','Stable.','rule',$2,'accepted','accept',NULL,$2,'2026-01-01T00:00:00Z','patch-ingress','af2653065e9db8c9592e836a09cac6b441158810d26f49fcf9962c04a10796a7',now(),now())`,
      [proposalId, actor],
    );
    await db.query(
      `INSERT INTO workspace_memory_entries(id,proposal_id,tenant_id,workspace_id,principal_type,principal_id,content,category,proposer_snapshot,reviewer_snapshot,review_outcome,accepted_at) VALUES ($1,$2,'tenant','workspace','service_account','svc','Stable.','rule',$3,$3,'accept',now())`,
      [entryId, proposalId, actor],
    );
    await db.query(
      `INSERT INTO workspace_memory_owned_entries(entry_id,proposal_id,tenant_id,workspace_id,principal_type,principal_id,content,content_hash,category,proposer_snapshot,reviewer_snapshot,accepted_at) VALUES ($1,$2,'tenant','workspace','service_account','svc','Stable.','content-hash','rule',$3,$3,now())`,
      [entryId, proposalId, actor],
    );
    await db.query(
      `INSERT INTO workspace_memory_snapshots(snapshot_id,tenant_id,workspace_id,version,content_hash,manifest_hash,projection_status) VALUES ($1,'tenant','workspace',1,'content-hash','manifest-hash','ready')`,
      [snapshotId],
    );
    await db.query(
      `INSERT INTO workspace_memory_snapshot_entries(snapshot_id,tenant_id,workspace_id,principal_type,principal_id,entry_id,ordinal) VALUES ($1,'tenant','workspace','service_account','svc',$2,0)`,
      [snapshotId, entryId],
    );
    await db.query(
      `INSERT INTO workspace_memory_projection_receipts(proposal_id,entry_id,snapshot_id,tenant_id,workspace_id,principal_type,principal_id,state) VALUES ($1,$2,$3,'tenant','workspace','service_account','svc','ready')`,
      [proposalId, entryId, snapshotId],
    );
    const channel = new PostgresChannelRepository(db);
    await channel.insertIngress({
      id: 'patch-context',
      connectionKey: 'lark',
      kind: 'message',
      externalKey: 'patch-context',
      chatId: 'chat',
      rootMessageId: 'root-patch',
      normalizationVersion: 'v1',
    });
    await db.query(
      `INSERT INTO channel_conversation_bindings(id,connection_key,chat_id,root_message_id,creating_ingress_id) VALUES ('patch-binding','lark','chat','root-patch','patch-context')`,
    );
    await db.query(
      `INSERT INTO lark_memory_review_surfaces(id,tenant_id,workspace_id,principal_type,principal_id,proposal_id,binding_id,version,mode,status,card_message_id,action_token_hash,creating_ingress_id,resolving_ingress_id,created_at,updated_at) VALUES ('patch-surface','tenant','workspace','service_account','svc',$1,'patch-binding',1,'card','resolved','card-1',$2,'patch-context','patch-ingress',now(),now())`,
      [proposalId, 'a'.repeat(64)],
    );
    const inserted = await channel.saveOutbox({
      id: 'patch-outbox',
      connectionKey: 'lark',
      bindingId: 'patch-binding',
      targetId: 'card-1',
      deliveryKind: 'lark_card_patch',
      aggregateId: proposalId,
      aggregateVersion: 1,
      payload: JSON.stringify({
        card: {
          schema: '2.0',
          config: {
            update_multi: true,
            enable_forward: false,
            width_mode: 'default',
          },
          header: {
            template: 'green',
            title: { tag: 'plain_text', content: 'Memory accepted' },
          },
          body: { elements: [] },
        },
      }),
      providerRequestId: 'patch-request',
    });
    const thread = await channel.saveOutbox({
      id: 'thread-outbox',
      connectionKey: 'lark',
      bindingId: 'patch-binding',
      targetId: 'card-1',
      deliveryKind: 'lark_thread_result',
      aggregateId: proposalId,
      aggregateVersion: 1,
      payload: 'Memory accepted: rule.',
      providerRequestId: 'thread-request',
    });
    await db.query(
      `UPDATE channel_outbox SET status='sending', lease_owner='patch-worker', lease_expires_at=now()+interval '1 minute', attempt_count=1 WHERE id='patch-outbox'`,
    );
    const claimed = {
      ...inserted.record,
      status: 'sending',
      attemptCount: 1,
      leaseOwner: 'patch-worker',
      leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    } as any;
    const beforeProposal = (
      await db.query<any>(
        'SELECT * FROM workspace_memory_proposals WHERE id=$1',
        [proposalId],
      )
    ).rows[0];
    const beforeEntryRows = (
      await db.query<any>(
        'SELECT * FROM workspace_memory_entries WHERE proposal_id=$1',
        [proposalId],
      )
    ).rows;
    const beforeSnapshotRows = (
      await db.query<any>(
        'SELECT * FROM workspace_memory_snapshots WHERE snapshot_id=$1',
        [snapshotId],
      )
    ).rows;
    const beforeMembershipRows = (
      await db.query<any>(
        'SELECT * FROM workspace_memory_snapshot_entries WHERE snapshot_id=$1',
        [snapshotId],
      )
    ).rows;
    const beforeReceiptRows = (
      await db.query<any>(
        'SELECT * FROM workspace_memory_projection_receipts WHERE proposal_id=$1',
        [proposalId],
      )
    ).rows;
    const beforeSurfaceRows = (
      await db.query<any>(
        "SELECT * FROM lark_memory_review_surfaces WHERE id='patch-surface'",
      )
    ).rows;
    const beforeThreadRows = (
      await db.query<any>('SELECT * FROM channel_outbox WHERE id=$1', [
        thread.record.id,
      ])
    ).rows;
    let firstAttempt = true;
    let providerCalls = 0;
    const provider = async () => {
      providerCalls += 1;
      return firstAttempt
        ? ((firstAttempt = false),
          {
            result: 'retryable_failure' as const,
            safeErrorCode: 'provider_unavailable',
          })
        : { result: 'delivered' as const, providerMessageId: 'card-patched' };
    };
    await new DeliverChannelOutbox({ deliver: provider }, channel).execute(
      claimed,
    );
    expect(
      (
        await db.query<any>(
          'SELECT status,last_safe_error FROM channel_outbox WHERE id=$1',
          [inserted.record.id],
        )
      ).rows[0],
    ).toMatchObject({
      status: 'retry_wait',
      last_safe_error: 'provider_unavailable',
    });
    expect(
      (
        await db.query<any>(
          'SELECT * FROM workspace_memory_proposals WHERE id=$1',
          [proposalId],
        )
      ).rows[0],
    ).toEqual(beforeProposal);
    expect(
      (
        await db.query<any>(
          'SELECT * FROM workspace_memory_entries WHERE proposal_id=$1',
          [proposalId],
        )
      ).rows,
    ).toEqual(beforeEntryRows);
    expect(
      (
        await db.query<any>(
          'SELECT * FROM workspace_memory_snapshots WHERE snapshot_id=$1',
          [snapshotId],
        )
      ).rows,
    ).toEqual(beforeSnapshotRows);
    expect(
      (
        await db.query<any>(
          'SELECT * FROM workspace_memory_snapshot_entries WHERE snapshot_id=$1',
          [snapshotId],
        )
      ).rows,
    ).toEqual(beforeMembershipRows);
    expect(
      (
        await db.query<any>(
          'SELECT * FROM workspace_memory_projection_receipts WHERE proposal_id=$1',
          [proposalId],
        )
      ).rows,
    ).toEqual(beforeReceiptRows);
    expect(
      (
        await db.query<any>(
          "SELECT * FROM lark_memory_review_surfaces WHERE id='patch-surface'",
        )
      ).rows,
    ).toEqual(beforeSurfaceRows);
    expect(
      (
        await db.query<any>('SELECT * FROM channel_outbox WHERE id=$1', [
          thread.record.id,
        ])
      ).rows,
    ).toEqual(beforeThreadRows);
    expect(JSON.stringify(claimed.payload)).not.toContain('token');
    expect(JSON.stringify(claimed.payload)).not.toContain('digest');
    await db.query(
      `UPDATE channel_outbox SET status='sending', lease_owner='patch-worker-retry', lease_expires_at=now()+interval '1 minute', attempt_count=2, next_attempt_at=NULL WHERE id='patch-outbox'`,
    );
    const retry = {
      ...claimed,
      status: 'sending',
      attemptCount: 2,
      leaseOwner: 'patch-worker-retry',
    } as any;
    expect(retry.id).toBe(inserted.record.id);
    await new DeliverChannelOutbox({ deliver: provider }, channel).execute(
      retry,
    );
    expect(
      (
        await db.query<any>(
          'SELECT status,attempt_count,last_safe_error FROM channel_outbox WHERE id=$1',
          [inserted.record.id],
        )
      ).rows[0],
    ).toMatchObject({
      status: 'delivered',
      attempt_count: 2,
      last_safe_error: null,
    });
    expect(
      (
        await db.query<any>(
          'SELECT * FROM channel_delivery_attempts WHERE outbox_id=$1 ORDER BY attempt_number',
          [inserted.record.id],
        )
      ).rows,
    ).toMatchObject([
      {
        attempt_number: 1,
        result: 'retryable_failure',
        provider_request_id: 'patch-request',
      },
      {
        attempt_number: 2,
        result: 'delivered',
        provider_request_id: 'patch-request',
      },
    ]);
    expect(providerCalls).toBe(2);
    expect(
      (
        await db.query<any>(
          'SELECT * FROM workspace_memory_proposals WHERE id=$1',
          [proposalId],
        )
      ).rows[0],
    ).toEqual(beforeProposal);
    expect(
      (
        await db.query<any>(
          'SELECT * FROM workspace_memory_entries WHERE proposal_id=$1',
          [proposalId],
        )
      ).rows,
    ).toEqual(beforeEntryRows);
    expect(
      (
        await db.query<any>(
          'SELECT * FROM workspace_memory_snapshots WHERE snapshot_id=$1',
          [snapshotId],
        )
      ).rows,
    ).toEqual(beforeSnapshotRows);
    expect(
      (
        await db.query<any>(
          'SELECT * FROM workspace_memory_snapshot_entries WHERE snapshot_id=$1',
          [snapshotId],
        )
      ).rows,
    ).toEqual(beforeMembershipRows);
    expect(
      (
        await db.query<any>(
          'SELECT * FROM workspace_memory_projection_receipts WHERE proposal_id=$1',
          [proposalId],
        )
      ).rows,
    ).toEqual(beforeReceiptRows);
    expect(
      (
        await db.query<any>(
          "SELECT * FROM lark_memory_review_surfaces WHERE id='patch-surface'",
        )
      ).rows,
    ).toEqual(beforeSurfaceRows);
    expect(
      (
        await db.query<any>('SELECT * FROM channel_outbox WHERE id=$1', [
          thread.record.id,
        ])
      ).rows,
    ).toEqual(beforeThreadRows);
    expect(
      (
        await db.query<any>(
          'SELECT count(*)::int AS count FROM workspace_memory_entries WHERE proposal_id=$1',
          [proposalId],
        )
      ).rows[0].count,
    ).toBe(1);
    expect(
      (
        await db.query<any>(
          'SELECT count(*)::int AS count FROM workspace_memory_snapshots WHERE snapshot_id=$1',
          [snapshotId],
        )
      ).rows[0].count,
    ).toBe(1);
    expect(
      (
        await db.query<any>(
          'SELECT count(*)::int AS count FROM workspace_memory_projection_receipts WHERE proposal_id=$1',
          [proposalId],
        )
      ).rows[0].count,
    ).toBe(1);
    expect(JSON.stringify(beforeThreadRows)).not.toContain('token');
    expect(JSON.stringify(beforeThreadRows)).not.toContain('digest');
    expect(JSON.stringify(beforeThreadRows)).not.toContain('callback');
    expect(JSON.stringify(beforeThreadRows)).not.toContain(
      'provider_unavailable',
    );
    await db.close();
  });
  it.each([
    'delivered',
    'retryable_failure',
    'permanent_failure',
    'unknown',
  ] as const)('records %s exactly once', async (result) => {
    const deliver = vi.fn().mockResolvedValue({
      result,
      providerMessageId: result === 'delivered' ? 'provider-1' : undefined,
      safeErrorCode: result === 'delivered' ? undefined : `safe_${result}`,
    });
    const recordAttempt = vi.fn();
    await new DeliverChannelOutbox({ deliver }, { recordAttempt }).execute(
      outbox,
    );
    expect(deliver).toHaveBeenCalledWith({
      kind: 'text',
      targetId: 'target-1',
      text: 'payload',
      providerRequestId: 'request-1',
    });
    expect(recordAttempt).toHaveBeenCalledOnce();
    expect(recordAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        outboxId: 'outbox-1',
        attemptNumber: 2,
        providerRequestId: 'request-1',
        result,
      }),
    );
  });

  it('routes Card patches while rejecting Card replies without cohesive publication wiring', async () => {
    const deliver = vi.fn().mockResolvedValue({ result: 'delivered' });
    const recordAttempt = vi.fn();
    await new DeliverChannelOutbox({ deliver }, { recordAttempt }).execute({
      ...outbox,
      deliveryKind: 'lark_card_reply',
      payload: JSON.stringify({ card: JSON.parse(cardPayload) }),
    });
    expect(deliver).not.toHaveBeenCalled();
    expect(recordAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ safeErrorCode: 'invalid_delivery_payload' }),
    );
    await new DeliverChannelOutbox({ deliver }, { recordAttempt }).execute({
      ...outbox,
      deliveryKind: 'lark_card_patch',
      payload: JSON.stringify({ card: JSON.parse(cardPayload) }),
    });
    expect(deliver).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'card_patch' }),
    );
  });

  it('materializes a tokenless descriptor immediately before delivery', async () => {
    const deriver = createMemoryReviewActionTokenDeriver('secret');
    const descriptor = {
      type: 'lark_memory_review_card_v1',
      surfaceId: 'surface-1',
      version: 1,
      proposalId: 'proposal-1',
      bindingId: 'binding-1',
      owner: {
        tenantId: 'tenant',
        workspaceId: 'workspace',
        principalType: 'service_account',
        principalId: 'owner',
      },
      category: 'constraint',
      content: 'Keep it reversible.',
      source: 'Proposed by the completed agent task in this thread.',
    };
    const validateCardPublication = vi.fn(async () => undefined);
    const deliver = vi
      .fn()
      .mockResolvedValue({ result: 'delivered', providerMessageId: 'card-1' });
    await new DeliverChannelOutbox({ deliver }, { recordAttempt: vi.fn() }, {
      cards: testMemoryReviewCardRenderer,
      tokenDeriver: deriver,
      validateCardPublication,
      finalizeCardDelivery: vi.fn(),
    } as never).execute({
      ...outbox,
      deliveryKind: 'lark_card_reply',
      aggregateId: 'proposal-1',
      bindingId: 'binding-1',
      aggregateVersion: 1,
      payload: JSON.stringify(descriptor),
    });
    expect(validateCardPublication).toHaveBeenCalledWith(
      expect.objectContaining({
        surfaceId: 'surface-1',
        version: 1,
        proposalId: 'proposal-1',
        bindingId: 'binding-1',
        actionTokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    const card = JSON.parse(deliver.mock.calls[0]![0].cardJson);
    expect(card).toMatchObject({
      schema: '2.0',
      config: expect.any(Object),
      header: expect.any(Object),
      body: expect.any(Object),
    });
    expect(card.card).toBeUndefined();
    const token =
      card.body.elements[3].columns[0].elements[0].behaviors[0].value.token;
    expect(JSON.stringify(descriptor)).not.toContain(token);
    expect(token).toBe(deriver.derive({ surfaceId: 'surface-1', version: 1 }));
  });

  it('retries the production tokenless descriptor as byte-identical bare Card JSON with stable provider UUID', async () => {
    const deriver = createMemoryReviewActionTokenDeriver('secret');
    const descriptor = {
      type: 'lark_memory_review_card_v1',
      surfaceId: 'surface-1',
      version: 1,
      proposalId: 'proposal-1',
      bindingId: 'binding-1',
      owner: {
        tenantId: 'tenant',
        workspaceId: 'workspace',
        principalType: 'service_account',
        principalId: 'owner',
      },
      category: 'constraint',
      content: 'Keep it reversible.',
      source: 'Proposed by the completed agent task in this thread.',
    };
    const deliver = vi.fn().mockResolvedValue({
      result: 'retryable_failure',
      safeErrorCode: 'temporary',
    });
    const service = new DeliverChannelOutbox(
      { deliver },
      { recordAttempt: vi.fn() },
      {
        cards: testMemoryReviewCardRenderer,
        tokenDeriver: deriver,
        validateCardPublication: vi.fn(async () => undefined),
        finalizeCardDelivery: vi.fn(),
      } as never,
    );
    const payload = JSON.stringify(descriptor);
    await service.execute({
      ...outbox,
      id: 'retry-1',
      attemptCount: 1,
      deliveryKind: 'lark_card_reply',
      aggregateId: 'proposal-1',
      bindingId: 'binding-1',
      aggregateVersion: 1,
      payload,
    });
    await service.execute({
      ...outbox,
      id: 'retry-2',
      attemptCount: 2,
      deliveryKind: 'lark_card_reply',
      aggregateId: 'proposal-1',
      bindingId: 'binding-1',
      aggregateVersion: 1,
      payload,
    });
    expect(deliver.mock.calls[0]![0].cardJson).toBe(
      deliver.mock.calls[1]![0].cardJson,
    );
    expect(deliver.mock.calls[0]![0].providerRequestId).toBe(
      deliver.mock.calls[1]![0].providerRequestId,
    );
    expect(JSON.parse(deliver.mock.calls[0]![0].cardJson).card).toBeUndefined();
  });

  it('materializes tokenless Doc control patches just before provider delivery', async () => {
    const deriver = createMemoryReviewActionTokenDeriver('secret');
    const descriptor = {
      type: 'lark_memory_doc_control_patch_v1',
      surfaceId: 'surface-1',
      version: 1,
      proposalId: 'proposal-1',
      bindingId: 'binding-1',
      owner: {
        tenantId: 'tenant',
        workspaceId: 'workspace',
        principalType: 'service_account',
        principalId: 'owner',
      },
      category: 'constraint',
      excerpt: 'Doc excerpt',
      docToken: 'doc-1',
      docStatus: 'Ready',
      previewed: false,
    };
    const deliver = vi
      .fn()
      .mockResolvedValue({ result: 'delivered', providerMessageId: 'patch-1' });
    const payload = JSON.stringify(descriptor);
    await new DeliverChannelOutbox({ deliver }, { recordAttempt: vi.fn() }, {
      cards: testMemoryReviewCardRenderer,
      tokenDeriver: deriver,
      validateCardPublication: vi.fn(async () => undefined),
      finalizeCardDelivery: vi.fn(),
      docWebBaseUrl: 'https://lark.test',
    } as never).execute({
      ...outbox,
      deliveryKind: 'lark_card_patch',
      payload,
    });
    expect(payload).not.toContain(
      deriver.derive({ surfaceId: 'surface-1', version: 1 }),
    );
    const card = JSON.parse(deliver.mock.calls[0]![0].cardJson);
    expect(card.schema).toBe('2.0');
    expect(JSON.stringify(card)).toContain(
      deriver.derive({ surfaceId: 'surface-1', version: 1 }),
    );
  });

  it('fails closed on descriptor/hash validation without contacting the provider', async () => {
    const deliver = vi.fn();
    const recordAttempt = vi.fn();
    const validateCardPublication = vi
      .fn()
      .mockRejectedValue(new Error('invalid memory review Card descriptor'));
    await new DeliverChannelOutbox(
      { deliver },
      { recordAttempt },
      {
        cards: testMemoryReviewCardRenderer,
        tokenDeriver: createMemoryReviewActionTokenDeriver('secret'),
        validateCardPublication,
        finalizeCardDelivery: vi.fn(),
      },
    ).execute({
      ...outbox,
      deliveryKind: 'lark_card_reply',
      payload: JSON.stringify({
        type: 'lark_memory_review_card_v1',
        surfaceId: 'surface-1',
        version: 1,
        proposalId: 'proposal-1',
        bindingId: 'binding-1',
        owner: {
          tenantId: 'tenant',
          workspaceId: 'workspace',
          principalType: 'service_account',
          principalId: 'owner',
        },
        category: 'constraint',
        content: 'Keep it reversible.',
        source: 'Proposed by the completed agent task in this thread.',
      }),
    });
    expect(deliver).not.toHaveBeenCalled();
    expect(recordAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        result: 'permanent_failure',
        safeErrorCode: 'invalid_delivery_payload',
      }),
    );
  });

  it('finalizes delivered Card and attempt together, never recording delivered first', async () => {
    const recordAttempt = vi.fn();
    const finalizeCardDelivery = vi.fn(async () => undefined);
    const deliver = vi
      .fn()
      .mockResolvedValue({ result: 'delivered', providerMessageId: 'card-1' });
    const descriptor = {
      type: 'lark_memory_review_card_v1',
      surfaceId: 'surface-1',
      version: 1,
      proposalId: 'proposal-1',
      bindingId: 'binding-1',
      owner: {
        tenantId: 'tenant',
        workspaceId: 'workspace',
        principalType: 'service_account',
        principalId: 'owner',
      },
      category: 'constraint',
      content: 'Keep it reversible.',
      source: 'Proposed by the completed agent task in this thread.',
    };
    await new DeliverChannelOutbox({ deliver }, { recordAttempt }, {
      cards: testMemoryReviewCardRenderer,
      tokenDeriver: createMemoryReviewActionTokenDeriver('secret'),
      validateCardPublication: vi.fn(async () => undefined),
      finalizeCardDelivery,
    } as never).execute({
      ...outbox,
      deliveryKind: 'lark_card_reply',
      aggregateId: 'proposal-1',
      bindingId: 'binding-1',
      aggregateVersion: 1,
      payload: JSON.stringify(descriptor),
    });
    expect(recordAttempt).not.toHaveBeenCalled();
    expect(finalizeCardDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        providerMessageId: 'card-1',
        surfaceId: 'surface-1',
        version: 1,
      }),
    );
  });

  it('classifies a delivered tokenless Card without a provider id as unknown without finalization', async () => {
    const recordAttempt = vi.fn();
    const deliver = vi.fn().mockResolvedValue({ result: 'delivered' });
    const finalizeCardDelivery = vi.fn();
    const descriptor = {
      type: 'lark_memory_review_card_v1',
      surfaceId: 'surface-1',
      version: 1,
      proposalId: 'proposal-1',
      bindingId: 'binding-1',
      owner: {
        tenantId: 'tenant',
        workspaceId: 'workspace',
        principalType: 'service_account',
        principalId: 'owner',
      },
      category: 'constraint',
      content: 'Keep it reversible.',
      source: 'Proposed by the completed agent task in this thread.',
    };
    await new DeliverChannelOutbox({ deliver }, { recordAttempt }, {
      cards: testMemoryReviewCardRenderer,
      tokenDeriver: createMemoryReviewActionTokenDeriver('secret'),
      validateCardPublication: vi.fn(async () => undefined),
      finalizeCardDelivery,
    } as never).execute({
      ...outbox,
      deliveryKind: 'lark_card_reply',
      aggregateId: 'proposal-1',
      bindingId: 'binding-1',
      aggregateVersion: 1,
      payload: JSON.stringify(descriptor),
    });
    expect(recordAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        result: 'unknown',
        safeErrorCode: 'missing_provider_message_id',
      }),
    );
    expect(finalizeCardDelivery).not.toHaveBeenCalled();
  });

  it.each([
    ['proposal', { proposalId: 'other' }],
    ['binding', { bindingId: 'other' }],
    ['version', { version: 2 }],
  ])(
    'rejects claimed outbox %s descriptor mismatch before provider contact',
    async (_label, change) => {
      const deliver = vi.fn();
      const recordAttempt = vi.fn();
      const descriptor = {
        type: 'lark_memory_review_card_v1',
        surfaceId: 'surface-1',
        version: 1,
        proposalId: 'proposal-1',
        bindingId: 'binding-1',
        owner: {
          tenantId: 'tenant',
          workspaceId: 'workspace',
          principalType: 'service_account',
          principalId: 'owner',
        },
        category: 'constraint',
        content: 'Keep it reversible.',
        source: 'Proposed by the completed agent task in this thread.',
        ...change,
      };
      await new DeliverChannelOutbox({ deliver }, { recordAttempt }, {
        cards: testMemoryReviewCardRenderer,
        tokenDeriver: createMemoryReviewActionTokenDeriver('secret'),
        validateCardPublication: vi.fn(async () => undefined),
        finalizeCardDelivery: vi.fn(),
      } as never).execute({
        ...outbox,
        deliveryKind: 'lark_card_reply',
        aggregateId: 'proposal-1',
        bindingId: 'binding-1',
        aggregateVersion: 1,
        payload: JSON.stringify(descriptor),
      });
      expect(deliver).not.toHaveBeenCalled();
    },
  );

  it('records malformed Card payloads safely without delivery', async () => {
    const deliver = vi.fn();
    const recordAttempt = vi.fn();
    await new DeliverChannelOutbox({ deliver }, { recordAttempt }).execute({
      ...outbox,
      deliveryKind: 'lark_card_reply',
      payload: '{bad',
    });
    expect(deliver).not.toHaveBeenCalled();
    expect(recordAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        result: 'permanent_failure',
        safeErrorCode: 'invalid_delivery_payload',
      }),
    );
  });

  it('rejects unknown delivery kinds without invoking the provider', async () => {
    const deliver = vi.fn();
    const recordAttempt = vi.fn();
    await new DeliverChannelOutbox({ deliver }, { recordAttempt }).execute({
      ...outbox,
      deliveryKind: 'not-supported',
    });
    expect(deliver).not.toHaveBeenCalled();
    expect(recordAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        result: 'permanent_failure',
        safeErrorCode: 'unsupported_delivery_kind',
      }),
    );
  });

  it('rejects missing delivery kinds without invoking the provider', async () => {
    const deliver = vi.fn();
    const recordAttempt = vi.fn();
    const missing = { ...outbox } as ChannelOutbox;
    delete (missing as { deliveryKind?: string }).deliveryKind;
    await new DeliverChannelOutbox({ deliver }, { recordAttempt }).execute(
      missing,
    );
    expect(deliver).not.toHaveBeenCalled();
    expect(recordAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        result: 'permanent_failure',
        safeErrorCode: 'unsupported_delivery_kind',
      }),
    );
  });

  it.each([
    {},
    { type: 'bad' },
    { type: 'lark_memory_review_card_v1', version: 0 },
    { type: 'lark_memory_review_card_v1', surfaceId: '' },
    { type: 'lark_memory_review_card_v1', content: 'x'.repeat(1501) },
  ])('rejects malformed tokenless descriptors safely: %j', async (payload) => {
    const deliver = vi.fn();
    const recordAttempt = vi.fn();
    await new DeliverChannelOutbox({ deliver }, { recordAttempt }).execute({
      ...outbox,
      deliveryKind: 'lark_card_reply',
      payload: JSON.stringify(payload),
    });
    expect(deliver).not.toHaveBeenCalled();
    expect(recordAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        result: 'permanent_failure',
        safeErrorCode: 'invalid_delivery_payload',
      }),
    );
  });
});
