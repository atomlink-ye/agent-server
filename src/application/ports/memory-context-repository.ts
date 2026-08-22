import type {
  MemoryProvenance,
  MemorySource,
} from '../../domain/context/memory-context.js';
import type { ContextScope } from '../../domain/context/context-fs.js';

export interface MemoryContextRecordRef {
  readonly memoryId: string;
  readonly tenantId: string;
  readonly scope: ContextScope;
  readonly logicalPath: string;
  readonly source: MemorySource;
  readonly pinned: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MemoryContextRepository {
  upsert(input: {
    readonly memoryId: string;
    readonly scope: ContextScope;
    readonly logicalPath: string;
    readonly source: MemorySource;
    readonly pinned: boolean;
    readonly now: string;
  }): Promise<MemoryContextRecordRef>;

  find(memoryId: string, tenantId: string): Promise<MemoryContextRecordRef | null>;
  listByTenant(tenantId: string): Promise<readonly MemoryContextRecordRef[]>;
}

export interface ContextTransitionRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly kind:
    | 'conversation_to_agent_user'
    | 'conversation_to_work'
    | 'work_result_publish'
    | 'memory_pin_to_agent';
  readonly sourceScope: ContextScope;
  readonly sourcePath: string;
  readonly targetScope: ContextScope;
  readonly targetPath: string;
  readonly sourceSha256: string;
  readonly createdAt: string;
}

export interface ContextTransitionRepository {
  record(input: Omit<ContextTransitionRecord, 'id'>): Promise<ContextTransitionRecord>;
}

export function memoryProvenanceFromRef(ref: MemoryContextRecordRef): MemoryProvenance {
  return Object.freeze({
    tenantId: ref.tenantId,
    scope: ref.scope,
    source: ref.source,
    pinned: ref.pinned,
    createdAt: ref.createdAt,
  });
}
