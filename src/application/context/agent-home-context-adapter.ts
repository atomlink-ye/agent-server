import type {
  AgentHomeEntryRow,
  AgentHomeRepository,
  AgentHomeScope,
  ListAgentHomeEntriesInput,
  ReadAgentHomeEntryInput,
  WriteAgentHomeEntryInput,
} from '../ports/agent-home-repository.js';
import type {
  LogicalFileEntry,
  LogicalFileStore,
} from '../ports/logical-file-store.js';
import {
  agentHomeContextScope,
  agentContextScope,
  agentUserContextScope,
  conversationContextScope,
  runtimeScratchContextScope,
  workContextScope,
  type ContextScope,
} from '../../domain/context/context-fs.js';
import { principalRef } from '../../domain/tenancy/product-context.js';

/**
 * Compatibility bridge: the public Agent Home contract remains stable while
 * canonical ownership moves to ContextFS. New writes go only to ContextFS;
 * legacy rows remain readable until a later data migration removes them.
 */
export class AgentHomeContextAdapter implements AgentHomeRepository {
  public constructor(
    private readonly files: LogicalFileStore,
    private readonly legacy?: AgentHomeRepository,
  ) {}

  public async list(
    input: ListAgentHomeEntriesInput,
  ): Promise<readonly AgentHomeEntryRow[] | null> {
    const canonical = await this.files.list(toContextScope(input.scope));
    const legacy = this.legacy ? await this.legacy.list(input) : null;
    const byPath = new Map<string, AgentHomeEntryRow>();
    for (const entry of legacy ?? []) byPath.set(entry.path, entry);
    for (const entry of canonical)
      byPath.set(entry.path, toAgentHomeEntry(entry));
    return [...byPath.values()].sort((left, right) =>
      left.path.localeCompare(right.path),
    );
  }

  public async read(
    input: ReadAgentHomeEntryInput,
  ): Promise<AgentHomeEntryRow | null> {
    const canonical = await this.files.read(
      toContextScope(input.scope),
      input.path,
    );
    if (canonical) return toAgentHomeEntry(canonical);
    return this.legacy ? this.legacy.read(input) : null;
  }

  public async write(
    input: WriteAgentHomeEntryInput,
  ): Promise<AgentHomeEntryRow | null> {
    const written = await this.files.write({
      scope: toContextScope(input.scope),
      path: input.path,
      content: input.content,
    });
    return toAgentHomeEntry(written);
  }
}

export function toContextScope(scope: AgentHomeScope): ContextScope {
  switch (scope.namespace) {
    case 'organization':
      return agentHomeContextScope({
        tenantId: scope.tenantId,
        agentDefinitionId: scope.agentDefinitionId,
        namespace: 'organization',
        scopeKey: '',
      });
    case 'space':
      return agentHomeContextScope({
        tenantId: scope.tenantId,
        agentDefinitionId: scope.agentDefinitionId,
        namespace: 'space',
        scopeKey: scope.scopeKey,
      });
    case 'agent-shared':
      return agentContextScope({
        tenantId: scope.tenantId,
        agentDefinitionId: scope.agentDefinitionId,
      });
    case 'user':
      return agentUserContextScope({
        tenantId: scope.tenantId,
        agentDefinitionId: scope.agentDefinitionId,
        principal: principalRef({
          principalType: scope.principalType ?? 'service_account',
          principalId: scope.scopeKey,
        }),
      });
    case 'conversation':
      return conversationContextScope({
        tenantId: scope.tenantId,
        conversationId: scope.scopeKey,
      });
    case 'work': {
      const workspaceId = scope.workspaceId;
      if (!workspaceId)
        throw new Error('Work ContextFS projection requires workspaceId.');
      return workContextScope({
        tenantId: scope.tenantId,
        workspaceId,
        workId: scope.scopeKey,
      });
    }
    case 'scratch':
      return runtimeScratchContextScope({
        tenantId: scope.tenantId,
        runtimeSessionId: scope.scopeKey,
      });
    case 'definition':
      throw new Error(
        'Definition Agent Home entries are computed, not stored.',
      );
  }
}

function toAgentHomeEntry(entry: LogicalFileEntry): AgentHomeEntryRow {
  return {
    id: entry.id,
    path: entry.path,
    currentVersion: entry.currentVersion,
    content: entry.content,
    contentSha256: entry.contentSha256,
    contentSizeBytes: entry.contentSizeBytes,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}
