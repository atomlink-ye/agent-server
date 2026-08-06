import { createHash } from 'node:crypto';
import type { ChannelIngress } from '../../domain/channels/channel-event.js';
import type { ChannelRepository } from '../ports/channel-repository.js';
import type { LarkCanaryEnabledConfig } from '../../shared/config.js';
import type { LarkReviewSurfaceRepository } from '../ports/lark-review-surface-repository.js';
import type { ReviewMemoryProposal } from '../memory/review-memory-proposal.js';
import type { ManagedMemory } from '../memory/managed-memory.js';
import type { WorkspaceMemoryEntry } from '../../domain/workspace-memory/memory-proposal.js';
import { ownerFromLarkCanary } from './resolve-lark-binding.js';
import type { MemoryReviewCardRenderer } from '../ports/memory-review-card-renderer.js';
import type { MemoryDocumentPort } from '../ports/lark-memory-document.js';
import type { SynthesizeMemoryDocument } from './synthesize-memory-document.js';
import { createMemoryReviewActionTokenDeriver } from './memory-review-action-token.js';
import type { AcceptMemoryFromBoundDocument } from './accept-memory-from-bound-document.js';

const SAFE_FAILURE = 'memory_review_control_failed';

export class ApplyMemoryReviewControl {
  public constructor(
    private readonly channels: Pick<
      ChannelRepository,
      'completeIngress' | 'saveOutbox' | 'releaseIngress'
    >,
    private readonly surfaces: Pick<
      LarkReviewSurfaceRepository,
      | 'authorizeCardAction'
      | 'resolveSurfaceAndCreateTerminalOutboxes'
      | 'saveDocument'
      | 'savePreview'
    >,
    private readonly review: Pick<ReviewMemoryProposal, 'execute'>,
    private readonly managedMemory: Pick<ManagedMemory, 'acceptEntry'>,
    private readonly config: LarkCanaryEnabledConfig,
    private readonly cards: Pick<MemoryReviewCardRenderer, 'renderResolved'>,
    private readonly documents?: MemoryDocumentPort,
    private readonly synthesize?: Pick<SynthesizeMemoryDocument, 'execute'>,
    private readonly acceptFromDocument?: Pick<
      AcceptMemoryFromBoundDocument,
      'execute'
    >,
  ) {}

  public async execute(ingress: ChannelIngress): Promise<{
    readonly accepted: boolean;
    readonly outcome?: string;
    readonly reason?: string;
  }> {
    const fail = async (
      reason: string,
      status: 'processed' | 'failed' = 'processed',
    ) => {
      await this.channels.completeIngress({
        ingressId: ingress.id,
        status,
        safeErrorCode: reason,
        ...ingressFence(ingress),
      });
      return { accepted: false, reason };
    };
    if (ingress.kind !== 'card_action') return fail('unsupported_ingress');
    if (
      ingress.connectionKey !== this.config.connectionKey ||
      ingress.chatId !== this.config.allowedChatId ||
      ingress.externalActorId !== this.config.allowedOpenId
    )
      return fail('card_action_not_allowed');
    if (
      ingress.status !== 'processing' ||
      !ingress.leaseOwner ||
      !ingress.externalMessageId
    )
      return fail('card_action_lease_required');
    const action = ingress.action;
    if (
      !action ||
      Object.keys(action).length !== 2 ||
      typeof action.action !== 'string' ||
      typeof action.digest !== 'string' ||
      !/^[a-f0-9]{64}$/.test(action.digest)
    )
      return fail('invalid_card_action');
    if (
      ![
        'accept',
        'reject',
        'edit_in_doc',
        'preview_doc',
        'accept_preview',
      ].includes(action.action)
    )
      return fail('invalid_card_action');
    const digest = action.digest;
    if (!ingress.externalMessageId) return fail('invalid_card_action');
    let stage: 'authorization' | 'canonical' | 'projection' | 'ui' =
      'authorization';
    try {
      const owner = ownerFromLarkCanary(this.config);
      const authorized = await this.surfaces.authorizeCardAction({
        actionTokenHash: digest,
        ingressId: ingress.id,
        leaseOwner: ingress.leaseOwner!,
        attemptNumber: ingress.attemptCount,
        actionDigest: digest,
        actorId: ingress.externalActorId!,
        connectionKey: ingress.connectionKey,
        chatId: ingress.chatId,
        cardMessageId: ingress.externalMessageId,
        action: action.action as
          | 'accept'
          | 'reject'
          | 'edit_in_doc'
          | 'preview_doc'
          | 'accept_preview',
        owner,
      });
      stage = 'canonical';
      if (action.action === 'edit_in_doc') {
        const doc = this.documents
          ? await this.documents.create({
              category: authorized.proposal.originalCategory,
              proposal: authorized.proposal.originalContent,
              allowedOpenId: ingress.externalActorId!,
            })
          : undefined;
        const updated = doc
          ? await this.surfaces.saveDocument({
              id: authorized.surface.id,
              owner,
              docToken: doc.token,
              docRevision: doc.revision,
              now: new Date().toISOString(),
            })
          : authorized.surface;
        stage = 'ui';
        await this.channels.saveOutbox({
          id: stableId('handoff', ingress.id),
          connectionKey: ingress.connectionKey,
          bindingId: authorized.surface.bindingId,
          targetId: ingress.externalMessageId,
          deliveryKind: doc ? 'lark_card_patch' : 'lark_thread_result',
          aggregateId: authorized.proposal.id,
          aggregateVersion: updated.version,
          payload: doc
            ? JSON.stringify(
                docControlPatch(
                  updated,
                  owner,
                  authorized.proposal.originalCategory,
                  authorized.proposal.originalContent.slice(0, 1000),
                  'Ready',
                  false,
                  doc.token,
                ),
              )
            : 'Editing this memory in a document will be available in a later update.',
          providerRequestId: stableId('handoff-request', ingress.id),
        });
        await this.channels.completeIngress({
          ingressId: ingress.id,
          status: 'processed',
          ...ingressFence(ingress),
        });
        return { accepted: true, outcome: 'document_handoff_required' };
      }
      if (action.action === 'preview_doc') {
        if (
          !this.documents ||
          authorized.surface.mode !== 'card_with_doc' ||
          !authorized.surface.docToken
        )
          return fail('document_not_ready');
        let content = authorized.surface.previewContent;
        let saved = authorized.surface;
        if (!content) {
          if (!this.synthesize) return fail('document_synthesis_unavailable');
          const draft = await this.documents.readDraft(
            authorized.surface.docToken,
          );
          content = await this.synthesize.execute({
            ingressId: ingress.id,
            category: authorized.proposal.originalCategory,
            draft,
          });
          saved = await this.surfaces.savePreview({
            id: authorized.surface.id,
            owner,
            content,
            sha256: createHash('sha256').update(content, 'utf8').digest('hex'),
            docRevision: draft.revision,
            deriveActionTokenHash: (surfaceId, version) =>
              createHash('sha256')
                .update(
                  createMemoryReviewActionTokenDeriver(
                    this.config.appSecret,
                  ).derive({ surfaceId, version }),
                )
                .digest('hex'),
            creatingIngressId: ingress.id,
            now: new Date().toISOString(),
          });
        }
        await this.channels.saveOutbox({
          id: stableId('preview-patch', ingress.id),
          connectionKey: ingress.connectionKey,
          bindingId: saved.bindingId,
          targetId: ingress.externalMessageId,
          deliveryKind: 'lark_card_patch',
          aggregateId: saved.proposalId,
          aggregateVersion: saved.version,
          payload: JSON.stringify(
            docControlPatch(
              saved,
              owner,
              authorized.proposal.originalCategory,
              authorized.proposal.originalContent.slice(0, 1000),
              'Preview ready',
              true,
              saved.docToken!,
              content,
              saved.previewSha256!,
            ),
          ),
          providerRequestId: stableId('preview-request', ingress.id),
        });
        await this.channels.completeIngress({
          ingressId: ingress.id,
          status: 'processed',
          ...ingressFence(ingress),
        });
        return { accepted: true, outcome: 'previewed' };
      }
      if (
        action.action === 'accept' &&
        authorized.surface.mode === 'card_with_doc'
      ) {
        stage = 'projection';
        if (!this.acceptFromDocument)
          throw new Error('document_accept_unavailable');
        const accepted = await this.acceptFromDocument.execute({
          ingressId: ingress.id,
          proposal: authorized.proposal,
          surface: authorized.surface,
          owner,
        });
        const card = this.cards.renderResolved({
          status: 'accepted',
          category: authorized.proposal.originalCategory,
          content: accepted.content,
        });
        stage = 'ui';
        await this.surfaces.resolveSurfaceAndCreateTerminalOutboxes({
          surface: authorized.surface,
          owner,
          ingressId: ingress.id,
          outcome: 'accepted',
          leaseOwner: ingress.leaseOwner!,
          attemptNumber: ingress.attemptCount,
          actionDigest: digest,
          actorId: ingress.externalActorId!,
          connectionKey: ingress.connectionKey,
          chatId: ingress.chatId,
          category: authorized.proposal.originalCategory,
          content: accepted.content,
          card,
          threadText: `Memory accepted: ${authorized.proposal.originalCategory}.`,
        });
        await this.channels.completeIngress({
          ingressId: ingress.id,
          status: 'processed',
          ...ingressFence(ingress),
        });
        return { accepted: true, outcome: 'accepted' };
      }
      const persistedPreview =
        action.action === 'accept_preview'
          ? authorized.surface.previewContent
          : null;
      if (action.action === 'accept_preview' && !persistedPreview)
        return fail('no_persisted_preview');
      const reviewed = await this.review.execute({
        proposalId: authorized.proposal.id,
        action:
          action.action === 'accept_preview'
            ? 'edit_and_accept'
            : (action.action as 'accept' | 'reject'),
        ...(persistedPreview !== null ? { content: persistedPreview } : {}),
        accessContext: owner,
        controller: { kind: 'channel_ingress', ingressId: ingress.id },
      });
      stage = 'projection';
      let snapshot:
        | {
            projectionStatus: string;
            snapshotId?: string;
            contentHash?: string;
          }
        | undefined;
      if (
        (action.action === 'accept' || action.action === 'accept_preview') &&
        reviewed.entry
      ) {
        snapshot = await this.managedMemory.acceptEntry(
          reviewed.entry as WorkspaceMemoryEntry,
        );
        if (snapshot.projectionStatus !== 'ready') {
          if (this.channels.releaseIngress)
            await this.channels.releaseIngress({
              ingressId: ingress.id,
              leaseOwner: ingress.leaseOwner!,
              attemptNumber: ingress.attemptCount,
              safeErrorCode: 'memory_projection_not_ready',
            });
          else
            await this.channels.completeIngress({
              ingressId: ingress.id,
              status: 'failed',
              safeErrorCode: 'memory_projection_not_ready',
              ...ingressFence(ingress),
            });
          return { accepted: false, reason: 'memory_projection_not_ready' };
        }
      }
      const outcome = action.action === 'reject' ? 'rejected' : 'accepted';
      stage = 'ui';
      const acceptedContent =
        persistedPreview ?? authorized.proposal.originalContent;
      const card = this.cards.renderResolved({
        status: outcome,
        category: authorized.proposal.originalCategory,
        content: acceptedContent,
      });
      await this.surfaces.resolveSurfaceAndCreateTerminalOutboxes({
        surface: authorized.surface,
        owner,
        ingressId: ingress.id,
        outcome,
        leaseOwner: ingress.leaseOwner!,
        attemptNumber: ingress.attemptCount,
        actionDigest: digest,
        actorId: ingress.externalActorId!,
        connectionKey: ingress.connectionKey,
        chatId: ingress.chatId,
        category: authorized.proposal.originalCategory,
        content: acceptedContent,
        card,
        threadText:
          outcome === 'accepted'
            ? `Memory accepted: ${authorized.proposal.originalCategory}.`
            : `Memory rejected: ${authorized.proposal.originalCategory}.`,
      });
      await this.channels.completeIngress({
        ingressId: ingress.id,
        status: 'processed',
        ...ingressFence(ingress),
      });
      return { accepted: true, outcome };
    } catch {
      if (stage === 'projection' || stage === 'ui') {
        if (this.channels.releaseIngress)
          await this.channels.releaseIngress({
            ingressId: ingress.id,
            leaseOwner: ingress.leaseOwner!,
            attemptNumber: ingress.attemptCount,
            safeErrorCode: SAFE_FAILURE,
          });
        else
          await this.channels.completeIngress({
            ingressId: ingress.id,
            status: 'failed',
            safeErrorCode: SAFE_FAILURE,
            ...ingressFence(ingress),
          });
        return { accepted: false, reason: SAFE_FAILURE };
      }
      return fail(SAFE_FAILURE, 'failed');
    }
  }
}

function ingressFence(ingress: ChannelIngress): {
  readonly leaseOwner: string;
  readonly attemptNumber: number;
} {
  if (!ingress.leaseOwner) throw new Error('claimed ingress lease is required');
  return {
    leaseOwner: ingress.leaseOwner,
    attemptNumber: ingress.attemptCount,
  };
}

function stableId(prefix: string, value: string): string {
  return `${prefix}-${createHash('sha256').update(value).digest('hex').slice(0, 32)}`;
}

function docControlPatch(
  surface: {
    readonly id: string;
    readonly version: number;
    readonly proposalId: string;
    readonly bindingId: string;
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly principalType: string;
    readonly principalId: string;
    readonly docToken: string | null;
  },
  owner: {
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly principalType: string;
    readonly principalId: string;
  },
  category: string,
  excerpt: string,
  docStatus: string,
  previewed: false,
  docToken: string,
): object;
function docControlPatch(
  surface: {
    readonly id: string;
    readonly version: number;
    readonly proposalId: string;
    readonly bindingId: string;
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly principalType: string;
    readonly principalId: string;
    readonly docToken: string | null;
  },
  owner: {
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly principalType: string;
    readonly principalId: string;
  },
  category: string,
  excerpt: string,
  docStatus: string,
  previewed: true,
  docToken: string,
  previewExcerpt: string,
  previewFingerprint: string,
): object;
function docControlPatch(
  surface: {
    readonly id: string;
    readonly version: number;
    readonly proposalId: string;
    readonly bindingId: string;
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly principalType: string;
    readonly principalId: string;
    readonly docToken: string | null;
  },
  owner: {
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly principalType: string;
    readonly principalId: string;
  },
  category: string,
  excerpt: string,
  docStatus: string,
  previewed: boolean,
  docToken: string,
  previewExcerpt?: string,
  previewFingerprint?: string,
): object {
  return {
    type: 'lark_memory_doc_control_patch_v1',
    surfaceId: surface.id,
    version: surface.version,
    proposalId: surface.proposalId,
    bindingId: surface.bindingId,
    owner: {
      tenantId: owner.tenantId,
      workspaceId: owner.workspaceId,
      principalType: owner.principalType,
      principalId: owner.principalId,
    },
    category,
    excerpt,
    docToken,
    docStatus,
    previewed,
    ...(previewed ? { previewExcerpt, previewFingerprint } : {}),
  };
}
