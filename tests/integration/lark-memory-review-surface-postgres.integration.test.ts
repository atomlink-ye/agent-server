import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

import { PostgresLarkReviewSurfaceRepository } from '../../src/infrastructure/postgres/postgres-lark-review-surface-repository.js';
import { PostgresChannelRepository } from '../../src/infrastructure/postgres/postgres-channel-repository.js';
import { applyDurableKernelMigrations } from '../../src/infrastructure/postgres/postgres.js';
import { sha256Preview } from '../../src/domain/channels/lark-memory-review-surface.js';
import type { LarkMemoryReviewSurface } from '../../src/domain/channels/lark-memory-review-surface.js';

const owner = {
  tenantId: 'tenant_review',
  workspaceId: 'workspace_review',
  principalType: 'service_account',
  principalId: 'svc_review',
};

function surface(
  overrides: Partial<LarkMemoryReviewSurface> = {},
): LarkMemoryReviewSurface {
  return {
    id: 'surface-1',
    ...owner,
    proposalId: '00000000-0000-4000-8000-000000000901',
    bindingId: 'binding-1',
    version: 1,
    mode: 'card_with_doc',
    status: 'active_card_with_doc',
    cardMessageId: 'card-1',
    docToken: 'doc-1',
    docRevision: 'rev-1',
    previewContent: null,
    previewSha256: null,
    actionTokenHash: 'a'.repeat(64),
    creatingIngressId: 'ingress-1',
    resolvingIngressId: null,
    createdAt: '2026-07-25T00:00:00.000Z',
    updatedAt: '2026-07-25T00:00:00.000Z',
    ...overrides,
  };
}

describe('Lark memory review surfaces (PGlite)', () => {
  it('Task11 validates a real card_action preview successor and same-ingress replay', async () => {
    const database = new PGlite();
    await applyDurableKernelMigrations(database);
    const proposalId = '00000000-0000-0000-0000-000000000910';
    const sessionId = '00000000-0000-0000-0000-000000000911';
    const digest = 'f'.repeat(64);
    await database.query(
      `INSERT INTO workspaces(id,tenant_id,principal_type,principal_id,name,created_at,updated_at) VALUES ('00000000-0000-0000-0000-000000000912',$1,'service_account','svc_review','Review',now(),now())`,
      [owner.tenantId],
    );
    await database.query(
      `INSERT INTO product_sessions(id,workspace_id,tenant_id,principal_type,principal_id,published_agent_version_id,created_at,updated_at) VALUES ($1,'00000000-0000-0000-0000-000000000912',$2,'service_account','svc_review','agent',now(),now())`,
      [sessionId, owner.tenantId],
    );
    await database.query(
      `INSERT INTO workspace_memory_proposals(id,tenant_id,workspace_id,principal_type,principal_id,original_content,original_category,source_session_id,proposer_snapshot,status,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,'card preview','rule',$6,'{}','pending',now(),now())`,
      [proposalId, ...Object.values(owner), sessionId],
    );
    await database.query(
      `INSERT INTO channel_ingress_events(id,connection_key,kind,external_key,external_message_id,chat_id,root_message_id,external_actor_id,action,normalization_version,status,attempt_count,lease_owner,lease_expires_at) VALUES
       ('task11-root','lark-canary','message','task11-root','root-task11','chat-task11','root-task11','actor-task11','{}','v1','processed',1,NULL,NULL),
       ('task11-preview','lark-canary','card_action','task11-preview','card-task11','chat-task11',NULL,'actor-task11',$1,'v1','processing',3,'worker-task11',now()+interval '1 minute')`,
      [JSON.stringify({ action: 'preview_doc', digest })],
    );
    await database.query(
      `INSERT INTO channel_conversation_bindings(id,connection_key,chat_id,root_message_id,session_id,creating_ingress_id) VALUES ('binding-task11','lark-canary','chat-task11','root-task11',$1,'task11-root')`,
      [sessionId],
    );
    const repository = new PostgresLarkReviewSurfaceRepository(database);
    const predecessor = await repository.createSurface(
      surface({
        id: 'task11-predecessor',
        proposalId,
        bindingId: 'binding-task11',
        cardMessageId: 'card-task11',
        creatingIngressId: 'task11-root',
        actionTokenHash: digest,
      }),
    );
    const preview = await repository.savePreview({
      id: predecessor.id,
      owner,
      content: 'preview content',
      sha256: sha256Preview('preview content'),
      creatingIngressId: 'task11-preview',
      now: '2026-07-25T00:10:00.000Z',
    });
    expect(preview).toMatchObject({
      version: 2,
      status: 'processing',
      creatingIngressId: 'task11-preview',
    });
    const authorize = (overrides: Record<string, unknown> = {}) =>
      repository.authorizeCardAction({
        actionTokenHash: digest,
        ingressId: 'task11-preview',
        leaseOwner: 'worker-task11',
        attemptNumber: 3,
        actionDigest: digest,
        cardMessageId: 'card-task11',
        connectionKey: 'lark-canary',
        chatId: 'chat-task11',
        actorId: 'actor-task11',
        action: 'preview_doc',
        owner,
        ...overrides,
      });
    await expect(authorize()).resolves.toMatchObject({
      surface: { id: preview.id, version: 2 },
    });
    for (const change of [
      { ingressId: 'missing-ingress' },
      { actionDigest: 'e'.repeat(64) },
      { action: 'accept_preview' },
      { actorId: 'other-actor' },
      { attemptNumber: 4 },
    ]) {
      await expect(authorize(change)).rejects.toThrow(
        'card_action_not_authorized',
      );
    }
    await expect(
      repository.authorizeCardAction({
        actionTokenHash: digest,
        ingressId: 'task11-root',
        leaseOwner: 'worker-task11',
        attemptNumber: 1,
        actionDigest: digest,
        cardMessageId: 'card-task11',
        connectionKey: 'lark-canary',
        chatId: 'chat-task11',
        actorId: 'actor-task11',
        action: 'preview_doc',
        owner,
      }),
    ).rejects.toThrow();
    await database.query(
      `UPDATE channel_ingress_events SET status='processed', lease_owner=NULL, lease_expires_at=NULL WHERE id='task11-preview'`,
    );
    await database.query(
      `INSERT INTO channel_ingress_events(id,connection_key,kind,external_key,external_message_id,chat_id,external_actor_id,action,normalization_version,status,attempt_count,lease_owner,lease_expires_at) VALUES ('task11-accept','lark-canary','card_action','task11-accept','card-task11','chat-task11','actor-task11',$1,'v1','processing',1,'worker-task11',now()+interval '1 minute')`,
      [
        JSON.stringify({
          action: 'accept_preview',
          digest: preview.actionTokenHash,
        }),
      ],
    );
    await expect(
      repository.authorizeCardAction({
        actionTokenHash: preview.actionTokenHash!,
        ingressId: 'task11-accept',
        leaseOwner: 'worker-task11',
        attemptNumber: 1,
        actionDigest: preview.actionTokenHash!,
        cardMessageId: 'card-task11',
        connectionKey: 'lark-canary',
        chatId: 'chat-task11',
        actorId: 'actor-task11',
        action: 'accept_preview',
        owner,
      }),
    ).resolves.toMatchObject({ surface: { id: preview.id, version: 2 } });
    await database.close();
  });

  it('A10 rejects a Card control tied to a different surface version without UI mutation', async () => {
    const database = new PGlite();
    await applyDurableKernelMigrations(database);
    const localOwner = {
      tenantId: 'tenant_a10',
      workspaceId: 'workspace_a10',
      principalType: 'service_account',
      principalId: 'svc_a10',
    };
    const proposalId = '00000000-0000-4000-8000-000000000991';
    const sessionId = '00000000-0000-0000-0000-000000000992';
    await database.query(
      `INSERT INTO workspaces(id,tenant_id,principal_type,principal_id,name,created_at,updated_at) VALUES ('00000000-0000-4000-8000-000000000993',$1,'service_account','svc_a10','A10',now(),now())`,
      [localOwner.tenantId],
    );
    await database.query(
      `INSERT INTO product_sessions(id,workspace_id,tenant_id,principal_type,principal_id,published_agent_version_id,created_at,updated_at) VALUES ($1,'00000000-0000-4000-8000-000000000993',$2,'service_account','svc_a10','agent',now(),now())`,
      [sessionId, localOwner.tenantId],
    );
    await database.query(
      `INSERT INTO workspace_memory_proposals(id,tenant_id,workspace_id,principal_type,principal_id,original_content,original_category,source_session_id,proposer_snapshot,status,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,'A10','rule',$6,'{}','pending',now(),now())`,
      [proposalId, ...Object.values(localOwner), sessionId],
    );
    await database.query(
      `INSERT INTO channel_ingress_events(id,connection_key,kind,external_key,external_message_id,chat_id,root_message_id,external_actor_id,action,normalization_version,status,attempt_count,lease_owner,lease_expires_at) VALUES ('a10-create','lark','message','a10-create','root-a10','chat-a10','root-a10','actor-a10','{}','v1','processed',1,NULL,NULL),('a10-card','lark','card_action','a10-card','card-a10','chat-a10',NULL,'actor-a10',$1,'v1','processing',1,'worker',now()+interval '1 minute')`,
      [JSON.stringify({ action: 'accept', digest: 'a'.repeat(64) })],
    );
    await database.query(
      `INSERT INTO channel_conversation_bindings(id,connection_key,chat_id,root_message_id,session_id,creating_ingress_id) VALUES ('a10-binding','lark','chat-a10','root-a10',$1,'a10-create')`,
      [sessionId],
    );
    const repository = new PostgresLarkReviewSurfaceRepository(database);
    await repository.createSurface({
      id: 'a10-surface',
      ...localOwner,
      proposalId,
      bindingId: 'a10-binding',
      version: 1,
      mode: 'card',
      status: 'active_card',
      cardMessageId: 'card-a10',
      docToken: null,
      docRevision: null,
      previewContent: null,
      previewSha256: null,
      actionTokenHash: 'a'.repeat(64),
      creatingIngressId: 'a10-create',
      resolvingIngressId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await expect(
      repository.authorizeCardAction({
        actionTokenHash: 'a'.repeat(64),
        version: 2,
        ingressId: 'a10-card',
        leaseOwner: 'worker',
        attemptNumber: 1,
        actionDigest: 'a'.repeat(64),
        cardMessageId: 'card-a10',
        connectionKey: 'lark',
        chatId: 'chat-a10',
        actorId: 'actor-a10',
        action: 'accept',
        owner: localOwner,
      }),
    ).rejects.toThrow();
    await database.query(
      `UPDATE workspace_memory_proposals SET status='accepted',review_outcome='accept',reviewer_snapshot='{}',reviewed_at=now(),review_controller_ingress_id='a10-card',review_decision_sha256='af2653065e9db8c9592e836a09cac6b441158810d26f49fcf9962c04a10796a7' WHERE id=$1`,
      [proposalId],
    );
    const beforeProposal = (
      await database.query<any>(
        'SELECT * FROM workspace_memory_proposals WHERE id=$1',
        [proposalId],
      )
    ).rows[0];
    await expect(
      repository.resolveSurfaceAndCreateTerminalOutboxes({
        surface: {
          id: 'a10-surface',
          ...localOwner,
          proposalId,
          bindingId: 'a10-binding',
          version: 2,
          mode: 'card',
          status: 'active_card',
          cardMessageId: 'card-a10',
          docToken: null,
          docRevision: null,
          previewContent: null,
          previewSha256: null,
          actionTokenHash: 'a'.repeat(64),
          creatingIngressId: 'a10-create',
          resolvingIngressId: null,
          createdAt: '',
          updatedAt: '',
        },
        owner: localOwner,
        ingressId: 'a10-card',
        leaseOwner: 'worker',
        attemptNumber: 1,
        actionDigest: 'a'.repeat(64),
        actorId: 'actor-a10',
        connectionKey: 'lark',
        chatId: 'chat-a10',
        outcome: 'accepted',
        category: 'rule',
        content: 'A10',
        card: { schema: '2.0' },
        threadText: 'Memory accepted: rule.',
      }),
    ).rejects.toThrow();
    expect(
      (
        await database.query<any>(
          `SELECT status FROM lark_memory_review_surfaces WHERE id='a10-surface'`,
        )
      ).rows[0].status,
    ).toBe('active_card');
    expect(
      (
        await database.query<any>(
          `SELECT * FROM workspace_memory_proposals WHERE id=$1`,
          [proposalId],
        )
      ).rows[0],
    ).toEqual(beforeProposal);
    expect(
      (
        await database.query<any>(
          `SELECT count(*)::int AS count FROM channel_outbox`,
        )
      ).rows[0].count,
    ).toBe(0);
    await database.close();
  });

  it('enforces owner scope, immutable previews, active-version CAS, and resolve replay', async () => {
    const database = new PGlite();
    await applyDurableKernelMigrations(database);
    await database.query(
      `INSERT INTO workspaces(id, tenant_id, principal_type, principal_id, name, created_at, updated_at) VALUES ('00000000-0000-4000-8000-000000000902',$1,'service_account','svc_review','Review',now(),now())`,
      [owner.tenantId],
    );
    await database.query(
      `INSERT INTO product_sessions(id, workspace_id, tenant_id, principal_type, principal_id, published_agent_version_id, created_at, updated_at) VALUES ('00000000-0000-0000-0000-000000000903','00000000-0000-4000-8000-000000000902',$1,'service_account','svc_review','agent',now(),now())`,
      [owner.tenantId],
    );
    await database.query(
      `INSERT INTO workspace_memory_proposals(id, tenant_id, workspace_id, principal_type, principal_id, original_content, original_category, source_session_id, proposer_snapshot, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,'proposal','constraint','00000000-0000-0000-0000-000000000903','{}','pending',now(),now())`,
      [
        surface().proposalId,
        owner.tenantId,
        owner.workspaceId,
        owner.principalType,
        owner.principalId,
      ],
    );
    await database.query(
      `INSERT INTO channel_ingress_events(id, connection_key, kind, external_key, external_message_id, chat_id, root_message_id, normalization_version) VALUES
        ('ingress-1','lark-canary','message','external-1','root-1','chat-1',NULL,'v1'),
        ('ingress-command','lark-canary','command','external-command','command-1','chat-1','root-1','v1'),
        ('ingress-2','lark-canary','card_action','external-2','card-1','chat-1',NULL,'v1'),
        ('ingress-preview','lark-canary','command','external-preview','command-preview','chat-1','root-1','v1'),
        ('ingress-wrong-card','lark-canary','card_action','external-wrong','wrong-card','chat-1',NULL,'v1'),
        ('ingress-wrong-root','lark-canary','message','external-wrong-root','wrong-root','chat-1',NULL,'v1'),
        ('ingress-other','other-connection','command','external-other','other-command','other-chat','other-root','v1')`,
    );
    await database.query(
      `INSERT INTO channel_conversation_bindings(id, connection_key, chat_id, root_message_id, session_id, creating_ingress_id) VALUES ('binding-1','lark-canary','chat-1','root-1','00000000-0000-0000-0000-000000000903','ingress-1')`,
    );
    const repository = new PostgresLarkReviewSurfaceRepository(database);
    const first = await repository.createSurface(surface());
    await expect(repository.createSurface(surface())).resolves.toMatchObject({
      id: first.id,
    });
    await expect(
      repository.createSurface(surface({ id: 'different-surface-id' })),
    ).rejects.toThrow('logical conflict');
    await expect(
      repository.createSurface(
        surface({ id: 'different-owner', principalId: 'other-principal' }),
      ),
    ).rejects.toThrow();
    await expect(
      repository.createSurface(
        surface({ id: 'wrong-ingress', creatingIngressId: 'ingress-other' }),
      ),
    ).rejects.toThrow('context');
    await expect(
      repository.createSurface(
        surface({ id: 'wrong-root', creatingIngressId: 'ingress-wrong-root' }),
      ),
    ).rejects.toThrow('context');
    expect(await repository.getSurface(first.id, owner)).toMatchObject({
      id: first.id,
    });
    expect(
      await repository.getSurface(first.id, { ...owner, workspaceId: 'other' }),
    ).toBeNull();
    expect(
      await repository.getSurfaceByActionTokenHash({
        actionTokenHash: 'a'.repeat(64),
        owner,
      }),
    ).toMatchObject({ id: first.id });

    for (const [proposalId, status, surfaceId] of [
      ['00000000-0000-4000-8000-000000000904', 'accepted', 'accepted-surface'],
      ['00000000-0000-4000-8000-000000000905', 'rejected', 'rejected-surface'],
    ] as const) {
      await database.query(
        `INSERT INTO workspace_memory_proposals(id, tenant_id, workspace_id, principal_type, principal_id, original_content, original_category, source_session_id, proposer_snapshot, status, review_outcome, reviewer_snapshot, reviewed_at, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,'proposal','constraint','00000000-0000-0000-0000-000000000903','{}',$6,$7,'{}',now(),now(),now())`,
        [
          proposalId,
          owner.tenantId,
          owner.workspaceId,
          owner.principalType,
          owner.principalId,
          status,
          status === 'accepted' ? 'accept' : 'reject',
        ],
      );
      await expect(
        repository.claimActiveVersion({
          surface: surface({
            id: surfaceId,
            proposalId,
            creatingIngressId: 'ingress-command',
            actionTokenHash: '9'.repeat(64),
          }),
          expectedActiveVersion: null,
        }),
      ).rejects.toThrow('pending');
    }

    const second = await repository.claimActiveVersion({
      surface: surface({
        id: 'surface-2',
        version: 2,
        creatingIngressId: 'ingress-command',
        actionTokenHash: 'b'.repeat(64),
      }),
      expectedActiveVersion: 1,
    });
    expect(second.version).toBe(2);
    expect((await repository.getSurface(first.id, owner))?.status).toBe(
      'stale',
    );
    await expect(
      repository.claimActiveVersion({
        surface: surface({
          id: 'failed-replacement',
          version: 3,
          creatingIngressId: 'ingress-command',
          actionTokenHash: 'invalid',
        }),
        expectedActiveVersion: 2,
      }),
    ).rejects.toThrow();
    expect((await repository.getSurface(second.id, owner))?.status).toBe(
      'active_card_with_doc',
    );
    await expect(
      repository.claimActiveVersion({
        surface: surface({
          id: 'surface-3',
          version: 3,
          creatingIngressId: 'ingress-command',
          actionTokenHash: 'c'.repeat(64),
        }),
        expectedActiveVersion: 1,
      }),
    ).rejects.toThrow('stale');

    const content = 'edited ✓';
    const preview = await repository.savePreview({
      id: second.id,
      owner,
      content,
      sha256: sha256Preview(content),
      creatingIngressId: 'ingress-preview',
      docRevision: 'rev-2',
      deriveActionTokenHash: (surfaceId, version) =>
        sha256Preview(`${surfaceId}:${version}`),
      now: '2026-07-25T00:01:00.000Z',
    });
    expect(preview.previewContent).toBe(content);
    expect(preview.version).toBe(3);
    expect(preview.id).not.toBe(second.id);
    expect(preview.docRevision).toBe('rev-2');
    expect(preview.actionTokenHash).toBe(
      sha256Preview(`${preview.id}:${preview.version}`),
    );
    await expect(
      repository.resolveSurface({
        id: second.id,
        owner,
        version: 2,
        ingressId: 'ingress-old',
        now: '2026-07-25T00:02:30.000Z',
      }),
    ).rejects.toThrow();
    await expect(
      repository.resolveSurface({
        id: preview.id,
        owner,
        version: preview.version,
        ingressId: 'ingress-wrong-card',
        now: '2026-07-25T00:02:30.000Z',
      }),
    ).rejects.toThrow('context');
    await expect(
      repository.savePreview({
        id: preview.id,
        owner,
        content: 'late edit',
        sha256: sha256Preview('late edit'),
        creatingIngressId: 'ingress-preview',
        now: '2026-07-25T00:02:00.000Z',
      }),
    ).rejects.toThrow('immutable');
    const resolved = await repository.resolveSurface({
      id: preview.id,
      owner,
      version: preview.version,
      ingressId: 'ingress-2',
      now: '2026-07-25T00:03:00.000Z',
    });
    expect(resolved.status).toBe('resolved');
    await expect(
      repository.resolveSurface({
        id: preview.id,
        owner,
        version: preview.version,
        ingressId: 'ingress-2',
        now: '2026-07-25T00:04:00.000Z',
      }),
    ).resolves.toMatchObject({ status: 'resolved' });
    await database.query(
      `INSERT INTO workspace_memory_proposals(id, tenant_id, workspace_id, principal_type, principal_id, original_content, original_category, source_session_id, proposer_snapshot, status, created_at, updated_at) VALUES ('00000000-0000-4000-8000-000000000906',$1,$2,$3,$4,'command proposal','constraint','00000000-0000-0000-0000-000000000903','{}','pending',now(),now())`,
      [
        owner.tenantId,
        owner.workspaceId,
        owner.principalType,
        owner.principalId,
      ],
    );
    await expect(
      repository.createSurface(
        surface({
          id: 'command-surface',
          proposalId: '00000000-0000-4000-8000-000000000906',
          mode: 'card',
          status: 'active_card',
          cardMessageId: null,
          docToken: null,
          docRevision: null,
          creatingIngressId: 'ingress-command',
          actionTokenHash: 'd'.repeat(64),
        }),
      ),
    ).resolves.toMatchObject({ id: 'command-surface' });
    await expect(
      repository.resolveSurface({
        id: 'command-surface',
        owner,
        version: 1,
        ingressId: 'ingress-command',
        now: '2026-07-25T00:05:00.000Z',
      }),
    ).resolves.toMatchObject({
      status: 'resolved',
      resolvingIngressId: 'ingress-command',
    });
    await database.query(
      `INSERT INTO workspace_memory_proposals(id, tenant_id, workspace_id, principal_type, principal_id, original_content, original_category, source_session_id, proposer_snapshot, status, created_at, updated_at) VALUES ('00000000-0000-4000-8000-000000000907',$1,$2,$3,$4,'card preview proposal','constraint','00000000-0000-0000-0000-000000000903','{}','pending',now(),now())`,
      [
        owner.tenantId,
        owner.workspaceId,
        owner.principalType,
        owner.principalId,
      ],
    );
    await expect(
      repository.createSurface(
        surface({
          id: 'card-preview-surface',
          proposalId: '00000000-0000-4000-8000-000000000907',
          mode: 'card',
          status: 'processing',
          creatingIngressId: 'ingress-command',
          actionTokenHash: 'e'.repeat(64),
        }),
      ),
    ).resolves.toMatchObject({ id: 'card-preview-surface' });
    await expect(
      repository.savePreview({
        id: 'card-preview-surface',
        owner,
        content: 'not allowed',
        sha256: sha256Preview('not allowed'),
        now: '2026-07-25T00:06:00.000Z',
      }),
    ).rejects.toThrow('card_with_doc');

    await database.query(
      `INSERT INTO workspace_memory_proposals(id, tenant_id, workspace_id, principal_type, principal_id, original_content, original_category, source_session_id, proposer_snapshot, status, created_at, updated_at)
       VALUES ('00000000-0000-0000-0000-000000000909',$1,$2,$3,$4,'atomic proposal','constraint','00000000-0000-0000-0000-000000000903','{}','pending',now(),now())`,
      [
        owner.tenantId,
        owner.workspaceId,
        owner.principalType,
        owner.principalId,
      ],
    );
    const atomicSurface = surface({
      id: 'atomic-surface',
      proposalId: '00000000-0000-0000-0000-000000000909',
      mode: 'card',
      status: 'planned',
      cardMessageId: null,
      docToken: null,
      docRevision: null,
      actionTokenHash: '1'.repeat(64),
      creatingIngressId: 'ingress-1',
    });
    const descriptor = JSON.stringify({
      type: 'lark_memory_review_card_v1',
      surfaceId: atomicSurface.id,
      version: 1,
      proposalId: atomicSurface.proposalId,
      bindingId: 'binding-1',
      owner,
      category: 'constraint',
      content: 'atomic proposal',
      source: 'Proposed by the completed agent task in this thread.',
    });
    const atomicOutbox = {
      id: 'atomic-outbox',
      connectionKey: 'lark-canary',
      bindingId: 'binding-1',
      targetId: 'root-1',
      deliveryKind: 'lark_card_reply',
      aggregateId: atomicSurface.proposalId,
      aggregateVersion: 1,
      payload: descriptor,
      providerRequestId: 'atomic-request',
    } as const;
    const deriveActionTokenHash = () => '1'.repeat(64);
    await expect(
      repository.createCardSurfaceAndOutbox({
        surface: atomicSurface,
        outbox: atomicOutbox,
        deriveActionTokenHash,
      }),
    ).resolves.toMatchObject({ id: 'atomic-surface' });
    for (const change of [
      { version: 0 },
      { version: 1.5 },
      { version: -1 },
      { surfaceId: '' },
      { surfaceId: '🙂'.repeat(129) },
      { category: 'x'.repeat(121) },
      { source: 'x'.repeat(257) },
      { content: 'x'.repeat(1501) },
      { content: 'x\n'.repeat(21) },
    ]) {
      await expect(
        repository.createCardSurfaceAndOutbox({
          surface: atomicSurface,
          outbox: {
            ...atomicOutbox,
            payload: JSON.stringify({ ...JSON.parse(descriptor), ...change }),
          },
          deriveActionTokenHash,
        }),
      ).rejects.toThrow();
    }
    await expect(
      repository.createCardSurfaceAndOutbox({
        surface: atomicSurface,
        outbox: atomicOutbox,
        deriveActionTokenHash,
      }),
    ).resolves.toMatchObject({ id: 'atomic-surface' });
    const candidateSurface = {
      ...atomicSurface,
      id: 'candidate-surface',
      actionTokenHash: '1'.repeat(64),
      createdAt: '2026-07-25T00:10:00.000Z',
      updatedAt: '2026-07-25T00:10:00.000Z',
    };
    const candidateOutbox = {
      ...atomicOutbox,
      id: 'candidate-outbox',
      payload: descriptor.replace('atomic-surface', 'candidate-surface'),
    };
    await expect(
      Promise.all([
        repository.createCardSurfaceAndOutbox({
          surface: atomicSurface,
          outbox: atomicOutbox,
          deriveActionTokenHash,
        }),
        new PostgresLarkReviewSurfaceRepository(
          database,
        ).createCardSurfaceAndOutbox({
          surface: candidateSurface,
          outbox: candidateOutbox,
          deriveActionTokenHash,
        }),
      ]),
    ).resolves.toEqual([
      expect.objectContaining({ id: 'atomic-surface' }),
      expect.objectContaining({ id: 'atomic-surface' }),
    ]);
    await expect(
      repository.createCardSurfaceAndOutbox({
        surface: {
          ...atomicSurface,
          id: 'replay-surface',
          actionTokenHash: '2'.repeat(64),
        },
        outbox: {
          ...atomicOutbox,
          id: 'replay-outbox',
          providerRequestId: 'other-request',
        },
        deriveActionTokenHash,
      }),
    ).rejects.toThrow('logical conflict');
    await database.query(
      `UPDATE channel_outbox SET payload = '{}' WHERE id = 'atomic-outbox'`,
    );
    await expect(
      repository.createCardSurfaceAndOutbox({
        surface: atomicSurface,
        outbox: atomicOutbox,
        deriveActionTokenHash,
      }),
    ).rejects.toThrow('logical conflict');
    await database.query(
      `UPDATE channel_outbox SET payload = $1 WHERE id = 'atomic-outbox'`,
      [descriptor],
    );
    await database.query(
      `UPDATE lark_memory_review_surfaces SET card_message_id = 'premature-card' WHERE id = 'atomic-surface'`,
    );
    await expect(
      repository.createCardSurfaceAndOutbox({
        surface: atomicSurface,
        outbox: atomicOutbox,
        deriveActionTokenHash,
      }),
    ).rejects.toThrow('logical conflict');
    await database.query(
      `UPDATE lark_memory_review_surfaces SET card_message_id = NULL WHERE id = 'atomic-surface'`,
    );
    await database.query(
      `UPDATE channel_outbox SET status = 'delivered' WHERE id = 'atomic-outbox'`,
    );
    await expect(
      repository.createCardSurfaceAndOutbox({
        surface: atomicSurface,
        outbox: atomicOutbox,
        deriveActionTokenHash,
      }),
    ).rejects.toThrow('logical conflict');
    await database.query(
      `UPDATE channel_outbox SET status = 'pending' WHERE id = 'atomic-outbox'`,
    );
    for (const status of [
      'pending',
      'permanent_failed',
      'delivery_unknown',
    ] as const) {
      await database.query(
        `UPDATE channel_outbox SET status = $1, last_safe_error = NULL WHERE id = 'atomic-outbox'`,
        [status],
      );
      await expect(
        repository.createCardSurfaceAndOutbox({
          surface: atomicSurface,
          outbox: atomicOutbox,
          deriveActionTokenHash,
        }),
      ).resolves.toMatchObject({ id: 'atomic-surface' });
    }
    await database.query(
      `UPDATE channel_outbox SET status = 'retry_wait', next_attempt_at = now() WHERE id = 'atomic-outbox'`,
    );
    await expect(
      repository.createCardSurfaceAndOutbox({
        surface: atomicSurface,
        outbox: atomicOutbox,
        deriveActionTokenHash,
      }),
    ).resolves.toMatchObject({ id: 'atomic-surface' });
    await database.query(
      `UPDATE channel_outbox SET status = 'pending', next_attempt_at = NULL WHERE id = 'atomic-outbox'`,
    );
    const sendingClaimed = await new PostgresChannelRepository(
      database,
    ).claimOutbox('test-sending', 30_000);
    expect(sendingClaimed?.id).toBe('atomic-outbox');
    await expect(
      repository.validateCardPublication({
        surfaceId: 'atomic-surface',
        version: 1,
        proposalId: atomicSurface.proposalId,
        bindingId: 'binding-1',
        owner,
        actionTokenHash: '1'.repeat(64),
        category: 'constraint',
        content: 'atomic proposal',
        connectionKey: 'lark-canary',
        targetId: 'root-1',
        aggregateVersion: 1,
        outboxId: 'atomic-outbox',
        attemptNumber: 1,
        leaseOwner: 'test-sending',
      }),
    ).resolves.toMatchObject({ id: 'atomic-surface' });
    await database.query(
      `UPDATE channel_outbox SET attempt_count = 2, lease_owner = 'test-reclaimed', lease_expires_at = now() + interval '1 minute' WHERE id = 'atomic-outbox'`,
    );
    await expect(
      repository.validateCardPublication({
        surfaceId: 'atomic-surface',
        version: 1,
        proposalId: atomicSurface.proposalId,
        bindingId: 'binding-1',
        owner,
        actionTokenHash: '1'.repeat(64),
        category: 'constraint',
        content: 'atomic proposal',
        connectionKey: 'lark-canary',
        targetId: 'root-1',
        aggregateVersion: 1,
        outboxId: 'atomic-outbox',
        attemptNumber: 1,
        leaseOwner: 'test-sending',
      }),
    ).rejects.toThrow();
    await database.query(
      `UPDATE channel_outbox SET attempt_count = 0, lease_owner = NULL, lease_expires_at = NULL, status = 'pending' WHERE id = 'atomic-outbox'`,
    );
    await expect(
      repository.createCardSurfaceAndOutbox({
        surface: atomicSurface,
        outbox: atomicOutbox,
        deriveActionTokenHash,
      }),
    ).resolves.toMatchObject({ id: 'atomic-surface' });
    await database.query(
      `UPDATE channel_outbox SET status = 'pending', attempt_count = 0, lease_owner = NULL, lease_expires_at = NULL WHERE id = 'atomic-outbox'`,
    );
    const atomicRows = await database.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM channel_outbox WHERE aggregate_id = $1`,
      [atomicSurface.proposalId],
    );
    expect(atomicRows.rows[0]?.count).toBe(1);
    const claimed = await new PostgresChannelRepository(database).claimOutbox(
      'test-finalizer',
      30_000,
    );
    expect(claimed?.id).toBe('atomic-outbox');
    await repository.finalizeCardDelivery({
      outboxId: 'atomic-outbox',
      attemptId: 'atomic-attempt',
      attemptNumber: 1,
      providerRequestId: 'atomic-request',
      providerMessageId: 'provider-card-1',
      surfaceId: 'atomic-surface',
      version: 1,
      proposalId: atomicSurface.proposalId,
      bindingId: 'binding-1',
      connectionKey: 'lark-canary',
      targetId: 'root-1',
      leaseOwner: 'test-finalizer',
    });
    await expect(
      repository.finalizeCardDelivery({
        outboxId: 'atomic-outbox',
        attemptId: 'atomic-attempt-replay',
        attemptNumber: 1,
        providerRequestId: 'atomic-request',
        providerMessageId: 'provider-card-1',
        surfaceId: 'atomic-surface',
        version: 1,
        proposalId: atomicSurface.proposalId,
        bindingId: 'binding-1',
        connectionKey: 'lark-canary',
        targetId: 'root-1',
        leaseOwner: 'test-finalizer',
      }),
    ).resolves.toBeUndefined();
    await expect(
      repository.createCardSurfaceAndOutbox({
        surface: atomicSurface,
        outbox: atomicOutbox,
        deriveActionTokenHash,
      }),
    ).resolves.toMatchObject({ id: 'atomic-surface', status: 'active_card' });
    await database.query(
      `UPDATE workspace_memory_proposals SET status = 'accepted', review_outcome = 'accept', reviewer_snapshot = '{}', reviewed_at = now() WHERE id = $1`,
      [atomicSurface.proposalId],
    );
    await expect(
      repository.finalizeCardDelivery({
        outboxId: 'atomic-outbox',
        attemptId: 'proposal-status',
        attemptNumber: 1,
        providerRequestId: 'atomic-request',
        providerMessageId: 'provider-card-1',
        surfaceId: 'atomic-surface',
        version: 1,
        proposalId: atomicSurface.proposalId,
        bindingId: 'binding-1',
        connectionKey: 'lark-canary',
        targetId: 'root-1',
        leaseOwner: 'test-finalizer',
      }),
    ).rejects.toThrow();
    await database.query(
      `UPDATE workspace_memory_proposals SET status = 'pending', review_outcome = NULL, reviewer_snapshot = NULL, reviewed_at = NULL WHERE id = $1`,
      [atomicSurface.proposalId],
    );
    await database.query(
      `UPDATE channel_conversation_bindings SET session_id = NULL WHERE id = 'binding-1'`,
    );
    await expect(
      repository.finalizeCardDelivery({
        outboxId: 'atomic-outbox',
        attemptId: 'source-session',
        attemptNumber: 1,
        providerRequestId: 'atomic-request',
        providerMessageId: 'provider-card-1',
        surfaceId: 'atomic-surface',
        version: 1,
        proposalId: atomicSurface.proposalId,
        bindingId: 'binding-1',
        connectionKey: 'lark-canary',
        targetId: 'root-1',
        leaseOwner: 'test-finalizer',
      }),
    ).rejects.toThrow();
    await database.query(
      `UPDATE channel_conversation_bindings SET session_id = '00000000-0000-0000-0000-000000000903' WHERE id = 'binding-1'`,
    );
    await database.query(
      `UPDATE lark_memory_review_surfaces SET mode = 'card_with_doc', status = 'active_card_with_doc' WHERE id = 'atomic-surface'`,
    );
    await expect(
      repository.finalizeCardDelivery({
        outboxId: 'atomic-outbox',
        attemptId: 'surface-mode',
        attemptNumber: 1,
        providerRequestId: 'atomic-request',
        providerMessageId: 'provider-card-1',
        surfaceId: 'atomic-surface',
        version: 1,
        proposalId: atomicSurface.proposalId,
        bindingId: 'binding-1',
        connectionKey: 'lark-canary',
        targetId: 'root-1',
        leaseOwner: 'test-finalizer',
      }),
    ).rejects.toThrow();
    await database.query(
      `UPDATE lark_memory_review_surfaces SET mode = 'card', status = 'active_card' WHERE id = 'atomic-surface'`,
    );
    await database.query(
      `UPDATE channel_outbox SET delivery_kind = 'memory_review_command' WHERE id = 'atomic-outbox'`,
    );
    await expect(
      repository.finalizeCardDelivery({
        outboxId: 'atomic-outbox',
        attemptId: 'delivery-kind',
        attemptNumber: 1,
        providerRequestId: 'atomic-request',
        providerMessageId: 'provider-card-1',
        surfaceId: 'atomic-surface',
        version: 1,
        proposalId: atomicSurface.proposalId,
        bindingId: 'binding-1',
        connectionKey: 'lark-canary',
        targetId: 'root-1',
        leaseOwner: 'test-finalizer',
      }),
    ).rejects.toThrow();
    await database.query(
      `UPDATE channel_outbox SET delivery_kind = 'lark_card_reply' WHERE id = 'atomic-outbox'`,
    );
    await expect(
      repository.finalizeCardDelivery({
        outboxId: 'atomic-outbox',
        attemptId: 'atomic-attempt-conflict',
        attemptNumber: 1,
        providerRequestId: 'atomic-request',
        providerMessageId: 'different-card',
        surfaceId: 'atomic-surface',
        version: 1,
        proposalId: atomicSurface.proposalId,
        bindingId: 'binding-1',
        connectionKey: 'lark-canary',
        targetId: 'root-1',
        leaseOwner: 'test-finalizer',
      }),
    ).rejects.toThrow();
    await database.query(
      `INSERT INTO workspace_memory_proposals(id, tenant_id, workspace_id, principal_type, principal_id, original_content, original_category, source_session_id, proposer_snapshot, status, created_at, updated_at)
       VALUES ('00000000-0000-0000-0000-000000000910',$1,$2,$3,$4,'rollback proposal','constraint','00000000-0000-0000-0000-000000000903','{}','pending',now(),now())`,
      [
        owner.tenantId,
        owner.workspaceId,
        owner.principalType,
        owner.principalId,
      ],
    );
    await expect(
      repository.createCardSurfaceAndOutbox({
        surface: surface({
          id: 'rollback-surface',
          proposalId: '00000000-0000-0000-0000-000000000910',
          mode: 'card',
          status: 'planned',
          cardMessageId: null,
          docToken: null,
          docRevision: null,
          actionTokenHash: '3'.repeat(64),
          creatingIngressId: 'ingress-1',
        }),
        outbox: {
          ...atomicOutbox,
          id: 'rollback-outbox',
          aggregateId: '00000000-0000-0000-0000-000000000910',
          payload: 'x'.repeat(8193),
        },
        deriveActionTokenHash,
      }),
    ).rejects.toThrow();
    expect(await repository.getSurface('rollback-surface', owner)).toBeNull();

    await database.query(
      `INSERT INTO workspace_memory_proposals(id, tenant_id, workspace_id, principal_type, principal_id, original_content, original_category, source_session_id, proposer_snapshot, status, created_at, updated_at) VALUES ('00000000-0000-4000-8000-000000000908',$1,$2,$3,$4,'race proposal','constraint','00000000-0000-0000-0000-000000000903','{}','pending',now(),now())`,
      [
        owner.tenantId,
        owner.workspaceId,
        owner.principalType,
        owner.principalId,
      ],
    );
    const race = await Promise.allSettled([
      new PostgresLarkReviewSurfaceRepository(database).claimActiveVersion({
        surface: surface({
          id: 'race-a',
          proposalId: '00000000-0000-4000-8000-000000000908',
          creatingIngressId: 'ingress-command',
          actionTokenHash: 'f'.repeat(64),
        }),
        expectedActiveVersion: null,
      }),
      new PostgresLarkReviewSurfaceRepository(database).claimActiveVersion({
        surface: surface({
          id: 'race-b',
          proposalId: '00000000-0000-4000-8000-000000000908',
          creatingIngressId: 'ingress-command',
          actionTokenHash: '0'.repeat(64),
        }),
        expectedActiveVersion: null,
      }),
    ]);
    expect(race.filter((result) => result.status === 'fulfilled')).toHaveLength(
      1,
    );
    expect(race.filter((result) => result.status === 'rejected')).toHaveLength(
      1,
    );
    const activeRace = await database.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM lark_memory_review_surfaces WHERE proposal_id = '00000000-0000-4000-8000-000000000908' AND status IN ('active_card', 'active_card_with_doc', 'command_only', 'processing')`,
    );
    expect(activeRace.rows[0]?.count).toBe(1);
    await database.close();
  });
});
