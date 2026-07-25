export const MEMORY_REVIEW_CARD_DESCRIPTOR_TYPE = 'lark_memory_review_card_v1';
export const MEMORY_REVIEW_CARD_SOURCE =
  'Proposed by the completed agent task in this thread.';
export const MEMORY_REVIEW_DOC_CARD_DESCRIPTOR_TYPE = 'lark_memory_doc_card_v1';

export type MemoryReviewCardPublicationDescriptor = {
  readonly type: typeof MEMORY_REVIEW_CARD_DESCRIPTOR_TYPE;
  readonly surfaceId: string;
  readonly version: number;
  readonly proposalId: string;
  readonly bindingId: string;
  readonly owner: {
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly principalType: string;
    readonly principalId: string;
  };
  readonly category: string;
  readonly content: string;
  readonly source: string;
};

export type MemoryReviewDocCardPublicationDescriptor = Omit<
  MemoryReviewCardPublicationDescriptor,
  'type' | 'content'
> & {
  readonly type: typeof MEMORY_REVIEW_DOC_CARD_DESCRIPTOR_TYPE;
  readonly excerpt: string;
  readonly content: string;
  readonly docToken: string;
  readonly docRevision: string;
};

const DESCRIPTOR_KEYS =
  'bindingId,category,content,owner,proposalId,source,surfaceId,type,version';
const OWNER_KEYS = 'principalId,principalType,tenantId,workspaceId';

export function parseMemoryReviewCardPublicationDescriptor(
  value: unknown,
): MemoryReviewCardPublicationDescriptor {
  if (
    !isRecord(value) ||
    Object.keys(value).sort().join(',') !== DESCRIPTOR_KEYS
  )
    throw new Error('invalid memory review Card descriptor');
  if (
    value.type !== MEMORY_REVIEW_CARD_DESCRIPTOR_TYPE ||
    !Number.isInteger(value.version) ||
    value.version < 1
  )
    throw new Error('invalid memory review Card descriptor');
  const surfaceId = boundedIdentifier(value.surfaceId);
  const proposalId = boundedIdentifier(value.proposalId);
  const bindingId = boundedIdentifier(value.bindingId);
  if (
    !isRecord(value.owner) ||
    Object.keys(value.owner).sort().join(',') !== OWNER_KEYS
  )
    throw new Error('invalid memory review Card descriptor');
  const owner = {
    tenantId: boundedIdentifier(value.owner.tenantId),
    workspaceId: boundedIdentifier(value.owner.workspaceId),
    principalType: boundedIdentifier(value.owner.principalType),
    principalId: boundedIdentifier(value.owner.principalId),
  };
  const category = boundedText(value.category, 120, false);
  const content = boundedText(value.content, 1500, true);
  const source = boundedText(value.source, 256, false);
  return {
    type: MEMORY_REVIEW_CARD_DESCRIPTOR_TYPE,
    surfaceId,
    version: value.version,
    proposalId,
    bindingId,
    owner,
    category,
    content,
    source,
  };
}

export function parseMemoryReviewDocCardPublicationDescriptor(
  value: unknown,
): MemoryReviewDocCardPublicationDescriptor {
  if (!isRecord(value) || value.type !== MEMORY_REVIEW_DOC_CARD_DESCRIPTOR_TYPE)
    throw new Error('invalid memory review Doc descriptor');
  const base = value as Record<string, unknown>;
  const owner = base.owner;
  if (!isRecord(owner)) throw new Error('invalid memory review Doc descriptor');
  const bounded = (v: unknown, max = 512) => {
    if (
      typeof v !== 'string' ||
      v.length === 0 ||
      Buffer.byteLength(v, 'utf8') > max
    )
      throw new Error('invalid memory review Doc descriptor');
    return v;
  };
  if (!Number.isInteger(base.version) || (base.version as number) < 1)
    throw new Error('invalid memory review Doc descriptor');
  return {
    type: MEMORY_REVIEW_DOC_CARD_DESCRIPTOR_TYPE,
    surfaceId: bounded(base.surfaceId),
    version: base.version as number,
    proposalId: bounded(base.proposalId),
    bindingId: bounded(base.bindingId),
    owner: {
      tenantId: bounded(owner.tenantId),
      workspaceId: bounded(owner.workspaceId),
      principalType: bounded(owner.principalType),
      principalId: bounded(owner.principalId),
    },
    category: bounded(base.category, 120),
    content: bounded(base.content, 4096),
    excerpt: bounded(base.excerpt, 1000),
    docToken: bounded(base.docToken),
    docRevision: bounded(base.docRevision),
    source: bounded(base.source, 256),
  };
}

function boundedIdentifier(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    Buffer.byteLength(value, 'utf8') > 512 ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw new Error('invalid memory review Card descriptor');
  return value;
}

function boundedText(
  value: unknown,
  maxChars: number,
  content: boolean,
): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maxChars ||
    Buffer.byteLength(value, 'utf8') > 4096 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) ||
    (content && value.split(/\r?\n/).length > 20)
  )
    throw new Error('invalid memory review Card descriptor');
  return value;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
