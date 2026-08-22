import type { RuntimeInvocationContext } from '../../domain/runtime/runtime-invocation-context.js';
import type { MemoryRecord } from '../../domain/context/memory-context.js';
import { ContextMemoryService } from './context-memory-service.js';

/** One production resolver used by both Chat brain assembly and Worker runtime. */
export class ScopedMemoryResolver {
  public constructor(private readonly memory: ContextMemoryService) {}

  public resolve(
    context: RuntimeInvocationContext,
  ): Promise<readonly MemoryRecord[]> {
    return this.memory.listVisible({
      tenantId: context.productScope.tenantId,
      workspaceId: context.productScope.workspaceId,
      agentDefinitionId: context.agentDefinitionId,
      actor: context.actor,
      ...(context.conversationId
        ? { conversationId: context.conversationId }
        : {}),
      ...(context.workId ? { workId: context.workId } : {}),
    });
  }
}

export function renderScopedMemory(records: readonly MemoryRecord[]): string {
  if (records.length === 0) return '[no canonical scoped memory]';
  return records
    .map((record) => {
      const scope = record.provenance.scope;
      const scopeLabel = scope ? scope.kind : 'legacy';
      return `[memory id=${record.id} scope=${scopeLabel} source=${record.provenance.source.kind}]\n${record.content}`;
    })
    .join('\n\n');
}
