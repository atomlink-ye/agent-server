import type { ContextScope } from './context-fs.js';
import type { PrincipalRef } from '../tenancy/product-context.js';

export type MemorySourceKind =
  | 'memory_api'
  | 'learning_proposal'
  | 'conversation_promotion'
  | 'work_admission'
  | 'work_result'
  | 'manual_pin'
  | 'legacy';

export interface MemorySource {
  readonly kind: MemorySourceKind;
  readonly sourceId?: string | null;
}

export interface MemoryProvenance {
  readonly tenantId: string;
  /** Null exists only for historical compatibility rows whose scope is unknown. */
  readonly scope: ContextScope | null;
  readonly source: MemorySource;
  readonly pinned: boolean;
  readonly createdAt: string;
}

export interface MemoryRecord {
  readonly id: string;
  readonly path: string;
  readonly content: string;
  readonly contentSha256: string;
  readonly provenance: MemoryProvenance;
  readonly updatedAt: string;
}

export interface MemoryVisibilityContext {
  readonly tenantId: string;
  readonly workspaceId?: string;
  readonly agentDefinitionId?: string;
  readonly actor?: PrincipalRef;
  readonly conversationId?: string;
  readonly workId?: string;
}

/**
 * One pure visibility policy shared by Chat, Worker and product projections.
 * It never infers a scope from partial provenance.
 */
export function isMemoryVisible(
  provenance: MemoryProvenance,
  context: MemoryVisibilityContext,
): boolean {
  if (provenance.tenantId !== context.tenantId) return false;
  const scope = provenance.scope;
  if (scope === null) return provenance.source.kind === 'legacy';

  switch (scope.kind) {
    case 'organization':
      return true;
    case 'workspace':
      return Boolean(
        context.workspaceId && context.workspaceId === scope.workspaceId,
      );
    case 'agent':
      return Boolean(
        context.agentDefinitionId &&
        context.agentDefinitionId === scope.agentDefinitionId,
      );
    case 'agent_user':
      return Boolean(
        context.agentDefinitionId === scope.agentDefinitionId &&
        context.actor &&
        context.actor.type === scope.principal.type &&
        context.actor.id === scope.principal.id,
      );
    case 'conversation':
      return Boolean(
        context.conversationId &&
        context.conversationId === scope.conversationId,
      );
    case 'work':
      return Boolean(
        context.workspaceId === scope.workspaceId &&
        context.workId === scope.workId,
      );
    case 'agent_home':
    case 'runtime_scratch':
      return false;
  }
}

export function assertCanonicalMemoryScope(scope: ContextScope): void {
  if (scope.kind === 'agent_home' || scope.kind === 'runtime_scratch') {
    throw new Error(
      `Context scope ${scope.kind} is not a canonical Memory scope.`,
    );
  }
}

export function canonicalMemoryPath(memoryId: string, path: string): string {
  const cleanId = memoryId.trim();
  const cleanPath = path.replace(/^\/+/, '').trim();
  if (!cleanId || !cleanPath)
    throw new Error('Canonical Memory requires id and path.');
  return `memory/${encodeURIComponent(cleanId)}/${cleanPath}`;
}
