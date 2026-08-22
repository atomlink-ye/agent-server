import { randomUUID } from 'node:crypto';
import type {
  LogicalFileEntry,
  LogicalFileStore,
} from '../ports/logical-file-store.js';
import type { ContextTransitionRepository } from '../ports/memory-context-repository.js';
import {
  agentContextScope,
  agentUserContextScope,
  conversationContextScope,
  workContextScope,
  type ContextScope,
} from '../../domain/context/context-fs.js';
import type { PrincipalRef } from '../../domain/tenancy/product-context.js';
import { ContextMemoryService } from './context-memory-service.js';

export class ContextPromotionService {
  public constructor(
    private readonly files: LogicalFileStore,
    private readonly transitions: ContextTransitionRepository,
    private readonly memory?: ContextMemoryService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async promoteConversationToAgentUser(input: {
    readonly tenantId: string;
    readonly agentDefinitionId: string;
    readonly actor: PrincipalRef;
    readonly conversationId: string;
    readonly sourcePath: string;
    readonly targetPath: string;
  }): Promise<LogicalFileEntry> {
    const sourceScope = conversationContextScope(input);
    const targetScope = agentUserContextScope({
      tenantId: input.tenantId,
      agentDefinitionId: input.agentDefinitionId,
      principal: input.actor,
    });
    const copied = await this.copy({
      kind: 'conversation_to_agent_user',
      tenantId: input.tenantId,
      sourceScope,
      sourcePath: input.sourcePath,
      targetScope,
      targetPath: input.targetPath,
    });
    if (this.memory) {
      await this.memory.write({
        memoryId: `promotion:${copied.id}`,
        scope: targetScope,
        path: input.targetPath,
        content: copied.content,
        source: {
          kind: 'conversation_promotion',
          sourceId: input.conversationId,
        },
        now: this.now().toISOString(),
      });
    }
    return copied;
  }

  public admitConversationToWork(input: {
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly conversationId: string;
    readonly workId: string;
    readonly sourcePath: string;
    readonly targetPath: string;
  }): Promise<LogicalFileEntry> {
    return this.copy({
      kind: 'conversation_to_work',
      tenantId: input.tenantId,
      sourceScope: conversationContextScope(input),
      sourcePath: input.sourcePath,
      targetScope: workContextScope(input),
      targetPath: `input/${stripPrefix(input.targetPath, 'input/')}`,
    });
  }

  public publishWorkResult(input: {
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly workId: string;
    readonly sourcePath: string;
    readonly targetPath: string;
  }): Promise<LogicalFileEntry> {
    const scope = workContextScope(input);
    return this.copy({
      kind: 'work_result_publish',
      tenantId: input.tenantId,
      sourceScope: scope,
      sourcePath: input.sourcePath,
      targetScope: scope,
      targetPath: `artifacts/${stripPrefix(input.targetPath, 'artifacts/')}`,
    });
  }

  public async pinMemoryToAgent(input: {
    readonly tenantId: string;
    readonly agentDefinitionId: string;
    readonly sourceScope: ContextScope;
    readonly sourcePath: string;
    readonly targetPath: string;
  }): Promise<LogicalFileEntry> {
    const targetScope = agentContextScope({
      tenantId: input.tenantId,
      agentDefinitionId: input.agentDefinitionId,
    });
    const copied = await this.copy({
      kind: 'memory_pin_to_agent',
      tenantId: input.tenantId,
      sourceScope: input.sourceScope,
      sourcePath: input.sourcePath,
      targetScope,
      targetPath: `memory/pinned/${stripPrefix(input.targetPath, 'memory/pinned/')}`,
    });
    if (this.memory) {
      await this.memory.write({
        memoryId: `pin:${copied.id}`,
        scope: targetScope,
        path: input.targetPath,
        content: copied.content,
        source: { kind: 'manual_pin', sourceId: copied.id },
        pinned: true,
        now: this.now().toISOString(),
      });
    }
    return copied;
  }

  private async copy(input: {
    readonly kind:
      | 'conversation_to_agent_user'
      | 'conversation_to_work'
      | 'work_result_publish'
      | 'memory_pin_to_agent';
    readonly tenantId: string;
    readonly sourceScope: ContextScope;
    readonly sourcePath: string;
    readonly targetScope: ContextScope;
    readonly targetPath: string;
  }): Promise<LogicalFileEntry> {
    if (
      input.sourceScope.tenantId !== input.tenantId ||
      input.targetScope.tenantId !== input.tenantId
    )
      throw new Error('Context transition cannot cross tenants.');
    const source = await this.files.read(input.sourceScope, input.sourcePath);
    if (!source) throw new Error('Context transition source does not exist.');
    const target = await this.files.write({
      scope: input.targetScope,
      path: input.targetPath,
      content: source.content,
    });
    await this.transitions.record({
      tenantId: input.tenantId,
      kind: input.kind,
      sourceScope: input.sourceScope,
      sourcePath: input.sourcePath,
      targetScope: input.targetScope,
      targetPath: input.targetPath,
      sourceSha256: source.contentSha256,
      createdAt: this.now().toISOString(),
    });
    return target;
  }
}

function stripPrefix(value: string, prefix: string): string {
  const clean = value.replace(/^\/+/, '');
  return clean.startsWith(prefix) ? clean.slice(prefix.length) : clean;
}
