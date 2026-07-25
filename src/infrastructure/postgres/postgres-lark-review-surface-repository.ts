import { createHash } from 'node:crypto';
import { memoryReviewDecisionFingerprint } from '../../domain/workspace-memory/memory-review-fingerprint.js';
import type {
  LarkReviewSurfaceRepository,
  ReviewSurfaceOwnerScope,
} from '../../application/ports/lark-review-surface-repository.js';
import {
  transitionReviewSurface,
  type LarkMemoryReviewSurface,
} from '../../domain/channels/lark-memory-review-surface.js';
import type { ChannelOutboxInput } from '../../domain/channels/channel-delivery.js';
import {
  parseMemoryReviewCardPublicationDescriptor,
  parseMemoryReviewDocCardPublicationDescriptor,
  type MemoryReviewCardPublicationDescriptor,
  type MemoryReviewDocCardPublicationDescriptor,
} from '../../domain/channels/lark-memory-review-card-publication.js';

interface Queryable {
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{
    readonly rows?: readonly Row[];
    readonly rowCount?: number | null;
  }>;
}

interface Transactional extends Queryable {
  release?: () => void;
}

interface Connectable {
  connect(): Promise<Transactional>;
}

const pgliteTransactionTails = new WeakMap<object, Promise<void>>();

interface SurfaceRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly workspace_id: string;
  readonly principal_type: string;
  readonly principal_id: string;
  readonly proposal_id: string;
  readonly binding_id: string;
  readonly version: number;
  readonly mode: LarkMemoryReviewSurface['mode'];
  readonly status: LarkMemoryReviewSurface['status'];
  readonly card_message_id: string | null;
  readonly doc_token: string | null;
  readonly doc_revision: string | null;
  readonly preview_content: string | null;
  readonly preview_sha256: string | null;
  readonly action_token_hash: string | null;
  readonly creating_ingress_id: string;
  readonly resolving_ingress_id: string | null;
  readonly created_at: string | Date;
  readonly updated_at: string | Date;
}

export class PostgresLarkReviewSurfaceRepository implements LarkReviewSurfaceRepository {
  public constructor(private readonly database: Queryable) {}

  public async authorizeCardAction(
    input: Parameters<LarkReviewSurfaceRepository['authorizeCardAction']>[0],
  ) {
    return this.withTransaction(async (database) => {
      if (
        ![
          'accept',
          'reject',
          'edit_in_doc',
          'preview_doc',
          'accept_preview',
        ].includes(input.action)
      )
        throw new Error('card_action_not_authorized');
      // Deliberately lock in proposal -> binding -> surface -> ingress order.
      const proposal = await database.query<any>(
        `SELECT * FROM workspace_memory_proposals WHERE tenant_id=$1 AND workspace_id=$2 AND principal_type=$3 AND principal_id=$4 AND EXISTS (SELECT 1 FROM lark_memory_review_surfaces s WHERE s.proposal_id=workspace_memory_proposals.id AND s.action_token_hash=$5) FOR UPDATE`,
        [
          input.owner.tenantId,
          input.owner.workspaceId,
          input.owner.principalType,
          input.owner.principalId,
          input.actionTokenHash,
        ],
      );
      const proposalRow = proposal.rows?.[0];
      if (!proposalRow) throw new Error('card_action_not_authorized');
      const binding = await database.query<any>(
        `SELECT * FROM channel_conversation_bindings WHERE id=(SELECT binding_id FROM lark_memory_review_surfaces WHERE proposal_id=$1 AND action_token_hash=$2 LIMIT 1) FOR UPDATE`,
        [proposalRow.id, input.actionTokenHash],
      );
      const surface = await database.query<SurfaceRow>(
        `${SELECT_SQL} WHERE action_token_hash=$1 AND tenant_id=$2 AND workspace_id=$3 AND principal_type=$4 AND principal_id=$5 AND ($6::integer IS NULL OR version=$6) FOR UPDATE`,
        [
          input.actionTokenHash,
          input.owner.tenantId,
          input.owner.workspaceId,
          input.owner.principalType,
          input.owner.principalId,
          input.version ?? null,
        ],
      );
      let current = surface.rows?.[0];
      const callback = await database.query<any>(
        `SELECT * FROM channel_ingress_events WHERE id=$1 AND lease_expires_at > now() FOR UPDATE`,
        [input.ingressId],
      );
      let creating = await database.query<any>(
        `SELECT * FROM channel_ingress_events WHERE id=$1 FOR SHARE`,
        [current?.creating_ingress_id],
      );
      let successorReplay = false;
      if (
        current &&
        input.action === 'preview_doc' &&
        current.status === 'stale'
      ) {
        const successor = await database.query<SurfaceRow>(
          `${SELECT_SQL} WHERE proposal_id=$1 AND binding_id=$2 AND creating_ingress_id=$3 AND version=$4 AND status='processing' FOR UPDATE`,
          [
            current.proposal_id,
            current.binding_id,
            input.ingressId,
            current.version + 1,
          ],
        );
        if (successor.rows?.[0]) {
          current = successor.rows[0];
          successorReplay = true;
          creating = await database.query<any>(
            `SELECT * FROM channel_ingress_events WHERE id=$1 FOR SHARE`,
            [current.creating_ingress_id],
          );
        }
      }
      const p = proposalRow;
      const b = binding.rows?.[0];
      const c = callback.rows?.[0];
      const cr = creating.rows?.[0];
      const predecessor = current
        ? await database.query<{ action_token_hash: string | null }>(
            `SELECT action_token_hash FROM lark_memory_review_surfaces
             WHERE proposal_id=$1 AND binding_id=$2 AND version=$3`,
            [current.proposal_id, current.binding_id, current.version - 1],
          )
        : null;
      const expectedCreatingDigest = successorReplay
        ? input.actionDigest
        : predecessor?.rows?.[0]?.action_token_hash;
      const successorAccept =
        input.action === 'accept_preview' &&
        current?.version !== undefined &&
        current.version > 1;
      const expectedFingerprint = [
        'edit_in_doc',
        'preview_doc',
        'accept_preview',
      ].includes(input.action)
        ? null
        : memoryReviewDecisionFingerprint({
            action: input.action as 'accept' | 'reject',
            content: null,
          });
      const resumable =
        (p.status === 'accepted' || p.status === 'rejected') &&
        p.review_controller_ingress_id === input.ingressId &&
        (p.review_decision_sha256 === expectedFingerprint ||
          (input.action === 'accept' &&
            p.status === 'accepted' &&
            p.reviewed_content !== null)) &&
        ((p.status === 'accepted' && input.action === 'accept') ||
          (p.status === 'rejected' && input.action === 'reject'));
      const replayOutcome =
        resumable &&
        (current?.status === 'resolved'
          ? current.resolving_ingress_id === input.ingressId
          : current?.status === 'active_card' ||
            current?.status === 'active_card_with_doc')
          ? p.status
          : undefined;
      const actionMatches =
        c?.action &&
        Object.keys(c.action).length === 2 &&
        c.action.action === input.action &&
        c.action.digest === input.actionTokenHash;
      const successorAcceptValid =
        successorAccept &&
        current &&
        b &&
        c &&
        cr &&
        actionMatches &&
        p.status === 'pending' &&
        current.mode === 'card_with_doc' &&
        current.status === 'processing' &&
        current.card_message_id === input.cardMessageId &&
        current.proposal_id === p.id &&
        current.binding_id === b.id &&
        b.connection_key === input.connectionKey &&
        b.chat_id === input.chatId &&
        b.session_id === p.source_session_id &&
        p.tenant_id === input.owner.tenantId &&
        p.workspace_id === input.owner.workspaceId &&
        p.principal_type === input.owner.principalType &&
        p.principal_id === input.owner.principalId &&
        c.lease_owner === input.leaseOwner &&
        c.attempt_count === input.attemptNumber &&
        c.action.digest === input.actionDigest &&
        c.kind === 'card_action' &&
        c.connection_key === input.connectionKey &&
        c.chat_id === input.chatId &&
        c.external_message_id === input.cardMessageId &&
        c.external_actor_id === input.actorId &&
        c.status === 'processing' &&
        !!c.lease_owner;
      if (
        !successorAcceptValid &&
        (!current ||
          !b ||
          !c ||
          !cr ||
          !actionMatches ||
          p.source_session_id === null ||
          c.lease_owner !== input.leaseOwner ||
          c.attempt_count !== input.attemptNumber ||
          c.action.digest !== input.actionDigest ||
          (p.status !== 'pending' && !replayOutcome) ||
          !['card', 'card_with_doc'].includes(current.mode) ||
          ((input.action === 'preview_doc' ||
            input.action === 'accept_preview') &&
            (current.mode !== 'card_with_doc' || current.doc_token === null)) ||
          (!replayOutcome &&
            !['active_card', 'active_card_with_doc', 'processing'].includes(
              current.status,
            )) ||
          current.card_message_id !== input.cardMessageId ||
          (input.action !== 'accept_preview' &&
            !successorReplay &&
            current.action_token_hash !== input.actionTokenHash) ||
          current.proposal_id !== p.id ||
          current.binding_id !== b.id ||
          b.connection_key !== input.connectionKey ||
          b.chat_id !== input.chatId ||
          b.session_id !== p.source_session_id ||
          p.tenant_id !== input.owner.tenantId ||
          p.workspace_id !== input.owner.workspaceId ||
          p.principal_type !== input.owner.principalType ||
          p.principal_id !== input.owner.principalId ||
          (cr.kind === 'card_action'
            ? input.action === 'accept_preview' ||
              cr.connection_key !== input.connectionKey ||
              cr.chat_id !== input.chatId ||
              cr.external_message_id !== input.cardMessageId ||
              cr.external_actor_id !== input.actorId ||
              cr.action?.action !== 'preview_doc' ||
              ((input.action === 'preview_doc' || successorReplay) &&
                cr.action?.digest !== expectedCreatingDigest) ||
              cr.status !== (successorReplay ? 'processing' : 'processed') ||
              (successorReplay && cr.lease_owner !== input.leaseOwner) ||
              (successorReplay && cr.attempt_count !== input.attemptNumber)
            : cr.connection_key !== b.connection_key ||
              cr.chat_id !== b.chat_id ||
              (cr.root_message_id ?? cr.external_message_id) !==
                b.root_message_id) ||
          c.kind !== 'card_action' ||
          c.connection_key !== input.connectionKey ||
          c.chat_id !== input.chatId ||
          c.external_message_id !== input.cardMessageId ||
          c.external_actor_id !== input.actorId ||
          c.status !== 'processing' ||
          !c.lease_owner)
      ) {
        throw new Error('card_action_not_authorized');
      }
      return {
        surface: mapRow(current!),
        proposal: {
          id: p.id,
          originalCategory: p.original_category,
          originalContent: p.original_content,
          status: p.status,
          sourceSessionId: p.source_session_id,
          sourceRunId: p.source_run_id,
          reviewedContent: p.reviewed_content,
          reviewControllerIngressId: p.review_controller_ingress_id,
          tenantId: p.tenant_id,
          workspaceId: p.workspace_id,
          principalType: p.principal_type,
          principalId: p.principal_id,
        },
        ...(replayOutcome ? { replayOutcome } : {}),
      };
    });
  }

  public async resolveSurfaceAndCreateTerminalOutboxes(
    input: Parameters<
      LarkReviewSurfaceRepository['resolveSurfaceAndCreateTerminalOutboxes']
    >[0],
  ): Promise<void> {
    return this.withTransaction(async (database) => {
      const proposal = await database.query<any>(
        `SELECT * FROM workspace_memory_proposals WHERE id=$1 AND tenant_id=$2 AND workspace_id=$3 AND principal_type=$4 AND principal_id=$5 FOR UPDATE`,
        [
          input.surface.proposalId,
          input.owner.tenantId,
          input.owner.workspaceId,
          input.owner.principalType,
          input.owner.principalId,
        ],
      );
      const binding = await database.query<any>(
        `SELECT * FROM channel_conversation_bindings WHERE id=$1 FOR UPDATE`,
        [input.surface.bindingId],
      );
      const surface = await database.query<SurfaceRow>(
        `${SELECT_SQL} WHERE id=$1 AND version=$2 AND proposal_id=$3 AND binding_id=$4 AND tenant_id=$5 AND workspace_id=$6 AND principal_type=$7 AND principal_id=$8 AND action_token_hash=$9 FOR UPDATE`,
        [
          input.surface.id,
          input.surface.version,
          input.surface.proposalId,
          input.surface.bindingId,
          input.owner.tenantId,
          input.owner.workspaceId,
          input.owner.principalType,
          input.owner.principalId,
          input.actionDigest,
        ],
      );
      const ingress = await database.query<any>(
        `SELECT * FROM channel_ingress_events WHERE id=$1 AND lease_expires_at > now() FOR UPDATE`,
        [input.ingressId],
      );
      const creating = await database.query<any>(
        `SELECT * FROM channel_ingress_events WHERE id=$1 FOR SHARE`,
        [surface.rows?.[0]?.creating_ingress_id],
      );
      const p = proposal.rows?.[0];
      const b = binding.rows?.[0];
      const s = surface.rows?.[0];
      const i = ingress.rows?.[0];
      const cr = creating.rows?.[0];
      const expectedAction = input.outcome === 'accepted' ? 'accept' : 'reject';
      const isEditedAccept = p?.review_outcome === 'edit_and_accept';
      const expectedFingerprint = memoryReviewDecisionFingerprint({
        action: isEditedAccept ? 'edit_and_accept' : expectedAction,
        content: isEditedAccept ? input.content : null,
      });
      if (
        !p ||
        !b ||
        !s ||
        !i ||
        !cr ||
        (p.status !== 'accepted' && p.status !== 'rejected') ||
        p.review_controller_ingress_id !== input.ingressId ||
        p.review_decision_sha256 !== expectedFingerprint ||
        (isEditedAccept
          ? p.review_outcome !== 'edit_and_accept'
          : p.review_outcome !== expectedAction) ||
        p.source_session_id === null ||
        b.session_id !== p.source_session_id ||
        i.kind !== 'card_action' ||
        Object.keys(i.action ?? {}).length !== 2 ||
        !(
          (expectedAction === 'accept' &&
            (i.action?.action === 'accept' ||
              i.action?.action === 'accept_preview')) ||
          i.action?.action === expectedAction
        ) ||
        i.action?.digest !== input.actionDigest ||
        i.connection_key !== input.connectionKey ||
        i.chat_id !== input.chatId ||
        i.external_actor_id !== input.actorId ||
        i.connection_key !== b.connection_key ||
        i.chat_id !== b.chat_id ||
        i.external_message_id !== s.card_message_id ||
        i.status !== 'processing' ||
        i.lease_owner !== input.leaseOwner ||
        i.attempt_count !== input.attemptNumber ||
        cr.connection_key !== b.connection_key ||
        cr.chat_id !== b.chat_id ||
        (cr.kind === 'card_action'
          ? cr.external_message_id !== s.card_message_id
          : (cr.root_message_id ?? cr.external_message_id) !==
            b.root_message_id) ||
        s.status === 'stale' ||
        (s.status === 'resolved' && s.resolving_ingress_id !== input.ingressId)
      )
        throw new Error('review_surface_resolution_conflict');
      if (
        s.status !== 'resolved' &&
        (!['active_card', 'active_card_with_doc', 'processing'].includes(
          s.status,
        ) ||
          s.card_message_id === null)
      )
        throw new Error('review_surface_resolution_conflict');
      const cardMessageId = s.card_message_id;
      if (!cardMessageId) throw new Error('review_surface_resolution_conflict');
      if (
        ['active_card', 'active_card_with_doc', 'processing'].includes(s.status)
      )
        await database.query(
          `UPDATE lark_memory_review_surfaces SET status='resolved', resolving_ingress_id=$1, updated_at=now() WHERE id=$2 AND version=$3 AND status IN ('active_card','active_card_with_doc','processing')`,
          [input.ingressId, s.id, s.version],
        );
      const key = `${s.id}|${s.version}|${p.id}|${input.outcome}`;
      const digest = createHash('sha256')
        .update(key)
        .digest('hex')
        .slice(0, 32);
      const terminalCard = JSON.stringify({ card: input.card });
      await insertOrCompareTerminalOutbox(database, {
        id: `lark-card-patch-${digest}`,
        connectionKey: b.connection_key,
        bindingId: b.id,
        targetId: cardMessageId,
        deliveryKind: 'lark_card_patch',
        aggregateId: p.id,
        aggregateVersion: s.version + 1,
        payload: terminalCard,
        providerRequestId: `lark-card-patch-${digest}`,
      });
      await insertOrCompareTerminalOutbox(database, {
        id: `lark-thread-result-${digest}`,
        connectionKey: b.connection_key,
        bindingId: b.id,
        targetId: cardMessageId,
        deliveryKind: 'lark_thread_result',
        aggregateId: p.id,
        aggregateVersion: s.version,
        payload: input.threadText,
        providerRequestId: `lark-thread-result-${digest}`,
      });
    });
  }

  public async createSurface(
    surface: LarkMemoryReviewSurface,
  ): Promise<LarkMemoryReviewSurface> {
    return this.withTransaction((transaction) =>
      this.insertSurface(transaction, surface),
    );
  }

  public async createCardSurfaceAndOutbox(input: {
    readonly surface: LarkMemoryReviewSurface;
    readonly outbox: ChannelOutboxInput;
    readonly deriveActionTokenHash: (
      surfaceId: string,
      version: number,
    ) => string;
  }): Promise<LarkMemoryReviewSurface> {
    return this.withTransaction(async (database) => {
      await assertSurfaceContext(database, input.surface, true);
      const existing = await database.query<SurfaceRow>(
        `${SELECT_SQL} WHERE tenant_id = $1 AND workspace_id = $2 AND principal_type = $3 AND principal_id = $4
          AND proposal_id = $5 AND binding_id = $6 AND creating_ingress_id = $7 FOR UPDATE`,
        [
          input.surface.tenantId,
          input.surface.workspaceId,
          input.surface.principalType,
          input.surface.principalId,
          input.surface.proposalId,
          input.surface.bindingId,
          input.surface.creatingIngressId,
        ],
      );
      const existingOutbox = await database.query<Record<string, unknown>>(
        `SELECT * FROM channel_outbox WHERE connection_key = $1 AND delivery_kind = $2 AND aggregate_id = $3 AND aggregate_version = $4 FOR UPDATE`,
        [
          input.outbox.connectionKey,
          input.outbox.deliveryKind,
          input.outbox.aggregateId,
          input.outbox.aggregateVersion,
        ],
      );
      const candidateDescriptor = parsePublicationDescriptor(
        JSON.parse(input.outbox.payload),
      );
      const candidateProposal = await database.query<{
        original_category: string;
        original_content: string;
      }>(
        `SELECT original_category, original_content FROM workspace_memory_proposals WHERE id = $1`,
        [input.surface.proposalId],
      );
      if (
        !candidatePublicationMatches(
          candidateDescriptor,
          input.surface,
          input.outbox,
          input.deriveActionTokenHash,
          candidateProposal.rows?.[0],
        )
      )
        throw new Error('Card publication logical conflict');
      if (existing.rows?.[0] || existingOutbox.rows?.[0]) {
        if (!existing.rows?.[0] || !existingOutbox.rows?.[0])
          throw new Error('Card publication logical conflict');
        const canonical = mapRow(existing.rows[0]);
        await assertSurfaceContext(database, canonical, true);
        const canonicalAttempt = await database.query<{
          provider_request_id: string | null;
          provider_message_id: string | null;
          result: string;
        }>(
          `SELECT provider_request_id, provider_message_id, result FROM channel_delivery_attempts WHERE outbox_id = $1 ORDER BY attempt_number DESC LIMIT 1`,
          [existingOutbox.rows[0].id],
        );
        if (
          !canonicalPublicationMatches(
            canonical,
            existingOutbox.rows[0],
            input.outbox,
            input.deriveActionTokenHash,
            candidateProposal.rows?.[0],
            canonicalAttempt.rows?.[0],
          )
        )
          throw new Error('Card publication logical conflict');
        return canonical;
      }
      const surface = await this.insertSurface(database, input.surface);
      const insertedOutbox = await database.query(
        `INSERT INTO channel_outbox
          (id, connection_key, binding_id, target_id, delivery_kind, aggregate_id, aggregate_version, payload, provider_request_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (connection_key, delivery_kind, aggregate_id, aggregate_version) DO NOTHING RETURNING id`,
        [
          input.outbox.id,
          input.outbox.connectionKey,
          input.outbox.bindingId,
          input.outbox.targetId,
          input.outbox.deliveryKind,
          input.outbox.aggregateId,
          input.outbox.aggregateVersion,
          input.outbox.payload,
          input.outbox.providerRequestId,
        ],
      );
      if (!insertedOutbox.rows?.[0])
        throw new Error('Card publication logical conflict');
      return surface;
    });
  }

  private async insertSurface(
    database: Queryable,
    surface: LarkMemoryReviewSurface,
  ): Promise<LarkMemoryReviewSurface> {
    await assertSurfaceContext(database, surface, true);
    const result = await database.query<SurfaceRow>(
      `${INSERT_SQL}
       ON CONFLICT (tenant_id, workspace_id, proposal_id, binding_id, creating_ingress_id)
       DO UPDATE SET id = lark_memory_review_surfaces.id
       WHERE lark_memory_review_surfaces.id = EXCLUDED.id
         AND lark_memory_review_surfaces.principal_type = EXCLUDED.principal_type
         AND lark_memory_review_surfaces.principal_id = EXCLUDED.principal_id
         AND lark_memory_review_surfaces.version = EXCLUDED.version
         AND lark_memory_review_surfaces.mode = EXCLUDED.mode
         AND lark_memory_review_surfaces.status = EXCLUDED.status
         AND lark_memory_review_surfaces.card_message_id IS NOT DISTINCT FROM EXCLUDED.card_message_id
         AND lark_memory_review_surfaces.doc_token IS NOT DISTINCT FROM EXCLUDED.doc_token
         AND lark_memory_review_surfaces.doc_revision IS NOT DISTINCT FROM EXCLUDED.doc_revision
         AND lark_memory_review_surfaces.preview_content IS NOT DISTINCT FROM EXCLUDED.preview_content
         AND lark_memory_review_surfaces.preview_sha256 IS NOT DISTINCT FROM EXCLUDED.preview_sha256
         AND lark_memory_review_surfaces.action_token_hash IS NOT DISTINCT FROM EXCLUDED.action_token_hash
         AND lark_memory_review_surfaces.resolving_ingress_id IS NOT DISTINCT FROM EXCLUDED.resolving_ingress_id
         AND lark_memory_review_surfaces.created_at = EXCLUDED.created_at
         AND lark_memory_review_surfaces.updated_at = EXCLUDED.updated_at
       RETURNING *`,
      values(surface),
    );
    if (!result.rows?.[0]) throw new Error('review surface logical conflict');
    return mapRow(result.rows[0]);
  }

  private async withTransaction<T>(
    work: (database: Queryable) => Promise<T>,
  ): Promise<T> {
    const database = this.database as Queryable & Partial<Connectable>;
    if (!database.connect) {
      return serializePgliteTransaction(database, work);
    }
    const client = await database.connect();
    await client.query('BEGIN');
    try {
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      (client as Transactional).release?.();
    }
  }

  public async getSurface(
    id: string,
    owner: ReviewSurfaceOwnerScope,
  ): Promise<LarkMemoryReviewSurface | null> {
    const result = await this.database.query<SurfaceRow>(
      `${SELECT_SQL} WHERE id = $1 AND tenant_id = $2 AND workspace_id = $3 AND principal_type = $4 AND principal_id = $5`,
      [
        id,
        owner.tenantId,
        owner.workspaceId,
        owner.principalType,
        owner.principalId,
      ],
    );
    return result.rows?.[0] ? mapRow(result.rows[0]) : null;
  }

  public async getSurfaceByActionTokenHash(input: {
    actionTokenHash: string;
    owner: ReviewSurfaceOwnerScope;
  }): Promise<LarkMemoryReviewSurface | null> {
    const result = await this.database.query<SurfaceRow>(
      `${SELECT_SQL} WHERE action_token_hash = $1 AND tenant_id = $2 AND workspace_id = $3 AND principal_type = $4 AND principal_id = $5`,
      [
        input.actionTokenHash,
        input.owner.tenantId,
        input.owner.workspaceId,
        input.owner.principalType,
        input.owner.principalId,
      ],
    );
    return result.rows?.[0] ? mapRow(result.rows[0]) : null;
  }

  public async getActiveSurface(
    input: ReviewSurfaceOwnerScope & {
      readonly proposalId: string;
      readonly bindingId: string;
    },
  ): Promise<LarkMemoryReviewSurface | null> {
    const result = await this.database.query<SurfaceRow>(
      `${SELECT_SQL} WHERE tenant_id = $1 AND workspace_id = $2 AND principal_type = $3 AND principal_id = $4
        AND proposal_id = $5 AND binding_id = $6
        AND status IN ('planned', 'publishing', 'active_card', 'active_card_with_doc', 'command_only', 'processing')
        ORDER BY version DESC LIMIT 1`,
      [
        input.tenantId,
        input.workspaceId,
        input.principalType,
        input.principalId,
        input.proposalId,
        input.bindingId,
      ],
    );
    return result.rows?.[0] ? mapRow(result.rows[0]) : null;
  }

  public async claimActiveVersion(input: {
    surface: LarkMemoryReviewSurface;
    expectedActiveVersion: number | null;
  }): Promise<LarkMemoryReviewSurface> {
    const { surface, expectedActiveVersion } = input;
    return this.withTransaction(async (database) => {
      await assertSurfaceContext(database, surface, true);
      if (expectedActiveVersion !== null) {
        const previous = await database.query(
          `UPDATE lark_memory_review_surfaces
         SET status = 'stale', updated_at = $1
         WHERE tenant_id = $2 AND workspace_id = $3 AND proposal_id = $4 AND binding_id = $5
           AND version = $6 AND status IN ('planned', 'publishing', 'active_card', 'active_card_with_doc', 'command_only', 'processing')
         RETURNING id`,
          [
            surface.updatedAt,
            surface.tenantId,
            surface.workspaceId,
            surface.proposalId,
            surface.bindingId,
            expectedActiveVersion,
          ],
        );
        if ((previous.rows?.length ?? 0) !== 1)
          throw new Error('stale review surface version');
      }
      return this.insertSurface(database, surface);
    });
  }

  public async activateCardMessage(input: {
    readonly surfaceId: string;
    readonly version: number;
    readonly proposalId: string;
    readonly bindingId: string;
    readonly providerMessageId: string;
  }): Promise<LarkMemoryReviewSurface> {
    if (input.providerMessageId.trim().length === 0)
      throw new Error('provider Card message id is required');
    return this.withTransaction(async (database) => {
      // Keep the proposal -> binding -> surface lock order used by surface creation.
      const proposal = await database.query<{
        tenant_id: string;
        workspace_id: string;
        principal_type: string;
        principal_id: string;
        status: string;
        source_session_id: string | null;
      }>(
        `SELECT tenant_id, workspace_id, principal_type, principal_id, status, source_session_id
           FROM workspace_memory_proposals WHERE id = $1 FOR UPDATE`,
        [input.proposalId],
      );
      const proposalRow = proposal.rows?.[0];
      if (!proposalRow || proposalRow.status !== 'pending')
        throw new Error('review surface proposal is not pending');
      const binding = await database.query<{ session_id: string | null }>(
        `SELECT session_id FROM channel_conversation_bindings WHERE id = $1 FOR UPDATE`,
        [input.bindingId],
      );
      if (
        !binding.rows?.[0] ||
        binding.rows[0].session_id !== proposalRow.source_session_id
      )
        throw new Error('review surface context validation failed');
      const surface = await database.query<SurfaceRow>(
        `SELECT * FROM lark_memory_review_surfaces
          WHERE id = $1 AND version = $2 AND proposal_id = $3 AND binding_id = $4
            AND tenant_id = $5 AND workspace_id = $6 AND principal_type = $7 AND principal_id = $8
          FOR UPDATE`,
        [
          input.surfaceId,
          input.version,
          input.proposalId,
          input.bindingId,
          proposalRow.tenant_id,
          proposalRow.workspace_id,
          proposalRow.principal_type,
          proposalRow.principal_id,
        ],
      );
      const current = surface.rows?.[0];
      if (!current) throw new Error('review surface not found');
      if (!['card', 'card_with_doc'].includes(current.mode))
        throw new Error('review surface is not a review Card');
      if (
        current.status === 'active_card' &&
        current.card_message_id === input.providerMessageId
      )
        return mapRow(current);
      if (!['planned', 'publishing'].includes(current.status))
        throw new Error('review surface activation conflict');
      const result = await database.query<SurfaceRow>(
        `UPDATE lark_memory_review_surfaces
            SET status = CASE WHEN mode = 'card_with_doc' THEN 'active_card_with_doc' ELSE 'active_card' END, card_message_id = $1, updated_at = now()
          WHERE id = $2 AND version = $3 AND status IN ('planned', 'publishing') AND mode IN ('card', 'card_with_doc')
          RETURNING *`,
        [input.providerMessageId, current.id, current.version],
      );
      if (!result.rows?.[0])
        throw new Error('review surface activation CAS failed');
      return mapRow(result.rows[0]);
    });
  }

  public async validateCardPublication(input: {
    readonly surfaceId: string;
    readonly version: number;
    readonly proposalId: string;
    readonly bindingId: string;
    readonly owner: ReviewSurfaceOwnerScope;
    readonly actionTokenHash: string;
    readonly category: string;
    readonly content: string;
    readonly connectionKey: string;
    readonly targetId: string;
    readonly aggregateVersion: number;
    readonly outboxId: string;
    readonly attemptNumber: number;
    readonly leaseOwner: string;
  }): Promise<LarkMemoryReviewSurface> {
    return this.withTransaction(async (database) => {
      const proposal = await database.query<{
        status: string;
        source_session_id: string | null;
        original_category: string;
        original_content: string;
      }>(
        `SELECT status, source_session_id, original_category, original_content
           FROM workspace_memory_proposals
          WHERE id = $1 AND tenant_id = $2 AND workspace_id = $3 AND principal_type = $4 AND principal_id = $5 FOR UPDATE`,
        [
          input.proposalId,
          input.owner.tenantId,
          input.owner.workspaceId,
          input.owner.principalType,
          input.owner.principalId,
        ],
      );
      const proposalRow = proposal.rows?.[0];
      const binding = await database.query<{
        session_id: string | null;
        connection_key: string;
        root_message_id: string;
      }>(
        `SELECT session_id, connection_key, root_message_id FROM channel_conversation_bindings WHERE id = $1 FOR UPDATE`,
        [input.bindingId],
      );
      if (
        input.aggregateVersion !== input.version ||
        !proposalRow ||
        proposalRow.status !== 'pending' ||
        !binding.rows?.[0] ||
        binding.rows[0].session_id !== proposalRow.source_session_id ||
        binding.rows[0].connection_key !== input.connectionKey ||
        binding.rows[0].root_message_id !== input.targetId ||
        proposalRow.original_category !== input.category ||
        proposalRow.original_content !== input.content
      ) {
        throw new Error('invalid memory review Card descriptor');
      }
      const surface = await database.query<SurfaceRow>(
        `SELECT * FROM lark_memory_review_surfaces
          WHERE id = $1 AND version = $2 AND proposal_id = $3 AND binding_id = $4
            AND tenant_id = $5 AND workspace_id = $6 AND principal_type = $7 AND principal_id = $8 FOR UPDATE`,
        [
          input.surfaceId,
          input.version,
          input.proposalId,
          input.bindingId,
          input.owner.tenantId,
          input.owner.workspaceId,
          input.owner.principalType,
          input.owner.principalId,
        ],
      );
      const current = surface.rows?.[0];
      const outbox = await database.query<{
        status: string;
        attempt_count: number;
        lease_owner: string | null;
        connection_key: string;
        target_id: string;
        binding_id: string | null;
        delivery_kind: string;
        aggregate_id: string;
        aggregate_version: number;
      }>(
        `SELECT status, attempt_count, lease_owner, connection_key, target_id, binding_id, delivery_kind, aggregate_id, aggregate_version FROM channel_outbox WHERE id = $1 FOR UPDATE`,
        [input.outboxId],
      );
      const outboxRow = outbox.rows?.[0];
      if (
        !current ||
        !['card', 'card_with_doc'].includes(current.mode) ||
        !['planned', 'publishing'].includes(current.status) ||
        current.action_token_hash !== input.actionTokenHash ||
        !outboxRow ||
        outboxRow.status !== 'sending' ||
        outboxRow.attempt_count !== input.attemptNumber ||
        outboxRow.lease_owner !== input.leaseOwner ||
        outboxRow.connection_key !== input.connectionKey ||
        outboxRow.target_id !== input.targetId ||
        outboxRow.binding_id !== input.bindingId ||
        outboxRow.delivery_kind !== 'lark_card_reply' ||
        outboxRow.aggregate_id !== input.proposalId ||
        outboxRow.aggregate_version !== input.version
      ) {
        throw new Error('invalid memory review Card descriptor');
      }
      return mapRow(current);
    });
  }

  public async finalizeCardDelivery(input: {
    readonly outboxId: string;
    readonly attemptId: string;
    readonly attemptNumber: number;
    readonly providerRequestId: string;
    readonly providerMessageId: string;
    readonly surfaceId: string;
    readonly version: number;
    readonly proposalId: string;
    readonly bindingId: string;
    readonly connectionKey: string;
    readonly targetId: string;
    readonly leaseOwner: string;
  }): Promise<void> {
    if (!input.providerMessageId.trim())
      throw new Error('provider Card message id is required');
    if (!input.leaseOwner.trim())
      throw new Error('Card delivery lease is required');
    await this.withTransaction(async (database) => {
      const proposal = await database.query<{
        tenant_id: string;
        workspace_id: string;
        principal_type: string;
        principal_id: string;
        status: string;
        source_session_id: string | null;
      }>(
        `SELECT tenant_id, workspace_id, principal_type, principal_id, status, source_session_id FROM workspace_memory_proposals WHERE id = $1 FOR UPDATE`,
        [input.proposalId],
      );
      const proposalRow = proposal.rows?.[0];
      const binding = await database.query<{
        session_id: string | null;
        connection_key: string;
        root_message_id: string;
      }>(
        `SELECT session_id, connection_key, root_message_id FROM channel_conversation_bindings WHERE id = $1 FOR UPDATE`,
        [input.bindingId],
      );
      const bindingRow = binding.rows?.[0];
      const surface = await database.query<SurfaceRow>(
        `SELECT * FROM lark_memory_review_surfaces WHERE id = $1 AND version = $2 AND proposal_id = $3 AND binding_id = $4
          AND tenant_id = $5 AND workspace_id = $6 AND principal_type = $7 AND principal_id = $8 FOR UPDATE`,
        [
          input.surfaceId,
          input.version,
          input.proposalId,
          input.bindingId,
          proposalRow?.tenant_id,
          proposalRow?.workspace_id,
          proposalRow?.principal_type,
          proposalRow?.principal_id,
        ],
      );
      const current = surface.rows?.[0];
      const outbox = await database.query<{
        status: string;
        attempt_count: number;
        lease_owner: string | null;
        connection_key: string;
        binding_id: string | null;
        target_id: string;
        delivery_kind: string;
        aggregate_id: string;
        aggregate_version: number;
        provider_request_id: string;
      }>(
        `SELECT status, attempt_count, lease_owner, connection_key, binding_id, target_id, delivery_kind, aggregate_id, aggregate_version, provider_request_id FROM channel_outbox WHERE id = $1 FOR UPDATE`,
        [input.outboxId],
      );
      const outboxRow = outbox.rows?.[0];
      const existing = await database.query<{
        provider_request_id: string | null;
        provider_message_id: string | null;
        result: string;
      }>(
        `SELECT provider_request_id, provider_message_id, result FROM channel_delivery_attempts WHERE outbox_id = $1 AND attempt_number = $2 FOR UPDATE`,
        [input.outboxId, input.attemptNumber],
      );
      const exactAttempt =
        existing.rows?.[0]?.provider_request_id === input.providerRequestId &&
        existing.rows?.[0]?.provider_message_id === input.providerMessageId &&
        existing.rows?.[0]?.result === 'delivered';
      const contextMatches =
        !!proposalRow &&
        proposalRow.status === 'pending' &&
        !!bindingRow &&
        bindingRow.session_id === proposalRow.source_session_id &&
        bindingRow.connection_key === input.connectionKey &&
        bindingRow.root_message_id === input.targetId;
      if (
        outboxRow?.status === 'delivered' &&
        exactAttempt &&
        contextMatches &&
        outboxRow.provider_request_id === input.providerRequestId &&
        outboxRow.binding_id === input.bindingId &&
        outboxRow.connection_key === input.connectionKey &&
        outboxRow.target_id === input.targetId &&
        outboxRow.aggregate_id === input.proposalId &&
        outboxRow.aggregate_version === input.version &&
        outboxRow.delivery_kind === 'lark_card_reply' &&
        ['card', 'card_with_doc'].includes(current?.mode ?? '') &&
        ['active_card', 'active_card_with_doc'].includes(
          current?.status ?? '',
        ) &&
        !(current?.mode === 'card_with_doc' && current?.doc_token === null) &&
        current?.card_message_id === input.providerMessageId
      )
        return;
      if (
        !proposalRow ||
        proposalRow.status !== 'pending' ||
        !bindingRow ||
        !contextMatches ||
        bindingRow.session_id !== proposalRow.source_session_id ||
        !current ||
        !['card', 'card_with_doc'].includes(current.mode) ||
        (current.mode === 'card_with_doc' && current.doc_token === null) ||
        !['planned', 'publishing'].includes(current.status) ||
        !outboxRow ||
        outboxRow.status !== 'sending' ||
        outboxRow.attempt_count !== input.attemptNumber ||
        outboxRow.lease_owner !== input.leaseOwner ||
        outboxRow.provider_request_id !== input.providerRequestId ||
        outboxRow.binding_id !== input.bindingId ||
        outboxRow.connection_key !== input.connectionKey ||
        outboxRow.target_id !== input.targetId ||
        outboxRow.aggregate_id !== input.proposalId ||
        outboxRow.aggregate_version !== input.version ||
        outboxRow.delivery_kind !== 'lark_card_reply'
      ) {
        throw new Error('Card delivery finalization conflict');
      }
      if (existing.rows?.[0]) {
        if (
          existing.rows[0].provider_request_id !== input.providerRequestId ||
          existing.rows[0].provider_message_id !== input.providerMessageId ||
          existing.rows[0].result !== 'delivered'
        )
          throw new Error('Card delivery attempt conflict');
      } else {
        await database.query(
          `INSERT INTO channel_delivery_attempts (id, outbox_id, attempt_number, provider_request_id, provider_message_id, result)
           VALUES ($1,$2,$3,$4,$5,'delivered')`,
          [
            input.attemptId,
            input.outboxId,
            input.attemptNumber,
            input.providerRequestId,
            input.providerMessageId,
          ],
        );
      }
      const activated = await database.query<{ id: string }>(
        `UPDATE lark_memory_review_surfaces SET status = CASE WHEN mode = 'card_with_doc' THEN 'active_card_with_doc' ELSE 'active_card' END, card_message_id = $1, updated_at = now()
          WHERE id = $2 AND version = $3 AND status IN ('planned','publishing') RETURNING id`,
        [input.providerMessageId, input.surfaceId, input.version],
      );
      if (!activated.rows?.[0])
        throw new Error('Card delivery surface CAS failed');
      const updated = await database.query<{ id: string }>(
        `UPDATE channel_outbox SET status = 'delivered', lease_owner = NULL, lease_expires_at = NULL, next_attempt_at = NULL, updated_at = now()
          WHERE id = $1 AND status = 'sending' RETURNING id`,
        [input.outboxId],
      );
      if (!existing.rows?.[0] && !updated.rows?.[0])
        throw new Error('Card delivery finalization CAS failed');
    });
  }

  public async savePreview(input: {
    id: string;
    owner: ReviewSurfaceOwnerScope;
    content: string;
    sha256: string;
    docRevision?: string;
    deriveActionTokenHash?: (surfaceId: string, version: number) => string;
    creatingIngressId?: string;
    now: string;
  }): Promise<LarkMemoryReviewSurface> {
    return this.withTransaction(async (database) => {
      const current = await findSurface(database, input.id, input.owner);
      if (!current) throw new Error('review surface not found');
      const next = transitionReviewSurface(
        current,
        { kind: 'preview', content: input.content, sha256: input.sha256 },
        input.now,
      );
      if (
        current.status !== 'active_card_with_doc' &&
        current.status !== 'processing'
      )
        throw new Error('preview CAS failed');
      if (
        current.previewSha256 !== null &&
        current.previewSha256 !== next.previewSha256
      )
        throw new Error('review preview is immutable');
      const stale = await database.query<SurfaceRow>(
        `UPDATE lark_memory_review_surfaces SET status='stale', updated_at=$1 WHERE id=$2 AND version=$3 AND status IN ('active_card_with_doc','processing') RETURNING *`,
        [input.now, current.id, current.version],
      );
      if (!stale.rows?.[0]) throw new Error('preview CAS failed');
      const nextVersion = current.version + 1;
      const nextId = createHash('sha256')
        .update(`${current.id}|${nextVersion}`)
        .digest('hex');
      const nextSurface: LarkMemoryReviewSurface = {
        ...current,
        id: nextId,
        version: nextVersion,
        status: 'processing',
        docRevision: input.docRevision ?? current.docRevision ?? '0',
        creatingIngressId: input.creatingIngressId ?? current.creatingIngressId,
        previewContent: next.previewContent,
        previewSha256: next.previewSha256,
        actionTokenHash:
          input.deriveActionTokenHash?.(nextId, nextVersion) ??
          createHash('sha256')
            .update(`${current.actionTokenHash ?? ''}|${nextId}|${nextVersion}`)
            .digest('hex'),
        updatedAt: input.now,
      };
      return this.insertSurface(database, nextSurface);
    });
  }

  public async saveDocument(
    input: Parameters<LarkReviewSurfaceRepository['saveDocument']>[0],
  ): Promise<LarkMemoryReviewSurface> {
    return this.withTransaction(async (database) => {
      const current = await findSurface(database, input.id, input.owner);
      if (
        !current ||
        !['card', 'card_with_doc'].includes(current.mode) ||
        !['active_card', 'active_card_with_doc', 'processing'].includes(
          current.status,
        )
      )
        throw new Error('review surface not found');
      const result = await database.query<SurfaceRow>(
        `UPDATE lark_memory_review_surfaces SET mode='card_with_doc', status='active_card_with_doc', doc_token=$1, doc_revision=$2, updated_at=$3 WHERE id=$4 AND tenant_id=$5 AND workspace_id=$6 AND principal_type=$7 AND principal_id=$8 RETURNING *`,
        [
          input.docToken,
          input.docRevision,
          input.now,
          input.id,
          input.owner.tenantId,
          input.owner.workspaceId,
          input.owner.principalType,
          input.owner.principalId,
        ],
      );
      if (!result.rows?.[0]) throw new Error('document surface CAS failed');
      return mapRow(result.rows[0]);
    });
  }

  public async resolveSurface(input: {
    id: string;
    owner: ReviewSurfaceOwnerScope;
    version: number;
    ingressId: string;
    now: string;
  }): Promise<LarkMemoryReviewSurface> {
    return this.withTransaction(async (database) => {
      const candidate = await findSurface(
        database,
        input.id,
        input.owner,
        false,
      );
      if (!candidate || candidate.version !== input.version)
        throw new Error('review surface version conflict');
      await assertSurfaceContext(database, candidate, false, input.ingressId);
      const current = await findSurface(database, input.id, input.owner);
      if (
        !current ||
        current.version !== candidate.version ||
        current.proposalId !== candidate.proposalId ||
        current.bindingId !== candidate.bindingId ||
        current.creatingIngressId !== candidate.creatingIngressId ||
        current.cardMessageId !== candidate.cardMessageId
      ) {
        throw new Error('review surface version conflict');
      }
      const next = transitionReviewSurface(
        current,
        { kind: 'resolve', ingressId: input.ingressId },
        input.now,
      );
      const result = await database.query<SurfaceRow>(
        `UPDATE lark_memory_review_surfaces
       SET status = $1, resolving_ingress_id = $2, updated_at = $3
       WHERE id = $4 AND tenant_id = $5 AND workspace_id = $6 AND principal_type = $7 AND principal_id = $8
         AND version = $9 AND (status <> 'resolved' OR resolving_ingress_id = $2)
       RETURNING *`,
        [
          next.status,
          next.resolvingIngressId,
          next.updatedAt,
          input.id,
          input.owner.tenantId,
          input.owner.workspaceId,
          input.owner.principalType,
          input.owner.principalId,
          input.version,
        ],
      );
      if (!result.rows?.[0]) throw new Error('resolve CAS failed');
      return mapRow(result.rows[0]);
    });
  }
}

const SELECT_SQL = 'SELECT * FROM lark_memory_review_surfaces';

async function insertOrCompareTerminalOutbox(
  database: Queryable,
  input: {
    readonly id: string;
    readonly connectionKey: string;
    readonly bindingId: string;
    readonly targetId: string;
    readonly deliveryKind: string;
    readonly aggregateId: string;
    readonly aggregateVersion: number;
    readonly payload: string;
    readonly providerRequestId: string;
  },
): Promise<void> {
  await database.query(
    `INSERT INTO channel_outbox (id,connection_key,binding_id,target_id,delivery_kind,aggregate_id,aggregate_version,payload,provider_request_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (connection_key,delivery_kind,aggregate_id,aggregate_version) DO NOTHING`,
    [
      input.id,
      input.connectionKey,
      input.bindingId,
      input.targetId,
      input.deliveryKind,
      input.aggregateId,
      input.aggregateVersion,
      input.payload,
      input.providerRequestId,
    ],
  );
  const existing = await database.query<any>(
    `SELECT id,connection_key,binding_id,target_id,delivery_kind,aggregate_id,aggregate_version,payload,provider_request_id FROM channel_outbox WHERE connection_key=$1 AND delivery_kind=$2 AND aggregate_id=$3 AND aggregate_version=$4 FOR UPDATE`,
    [
      input.connectionKey,
      input.deliveryKind,
      input.aggregateId,
      input.aggregateVersion,
    ],
  );
  const row = existing.rows?.[0];
  if (
    !row ||
    row.id !== input.id ||
    row.connection_key !== input.connectionKey ||
    row.binding_id !== input.bindingId ||
    row.target_id !== input.targetId ||
    row.delivery_kind !== input.deliveryKind ||
    row.aggregate_id !== input.aggregateId ||
    Number(row.aggregate_version) !== input.aggregateVersion ||
    row.payload !== input.payload ||
    row.provider_request_id !== input.providerRequestId
  )
    throw new Error('terminal outbox conflict');
}

async function findSurface(
  database: Queryable,
  id: string,
  owner: ReviewSurfaceOwnerScope,
  lock = true,
): Promise<LarkMemoryReviewSurface | null> {
  const result = await database.query<SurfaceRow>(
    `${SELECT_SQL} WHERE id = $1 AND tenant_id = $2 AND workspace_id = $3 AND principal_type = $4 AND principal_id = $5${lock ? ' FOR UPDATE' : ''}`,
    [
      id,
      owner.tenantId,
      owner.workspaceId,
      owner.principalType,
      owner.principalId,
    ],
  );
  return result.rows?.[0] ? mapRow(result.rows[0]) : null;
}

async function assertSurfaceContext(
  database: Queryable,
  surface: LarkMemoryReviewSurface,
  requirePending: boolean,
  resolvingIngressId: string | null = null,
): Promise<void> {
  const proposal = await database.query<{
    id: string;
    status: string;
    source_session_id: string | null;
  }>(
    `SELECT id, status, source_session_id FROM workspace_memory_proposals
      WHERE id = $1 AND tenant_id = $2 AND workspace_id = $3
        AND principal_type = $4 AND principal_id = $5 FOR UPDATE`,
    [
      surface.proposalId,
      surface.tenantId,
      surface.workspaceId,
      surface.principalType,
      surface.principalId,
    ],
  );
  const binding = await database.query<{
    id: string;
    session_id: string | null;
    connection_key: string;
    chat_id: string;
    root_message_id: string;
  }>(
    `SELECT id, session_id, connection_key, chat_id, root_message_id
       FROM channel_conversation_bindings WHERE id = $1 FOR UPDATE`,
    [surface.bindingId],
  );
  const creating = await database.query<{
    kind: string;
    connection_key: string;
    chat_id: string;
    root_message_id: string | null;
    external_message_id: string | null;
    external_actor_id: string | null;
    action: Record<string, unknown> | null;
    status: string;
    lease_owner: string | null;
    attempt_count: number;
  }>(
    `SELECT kind, connection_key, chat_id, root_message_id, external_message_id,
            external_actor_id, action, status, lease_owner, attempt_count
       FROM channel_ingress_events WHERE id = $1`,
    [surface.creatingIngressId],
  );
  const resolving = resolvingIngressId
    ? await database.query<{
        kind: string;
        connection_key: string;
        chat_id: string;
        root_message_id: string | null;
        external_message_id: string | null;
      }>(
        `SELECT kind, connection_key, chat_id, root_message_id, external_message_id
         FROM channel_ingress_events WHERE id = $1`,
        [resolvingIngressId],
      )
    : null;
  const proposalRow = proposal.rows?.[0];
  const bindingRow = binding.rows?.[0];
  const creatingRow = creating.rows?.[0];
  const resolvingRow = resolving?.rows?.[0];
  const predecessor =
    creatingRow?.kind === 'card_action'
      ? await database.query<SurfaceRow>(
          `${SELECT_SQL}
             WHERE proposal_id = $1 AND binding_id = $2 AND version = $3
               AND tenant_id = $4 AND workspace_id = $5
               AND principal_type = $6 AND principal_id = $7
             FOR UPDATE`,
          [
            surface.proposalId,
            surface.bindingId,
            surface.version - 1,
            surface.tenantId,
            surface.workspaceId,
            surface.principalType,
            surface.principalId,
          ],
        )
      : null;
  const predecessorRow = predecessor?.rows?.[0];
  const creatingRoot =
    creatingRow &&
    (creatingRow.root_message_id ?? creatingRow.external_message_id);
  const creatingValid =
    proposalRow &&
    bindingRow &&
    creatingRow &&
    proposalRow.source_session_id !== null &&
    proposalRow.source_session_id === bindingRow.session_id &&
    bindingRow.connection_key === creatingRow.connection_key &&
    bindingRow.chat_id === creatingRow.chat_id &&
    bindingRow.root_message_id === creatingRoot;
  const cardActionCreatingValid =
    creatingRow?.kind !== 'card_action' ||
    (predecessorRow !== undefined &&
      predecessorRow.status === 'stale' &&
      predecessorRow.version + 1 === surface.version &&
      predecessorRow.proposal_id === proposalRow?.id &&
      predecessorRow.binding_id === bindingRow?.id &&
      predecessorRow.tenant_id === surface.tenantId &&
      predecessorRow.workspace_id === surface.workspaceId &&
      predecessorRow.principal_type === surface.principalType &&
      predecessorRow.principal_id === surface.principalId &&
      predecessorRow.card_message_id !== null &&
      creatingRow.connection_key === bindingRow?.connection_key &&
      creatingRow.chat_id === bindingRow?.chat_id &&
      creatingRow.external_message_id === predecessorRow.card_message_id &&
      creatingRow.external_actor_id !== null &&
      creatingRow.action !== null &&
      Object.keys(creatingRow.action).length === 2 &&
      creatingRow.action.action === 'preview_doc' &&
      creatingRow.action.digest === predecessorRow.action_token_hash &&
      creatingRow.status === 'processing' &&
      creatingRow.lease_owner !== null &&
      creatingRow.attempt_count > 0);
  const resolvingValid =
    !resolvingIngressId ||
    (resolvingRow &&
      bindingRow &&
      bindingRow.connection_key === resolvingRow.connection_key &&
      bindingRow.chat_id === resolvingRow.chat_id &&
      ((['message', 'command'].includes(resolvingRow.kind) &&
        bindingRow.root_message_id ===
          (resolvingRow.root_message_id ?? resolvingRow.external_message_id)) ||
        (resolvingRow.kind === 'card_action' &&
          surface.cardMessageId !== null &&
          resolvingRow.external_message_id === surface.cardMessageId)));
  if (
    (!creatingValid && creatingRow?.kind !== 'card_action') ||
    !cardActionCreatingValid ||
    !resolvingValid
  ) {
    throw new Error('review surface context validation failed');
  }
  if (requirePending && proposalRow?.status !== 'pending') {
    throw new Error('review surface proposal is not pending');
  }
}

async function serializePgliteTransaction<T>(
  database: Queryable,
  work: (database: Queryable) => Promise<T>,
): Promise<T> {
  const key = database as object;
  const previous = pgliteTransactionTails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => current);
  pgliteTransactionTails.set(key, queued);
  await previous;
  try {
    await database.query('BEGIN');
    const result = await work(database);
    await database.query('COMMIT');
    return result;
  } catch (error) {
    await database.query('ROLLBACK');
    throw error;
  } finally {
    release();
    if (pgliteTransactionTails.get(key) === queued)
      pgliteTransactionTails.delete(key);
  }
}

const INSERT_SQL = `INSERT INTO lark_memory_review_surfaces
  (id, tenant_id, workspace_id, principal_type, principal_id, proposal_id, binding_id, version, mode, status,
   card_message_id, doc_token, doc_revision, preview_content, preview_sha256, action_token_hash,
   creating_ingress_id, resolving_ingress_id, created_at, updated_at)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`;

function values(surface: LarkMemoryReviewSurface): readonly unknown[] {
  return [
    surface.id,
    surface.tenantId,
    surface.workspaceId,
    surface.principalType,
    surface.principalId,
    surface.proposalId,
    surface.bindingId,
    surface.version,
    surface.mode,
    surface.status,
    surface.cardMessageId,
    surface.docToken,
    surface.docRevision,
    surface.previewContent,
    surface.previewSha256,
    surface.actionTokenHash,
    surface.creatingIngressId,
    surface.resolvingIngressId,
    surface.createdAt,
    surface.updatedAt,
  ];
}

function mapRow(row: SurfaceRow): LarkMemoryReviewSurface {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    principalType: row.principal_type,
    principalId: row.principal_id,
    proposalId: row.proposal_id,
    bindingId: row.binding_id,
    version: row.version,
    mode: row.mode,
    status: row.status,
    cardMessageId: row.card_message_id,
    docToken: row.doc_token,
    docRevision: row.doc_revision,
    previewContent: row.preview_content,
    previewSha256: row.preview_sha256,
    actionTokenHash: row.action_token_hash,
    creatingIngressId: row.creating_ingress_id,
    resolvingIngressId: row.resolving_ingress_id,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

type PublicationDescriptor =
  | MemoryReviewCardPublicationDescriptor
  | MemoryReviewDocCardPublicationDescriptor;
function descriptorMatchesSurface(
  descriptor: PublicationDescriptor,
  surface: LarkMemoryReviewSurface,
  outbox: ChannelOutboxInput,
): boolean {
  return (
    descriptor.surfaceId === surface.id &&
    descriptor.version === surface.version &&
    descriptor.proposalId === surface.proposalId &&
    descriptor.bindingId === surface.bindingId &&
    descriptor.owner.tenantId === surface.tenantId &&
    descriptor.owner.workspaceId === surface.workspaceId &&
    descriptor.owner.principalType === surface.principalType &&
    descriptor.owner.principalId === surface.principalId &&
    descriptor.category.length > 0 &&
    (descriptor.type === 'lark_memory_doc_card_v1'
      ? descriptor.excerpt.length > 0
      : descriptor.content.length > 0) &&
    outbox.connectionKey.length > 0 &&
    outbox.targetId.length > 0 &&
    outbox.deliveryKind === 'lark_card_reply' &&
    outbox.aggregateId === surface.proposalId &&
    outbox.aggregateVersion === surface.version
  );
}

function candidatePublicationMatches(
  descriptor: PublicationDescriptor,
  surface: LarkMemoryReviewSurface,
  outbox: ChannelOutboxInput,
  derive: (surfaceId: string, version: number) => string,
  proposal?: { original_category: string; original_content: string },
): boolean {
  return (
    isPlannedCardSurface(surface) &&
    surface.actionTokenHash === derive(surface.id, surface.version) &&
    descriptorMatchesSurface(descriptor, surface, outbox) &&
    descriptor.category === proposal?.original_category &&
    descriptor.content === proposal?.original_content &&
    (descriptor.type === 'lark_memory_review_card_v1' ||
      (surface.mode === 'card_with_doc' &&
        descriptor.docToken === surface.docToken &&
        descriptor.docRevision === surface.docRevision))
  );
}

function canonicalPublicationMatches(
  surface: LarkMemoryReviewSurface,
  row: Record<string, unknown>,
  candidate: ChannelOutboxInput,
  derive: (surfaceId: string, version: number) => string,
  proposal?: { original_category: string; original_content: string },
  attempt?: {
    provider_request_id: string | null;
    provider_message_id: string | null;
    result: string;
  },
): boolean {
  let descriptor: PublicationDescriptor;
  try {
    descriptor = parsePublicationDescriptor(JSON.parse(String(row.payload)));
  } catch {
    return false;
  }
  const plannedPair =
    isPlannedCardSurface(surface) &&
    [
      'pending',
      'sending',
      'retry_wait',
      'permanent_failed',
      'delivery_unknown',
    ].includes(String(row.status));
  const deliveredPair =
    ['card', 'card_with_doc'].includes(surface.mode) &&
    ['active_card', 'active_card_with_doc'].includes(surface.status) &&
    row.status === 'delivered' &&
    surface.cardMessageId !== null &&
    attempt?.result === 'delivered' &&
    attempt.provider_request_id === row.provider_request_id &&
    attempt.provider_message_id === surface.cardMessageId;
  return (
    (plannedPair || deliveredPair) &&
    surface.actionTokenHash === derive(surface.id, surface.version) &&
    descriptorMatchesSurface(descriptor, surface, candidate) &&
    descriptor.category === proposal?.original_category &&
    descriptor.content === proposal?.original_content &&
    (descriptor.type === 'lark_memory_review_card_v1' ||
      descriptor.docToken === surface.docToken) &&
    descriptor.surfaceId === surface.id &&
    descriptor.version === surface.version &&
    row.connection_key === candidate.connectionKey &&
    row.binding_id === candidate.bindingId &&
    row.target_id === candidate.targetId &&
    row.delivery_kind === candidate.deliveryKind &&
    row.aggregate_id === candidate.aggregateId &&
    row.aggregate_version === candidate.aggregateVersion &&
    row.provider_request_id === candidate.providerRequestId
  );
}

function parsePublicationDescriptor(value: unknown): PublicationDescriptor {
  if (
    value &&
    typeof value === 'object' &&
    (value as Record<string, unknown>).type === 'lark_memory_doc_card_v1'
  )
    return parseMemoryReviewDocCardPublicationDescriptor(value);
  return parseMemoryReviewCardPublicationDescriptor(value);
}

function isPlannedCardSurface(surface: LarkMemoryReviewSurface): boolean {
  return (
    ['card', 'card_with_doc'].includes(surface.mode) &&
    surface.status === 'planned' &&
    Number.isInteger(surface.version) &&
    surface.version >= 1 &&
    surface.creatingIngressId.length > 0 &&
    surface.cardMessageId === null &&
    surface.previewContent === null &&
    surface.previewSha256 === null &&
    surface.resolvingIngressId === null
  );
}
