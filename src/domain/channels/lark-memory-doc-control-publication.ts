import type { ReviewSurfaceOwnerScope } from '../../application/ports/lark-review-surface-repository.js';

export const MEMORY_REVIEW_DOC_CONTROL_PATCH_TYPE =
  'lark_memory_doc_control_patch_v1';

export type MemoryReviewDocControlPatchDescriptor = {
  readonly type: typeof MEMORY_REVIEW_DOC_CONTROL_PATCH_TYPE;
  readonly surfaceId: string;
  readonly version: number;
  readonly proposalId: string;
  readonly bindingId: string;
  readonly owner: ReviewSurfaceOwnerScope;
  readonly category: string;
  readonly excerpt: string;
  readonly docToken: string;
  readonly docStatus: string;
  readonly previewed: boolean;
  readonly previewExcerpt?: string;
  readonly previewFingerprint?: string;
};

export function parseMemoryReviewDocControlPatchDescriptor(
  value: unknown,
): MemoryReviewDocControlPatchDescriptor {
  if (
    !record(value) ||
    value.type !== MEMORY_REVIEW_DOC_CONTROL_PATCH_TYPE ||
    !Number.isInteger(value.version) ||
    value.version < 1 ||
    Object.keys(value).some(
      (key) =>
        ![
          'type',
          'surfaceId',
          'version',
          'proposalId',
          'bindingId',
          'owner',
          'category',
          'excerpt',
          'docToken',
          'docStatus',
          'previewed',
          'previewExcerpt',
          'previewFingerprint',
        ].includes(key),
    )
  )
    throw new Error('invalid memory review Doc control patch');
  const owner = value.owner;
  if (!record(owner))
    throw new Error('invalid memory review Doc control patch');
  const bounded = (input: unknown, max = 512): string => {
    if (
      typeof input !== 'string' ||
      input.length === 0 ||
      Buffer.byteLength(input, 'utf8') > max
    )
      throw new Error('invalid memory review Doc control patch');
    return input;
  };
  const ownerKeys = ['tenantId', 'workspaceId', 'principalType', 'principalId'];
  if (Object.keys(owner).sort().join(',') !== ownerKeys.sort().join(','))
    throw new Error('invalid memory review Doc control patch');
  if (typeof value.previewed !== 'boolean')
    throw new Error('invalid memory review Doc control patch');
  if (
    value.previewed &&
    (typeof value.previewExcerpt !== 'string' ||
      typeof value.previewFingerprint !== 'string' ||
      !/^[a-f0-9]{64}$/.test(value.previewFingerprint))
  )
    throw new Error('invalid memory review Doc control patch');
  if (
    !value.previewed &&
    ('previewExcerpt' in value || 'previewFingerprint' in value)
  )
    throw new Error('invalid memory review Doc control patch');
  return {
    type: MEMORY_REVIEW_DOC_CONTROL_PATCH_TYPE,
    surfaceId: bounded(value.surfaceId),
    version: value.version,
    proposalId: bounded(value.proposalId),
    bindingId: bounded(value.bindingId),
    owner: {
      tenantId: bounded(owner.tenantId),
      workspaceId: bounded(owner.workspaceId),
      principalType: bounded(owner.principalType),
      principalId: bounded(owner.principalId),
    },
    category: bounded(value.category, 120),
    excerpt: bounded(value.excerpt, 1000),
    docToken: bounded(value.docToken),
    docStatus: bounded(value.docStatus, 80),
    previewed: value.previewed,
    ...(value.previewed
      ? {
          previewExcerpt: bounded(value.previewExcerpt, 4096),
          previewFingerprint: value.previewFingerprint,
        }
      : {}),
  };
}

function record(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
