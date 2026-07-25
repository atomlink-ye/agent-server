import { createHash } from 'node:crypto';

export type ReviewSurfaceMode = 'card' | 'card_with_doc' | 'command_only';
export type ReviewSurfaceStatus =
  | 'planned'
  | 'publishing'
  | 'active_card'
  | 'active_card_with_doc'
  | 'command_only'
  | 'processing'
  | 'resolved'
  | 'stale'
  | 'delivery_unknown';

export interface LarkMemoryReviewSurface {
  readonly id: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly principalType: string;
  readonly principalId: string;
  readonly proposalId: string;
  readonly bindingId: string;
  readonly version: number;
  readonly mode: ReviewSurfaceMode;
  readonly status: ReviewSurfaceStatus;
  readonly cardMessageId: string | null;
  readonly docToken: string | null;
  readonly docRevision: string | null;
  readonly previewContent: string | null;
  readonly previewSha256: string | null;
  readonly actionTokenHash: string | null;
  readonly creatingIngressId: string;
  readonly resolvingIngressId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type ReviewSurfaceTransition =
  | { readonly kind: 'publish'; readonly mode: ReviewSurfaceMode }
  | {
      readonly kind: 'preview';
      readonly content: string;
      readonly sha256: string;
    }
  | { readonly kind: 'resolve'; readonly ingressId: string };

export const MAX_REVIEW_PREVIEW_BYTES = 4096;

export function selectReviewSurfaceMode(content: string): ReviewSurfaceMode {
  return content.length <= 1500 && content.split('\n').length <= 20
    ? 'card'
    : 'card_with_doc';
}

export function sha256Preview(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export function transitionReviewSurface(
  surface: LarkMemoryReviewSurface,
  transition: ReviewSurfaceTransition,
  now: string,
): LarkMemoryReviewSurface {
  if (transition.kind === 'publish') {
    if (!['planned', 'publishing'].includes(surface.status)) {
      throw new Error(
        'review surface cannot be published from its current status',
      );
    }
    return {
      ...surface,
      mode: transition.mode,
      status:
        transition.mode === 'card'
          ? 'active_card'
          : transition.mode === 'card_with_doc'
            ? 'active_card_with_doc'
            : 'command_only',
      updatedAt: now,
    };
  }

  if (transition.kind === 'preview') {
    assertPreviewContent(transition.content);
    if (surface.mode !== 'card_with_doc') {
      throw new Error('review preview requires card_with_doc mode');
    }
    if (transition.sha256 !== sha256Preview(transition.content)) {
      throw new Error('preview hash mismatch');
    }
    if (!['active_card_with_doc', 'processing'].includes(surface.status)) {
      throw new Error(
        'review surface cannot be previewed from its current status',
      );
    }
    if (
      surface.previewSha256 !== null &&
      surface.previewSha256 !== transition.sha256
    ) {
      throw new Error('review preview is immutable');
    }
    return {
      ...surface,
      previewContent: transition.content,
      previewSha256: transition.sha256,
      status: 'processing',
      updatedAt: now,
    };
  }

  assertBounded('resolvingIngressId', transition.ingressId, 512);
  if (surface.status === 'resolved') {
    if (surface.resolvingIngressId === transition.ingressId) return surface;
    throw new Error('review surface is already resolved');
  }
  if (
    ![
      'active_card',
      'active_card_with_doc',
      'command_only',
      'processing',
    ].includes(surface.status)
  ) {
    throw new Error(
      'review surface cannot be resolved from its current status',
    );
  }
  return {
    ...surface,
    status: 'resolved',
    resolvingIngressId: transition.ingressId,
    updatedAt: now,
  };
}

export function assertPreviewContent(content: string): void {
  if (
    content.length === 0 ||
    Buffer.byteLength(content, 'utf8') > MAX_REVIEW_PREVIEW_BYTES
  ) {
    throw new Error(
      'preview content must be non-empty and at most 4096 UTF-8 bytes',
    );
  }
}

function assertBounded(name: string, value: string, maxBytes: number): void {
  if (value.length === 0 || Buffer.byteLength(value, 'utf8') > maxBytes) {
    throw new Error(`${name} is empty or too large`);
  }
}
