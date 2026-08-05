import { createHash, randomUUID } from 'node:crypto';
import type { ChannelRepository } from '../ports/channel-repository.js';
import type {
  LarkDelivery,
  LarkDeliveryInput,
} from '../ports/lark-delivery.js';
import type { ChannelOutbox } from '../../domain/channels/channel-delivery.js';
import type { LarkReviewSurfaceRepository } from '../ports/lark-review-surface-repository.js';
import type { MemoryReviewActionTokenDeriver } from './memory-review-action-token.js';
import type { MemoryReviewCardRenderer } from '../ports/memory-review-card-renderer.js';
import {
  parseMemoryReviewCardPublicationDescriptor,
  parseMemoryReviewDocCardPublicationDescriptor,
  type MemoryReviewCardPublicationDescriptor,
  type MemoryReviewDocCardPublicationDescriptor,
} from '../../domain/channels/lark-memory-review-card-publication.js';
import { parseMemoryReviewDocControlPatchDescriptor } from '../../domain/channels/lark-memory-doc-control-publication.js';

export class DeliverChannelOutbox {
  public constructor(
    private readonly delivery: Pick<LarkDelivery, 'deliver'>,
    private readonly repository: Pick<ChannelRepository, 'recordAttempt'>,
    private readonly cardPublication?: CardPublicationDependencies,
  ) {}

  public async execute(outbox: ChannelOutbox): Promise<void> {
    let input;
    let cardPublication: CardPublication | undefined;
    try {
      if (outbox.deliveryKind === 'lark_card_reply') {
        if (!this.cardPublication)
          throw new Error('card_publication_unavailable');
        const prepared = await prepareCardPublication(
          outbox,
          this.cardPublication,
        );
        input = prepared.input;
        cardPublication = prepared.publication;
      } else {
        input = deliveryInput(outbox, this.cardPublication);
      }
    } catch (error) {
      await this.repository.recordAttempt({
        id: randomUUID(),
        outboxId: outbox.id,
        attemptNumber: outbox.attemptCount,
        providerRequestId: outbox.providerRequestId,
        ...(outbox.leaseOwner ? { leaseOwner: outbox.leaseOwner } : {}),
        result: 'permanent_failure',
        safeErrorCode:
          error instanceof Error &&
          error.message === 'unsupported delivery kind'
            ? 'unsupported_delivery_kind'
            : 'invalid_delivery_payload',
      });
      return;
    }
    const result = await this.delivery.deliver(input);
    if (
      outbox.deliveryKind === 'lark_card_reply' &&
      result.result === 'delivered' &&
      !result.providerMessageId
    ) {
      await this.repository.recordAttempt({
        id: randomUUID(),
        outboxId: outbox.id,
        attemptNumber: outbox.attemptCount,
        providerRequestId: outbox.providerRequestId,
        result: 'unknown',
        safeErrorCode: 'missing_provider_message_id',
        ...(outbox.leaseOwner ? { leaseOwner: outbox.leaseOwner } : {}),
      });
      return;
    }
    if (
      outbox.deliveryKind === 'lark_card_reply' &&
      result.result === 'delivered' &&
      result.providerMessageId &&
      this.cardPublication &&
      cardPublication
    ) {
      await this.cardPublication.finalizeCardDelivery({
        outboxId: outbox.id,
        attemptId: randomUUID(),
        attemptNumber: outbox.attemptCount,
        providerRequestId: outbox.providerRequestId,
        providerMessageId: result.providerMessageId,
        surfaceId: cardPublication.surfaceId,
        version: cardPublication.version,
        proposalId: outbox.aggregateId,
        bindingId: outbox.bindingId ?? '',
        connectionKey: outbox.connectionKey,
        targetId: outbox.targetId,
        leaseOwner: outbox.leaseOwner ?? '',
      });
      return;
    }
    await this.repository.recordAttempt({
      id: randomUUID(),
      outboxId: outbox.id,
      attemptNumber: outbox.attemptCount,
      providerRequestId: outbox.providerRequestId,
      ...(outbox.leaseOwner ? { leaseOwner: outbox.leaseOwner } : {}),
      ...(result.providerMessageId
        ? { providerMessageId: result.providerMessageId }
        : {}),
      result: result.result,
      ...(result.safeErrorCode ? { safeErrorCode: result.safeErrorCode } : {}),
    });
  }
}

type CardPublication = { readonly surfaceId: string; readonly version: number };
type CardPublicationDependencies = {
  readonly cards: Pick<
    MemoryReviewCardRenderer,
    'renderPending' | 'renderWithDocumentControls'
  >;
  readonly tokenDeriver: MemoryReviewActionTokenDeriver;
  readonly validateCardPublication: LarkReviewSurfaceRepository['validateCardPublication'];
  readonly finalizeCardDelivery: LarkReviewSurfaceRepository['finalizeCardDelivery'];
  readonly docWebBaseUrl?: string;
};

async function prepareCardPublication(
  outbox: ChannelOutbox,
  dependencies: CardPublicationDependencies,
): Promise<{
  input: LarkDeliveryInput & { kind: 'card_reply' };
  publication: CardPublication;
}> {
  if (!outbox.leaseOwner) throw new Error('card_publication_unavailable');
  const descriptor = parseDescriptor(outbox.payload);
  if (
    descriptor.proposalId !== outbox.aggregateId ||
    descriptor.bindingId !== (outbox.bindingId ?? '') ||
    descriptor.version !== outbox.aggregateVersion
  )
    throw new Error('invalid memory review Card descriptor');
  const token = dependencies.tokenDeriver.derive({
    surfaceId: descriptor.surfaceId,
    version: descriptor.version,
  });
  await dependencies.validateCardPublication({
    ...descriptor,
    actionTokenHash: createHash('sha256').update(token).digest('hex'),
    connectionKey: outbox.connectionKey,
    targetId: outbox.targetId,
    aggregateVersion: outbox.aggregateVersion,
    outboxId: outbox.id,
    attemptNumber: outbox.attemptCount,
    leaseOwner: outbox.leaseOwner,
  });
  return {
    input: {
      kind: 'card_reply' as const,
      targetId: outbox.targetId,
      cardJson: JSON.stringify(
        descriptor.type === 'lark_memory_doc_card_v1'
          ? dependencies.cards.renderWithDocumentControls({
              category: descriptor.category,
              excerpt: descriptor.excerpt,
              docStatus: 'Ready',
              docUrl: `${dependencies.docWebBaseUrl ?? ''}/docx/${descriptor.docToken}`,
              token,
              previewed: false,
            })
          : dependencies.cards.renderPending({
              category: descriptor.category,
              content: descriptor.content,
              token,
            }),
      ),
      providerRequestId: outbox.providerRequestId,
    },
    publication: {
      surfaceId: descriptor.surfaceId,
      version: descriptor.version,
    },
  };
}

function parseDescriptor(
  payload: string,
):
  | MemoryReviewCardPublicationDescriptor
  | MemoryReviewDocCardPublicationDescriptor {
  const value = JSON.parse(payload);
  return value?.type === 'lark_memory_doc_card_v1'
    ? parseMemoryReviewDocCardPublicationDescriptor(value)
    : parseMemoryReviewCardPublicationDescriptor(value);
}

function deliveryInput(
  outbox: ChannelOutbox,
  dependencies?: CardPublicationDependencies,
) {
  const textKinds = new Set([
    'agent_run_result',
    'memory_review_command',
    'memory-review-result',
    'lark_thread_result',
  ]);
  if (
    !textKinds.has(outbox.deliveryKind) &&
    outbox.deliveryKind !== 'lark_card_patch'
  )
    throw new Error('unsupported delivery kind');
  if (outbox.deliveryKind !== 'lark_card_patch') {
    return {
      kind: 'text' as const,
      targetId: outbox.targetId,
      text: outbox.payload,
      providerRequestId: outbox.providerRequestId,
    };
  }
  const parsed: unknown = JSON.parse(outbox.payload);
  if (isDocControlPatch(parsed)) {
    if (!dependencies) throw new Error('card_publication_unavailable');
    const descriptor = parseMemoryReviewDocControlPatchDescriptor(parsed);
    const token = dependencies.tokenDeriver.derive({
      surfaceId: descriptor.surfaceId,
      version: descriptor.version,
    });
    const card = dependencies.cards.renderWithDocumentControls({
      category: descriptor.category,
      excerpt: descriptor.excerpt,
      docStatus: descriptor.docStatus,
      docUrl: `${dependencies.docWebBaseUrl ?? ''}/docx/${descriptor.docToken}`,
      token,
      previewed: descriptor.previewed,
      ...(descriptor.previewed
        ? {
            previewExcerpt: descriptor.previewExcerpt,
            previewFingerprint: descriptor.previewFingerprint,
          }
        : {}),
    });
    return {
      kind: 'card_patch' as const,
      targetId: outbox.targetId,
      cardJson: JSON.stringify(card),
      providerRequestId: outbox.providerRequestId,
    };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    throw new Error('invalid');
  const value = parsed as Record<string, unknown>;
  if (Object.keys(value).length !== 1 || !isCompleteCard(value.card))
    throw new Error('invalid');
  return {
    kind: 'card_patch' as const,
    targetId: outbox.targetId,
    cardJson: JSON.stringify(value.card),
    providerRequestId: outbox.providerRequestId,
  };
}

function isDocControlPatch(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).type ===
      'lark_memory_doc_control_patch_v1'
  );
}

function isCompleteCard(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false;
  const card = value as Record<string, unknown>;
  const config = card.config;
  const header = card.header;
  const body = card.body;
  const configRecord = isObject(config) ? config : undefined;
  const headerRecord = isObject(header) ? header : undefined;
  const bodyRecord = isObject(body) ? body : undefined;
  const title = headerRecord?.title;
  const titleRecord = isObject(title) ? title : undefined;
  return (
    card.schema === '2.0' &&
    configRecord?.update_multi === true &&
    configRecord.enable_forward === false &&
    configRecord.width_mode === 'default' &&
    (headerRecord?.template === 'blue' ||
      headerRecord?.template === 'green' ||
      headerRecord?.template === 'red') &&
    titleRecord?.tag === 'plain_text' &&
    typeof titleRecord.content === 'string' &&
    Array.isArray(bodyRecord?.elements)
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
