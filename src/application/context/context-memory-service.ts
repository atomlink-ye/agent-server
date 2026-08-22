import type { LogicalFileStore } from '../ports/logical-file-store.js';
import type {
  MemoryContextRepository,
  MemoryContextRecordRef,
} from '../ports/memory-context-repository.js';
import {
  assertCanonicalMemoryScope,
  canonicalMemoryPath,
  isMemoryVisible,
  type MemoryRecord,
  type MemorySource,
  type MemoryVisibilityContext,
} from '../../domain/context/memory-context.js';
import type { ContextScope } from '../../domain/context/context-fs.js';

/** Canonical Memory facade: scope policy + provenance + ContextFS content. */
export class ContextMemoryService {
  public constructor(
    private readonly records: MemoryContextRepository,
    private readonly files: LogicalFileStore,
  ) {}

  public async write(input: {
    readonly memoryId: string;
    readonly scope: ContextScope;
    readonly path: string;
    readonly content: string;
    readonly source: MemorySource;
    readonly pinned?: boolean;
    readonly now?: string;
  }): Promise<MemoryRecord> {
    assertCanonicalMemoryScope(input.scope);
    const logicalPath = canonicalMemoryPath(input.memoryId, input.path);
    const file = await this.files.write({
      scope: input.scope,
      path: logicalPath,
      content: input.content,
    });
    const ref = await this.records.upsert({
      memoryId: input.memoryId,
      scope: input.scope,
      logicalPath,
      source: input.source,
      pinned: input.pinned ?? false,
      now: input.now ?? new Date().toISOString(),
    });
    return toRecord(ref, file.content, file.contentSha256, file.updatedAt);
  }

  public async getVisible(
    memoryId: string,
    context: MemoryVisibilityContext,
  ): Promise<MemoryRecord | null> {
    const ref = await this.records.find(memoryId, context.tenantId);
    if (!ref) return null;
    const recordProvenance = provenance(ref);
    if (!isMemoryVisible(recordProvenance, context)) return null;
    const file = await this.files.read(ref.scope, ref.logicalPath);
    return file
      ? toRecord(ref, file.content, file.contentSha256, file.updatedAt)
      : null;
  }

  public async listVisible(
    context: MemoryVisibilityContext,
  ): Promise<readonly MemoryRecord[]> {
    const refs = await this.records.listByTenant(context.tenantId);
    const visible = refs.filter((ref) =>
      isMemoryVisible(provenance(ref), context),
    );
    const records = await Promise.all(
      visible.map(async (ref) => {
        const file = await this.files.read(ref.scope, ref.logicalPath);
        return file
          ? toRecord(ref, file.content, file.contentSha256, file.updatedAt)
          : null;
      }),
    );
    return Object.freeze(
      records.filter((record): record is MemoryRecord => record !== null),
    );
  }
}

function provenance(ref: MemoryContextRecordRef) {
  return Object.freeze({
    tenantId: ref.tenantId,
    scope: ref.scope,
    source: ref.source,
    pinned: ref.pinned,
    createdAt: ref.createdAt,
  });
}

function toRecord(
  ref: MemoryContextRecordRef,
  content: string,
  contentSha256: string,
  updatedAt: string,
): MemoryRecord {
  return Object.freeze({
    id: ref.memoryId,
    path: ref.logicalPath,
    content,
    contentSha256,
    provenance: provenance(ref),
    updatedAt,
  });
}
