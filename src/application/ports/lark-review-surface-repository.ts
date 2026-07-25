import type { LarkMemoryReviewSurface } from '../../domain/channels/lark-memory-review-surface.js';
import type { ChannelOutboxInput } from '../../domain/channels/channel-delivery.js';

export interface ReviewSurfaceOwnerScope {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly principalType: string;
  readonly principalId: string;
}

export interface LarkReviewSurfaceRepository {
  authorizeCardAction(input: {
    readonly actionTokenHash: string;
    readonly ingressId: string;
    readonly leaseOwner: string;
    readonly attemptNumber: number;
    readonly actionDigest: string;
    readonly version?: number;
    readonly actorId: string;
    readonly connectionKey: string;
    readonly chatId: string;
    readonly cardMessageId: string;
    readonly action:
      'accept' | 'reject' | 'edit_in_doc' | 'preview_doc' | 'accept_preview';
    readonly owner: ReviewSurfaceOwnerScope;
  }): Promise<{
    readonly surface: LarkMemoryReviewSurface;
    readonly proposal: {
      readonly id: string;
      readonly originalCategory: string;
      readonly originalContent: string;
      readonly status: string;
      readonly sourceSessionId: string | null;
      readonly sourceRunId: string | null;
      readonly reviewedContent: string | null;
      readonly reviewControllerIngressId: string | null;
      readonly tenantId: string;
      readonly workspaceId: string;
      readonly principalType: string;
      readonly principalId: string;
    };
    readonly replayOutcome?: 'accepted' | 'rejected';
  }>;
  resolveSurfaceAndCreateTerminalOutboxes(input: {
    readonly surface: LarkMemoryReviewSurface;
    readonly owner: ReviewSurfaceOwnerScope;
    readonly ingressId: string;
    readonly leaseOwner: string;
    readonly attemptNumber: number;
    readonly actionDigest: string;
    readonly actorId: string;
    readonly connectionKey: string;
    readonly chatId: string;
    readonly outcome: 'accepted' | 'rejected';
    readonly category: string;
    readonly content: string;
    readonly card: unknown;
    readonly threadText: string;
  }): Promise<void>;
  createCardSurfaceAndOutbox(input: {
    readonly surface: LarkMemoryReviewSurface;
    readonly outbox: ChannelOutboxInput;
    readonly deriveActionTokenHash: (
      surfaceId: string,
      version: number,
    ) => string;
  }): Promise<LarkMemoryReviewSurface>;
  createSurface(
    input: LarkMemoryReviewSurface,
  ): Promise<LarkMemoryReviewSurface>;
  getSurface(
    id: string,
    owner: ReviewSurfaceOwnerScope,
  ): Promise<LarkMemoryReviewSurface | null>;
  getSurfaceByActionTokenHash(input: {
    readonly actionTokenHash: string;
    readonly owner: ReviewSurfaceOwnerScope;
  }): Promise<LarkMemoryReviewSurface | null>;
  getActiveSurface(
    input: ReviewSurfaceOwnerScope & {
      readonly proposalId: string;
      readonly bindingId: string;
    },
  ): Promise<LarkMemoryReviewSurface | null>;
  claimActiveVersion(input: {
    readonly surface: LarkMemoryReviewSurface;
    readonly expectedActiveVersion: number | null;
  }): Promise<LarkMemoryReviewSurface>;
  activateCardMessage(input: {
    readonly surfaceId: string;
    readonly version: number;
    readonly proposalId: string;
    readonly bindingId: string;
    readonly providerMessageId: string;
  }): Promise<LarkMemoryReviewSurface>;
  validateCardPublication(input: {
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
  }): Promise<LarkMemoryReviewSurface>;
  finalizeCardDelivery(input: {
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
  }): Promise<void>;
  savePreview(input: {
    readonly id: string;
    readonly owner: ReviewSurfaceOwnerScope;
    readonly content: string;
    readonly sha256: string;
    readonly docRevision?: string;
    readonly deriveActionTokenHash?: (
      surfaceId: string,
      version: number,
    ) => string;
    readonly creatingIngressId?: string;
    readonly now: string;
  }): Promise<LarkMemoryReviewSurface>;
  saveDocument(input: {
    readonly id: string;
    readonly owner: ReviewSurfaceOwnerScope;
    readonly docToken: string;
    readonly docRevision: string;
    readonly now: string;
  }): Promise<LarkMemoryReviewSurface>;
  resolveSurface(input: {
    readonly id: string;
    readonly owner: ReviewSurfaceOwnerScope;
    readonly version: number;
    readonly ingressId: string;
    readonly now: string;
  }): Promise<LarkMemoryReviewSurface>;
}
