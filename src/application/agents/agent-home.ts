import { randomUUID } from 'node:crypto';
import type { AccessContext } from '../../platform/access-context.js';
import type {
  AgentHomeRepository,
  AgentHomeEntryRow,
} from '../ports/agent-home-repository.js';
import type { AgentHomeDefinitionSource } from '../ports/agent-home-definition-source.js';
import {
  AgentHomeNamespaceReadOnlyError,
  AgentHomeScopeRequiredError,
  InvalidAgentHomeContentError,
  InvalidAgentHomePathError,
  contentSizeBytes,
  normalizeAgentHomePath,
  resolveAgentHomeScopeKey,
  sha256,
  validateAgentHomeContent,
  type AgentHomeNamespace,
  type AgentHomeScopeParams,
} from '../../domain/agents/agent-home.js';

function now(): string {
  return new Date().toISOString();
}

export class ListAgentHomeEntries {
  public constructor(
    private readonly repository: AgentHomeRepository,
    private readonly definitionSource: AgentHomeDefinitionSource,
  ) {}

  public async execute(input: {
    accessContext: AccessContext;
    agentDefinitionId: string;
    namespace: AgentHomeNamespace;
    scopeParams: AgentHomeScopeParams;
  }): Promise<readonly AgentHomeEntryRow[] | null> {
    if (input.namespace === 'definition') {
      // For definition namespace, delegate to definition source and return synthetic entries
      const entries = await this.definitionSource.readDefinition(
        input.accessContext.tenantId,
        input.agentDefinitionId,
      );

      if (!entries) return null;

      return entries.map((entry) => ({
        id: randomUUID(),
        path: entry.path,
        currentVersion: 1,
        content: entry.content,
        contentSha256: sha256(entry.content),
        contentSizeBytes: contentSizeBytes(entry.content),
        createdAt: now(),
        updatedAt: now(),
      }));
    }

    const scopeKey = resolveAgentHomeScopeKey(
      input.namespace,
      input.accessContext,
      input.scopeParams,
    );

    return this.repository.list({
      scope: {
        tenantId: input.accessContext.tenantId,
        agentDefinitionId: input.agentDefinitionId,
        namespace: input.namespace,
        scopeKey,
      },
    });
  }
}

export class ReadAgentHomeEntry {
  public constructor(
    private readonly repository: AgentHomeRepository,
    private readonly definitionSource: AgentHomeDefinitionSource,
  ) {}

  public async execute(input: {
    accessContext: AccessContext;
    agentDefinitionId: string;
    namespace: AgentHomeNamespace;
    scopeParams: AgentHomeScopeParams;
    path: string;
  }): Promise<AgentHomeEntryRow | null> {
    const normalizedPath = normalizeAgentHomePath(input.path);

    if (input.namespace === 'definition') {
      // For definition namespace, delegate to definition source and return synthetic entry
      const entries = await this.definitionSource.readDefinition(
        input.accessContext.tenantId,
        input.agentDefinitionId,
      );

      if (!entries) return null;

      const entry = entries.find((e) => e.path === normalizedPath);
      if (!entry) return null;

      return {
        id: randomUUID(),
        path: entry.path,
        currentVersion: 1,
        content: entry.content,
        contentSha256: sha256(entry.content),
        contentSizeBytes: contentSizeBytes(entry.content),
        createdAt: now(),
        updatedAt: now(),
      };
    }

    const scopeKey = resolveAgentHomeScopeKey(
      input.namespace,
      input.accessContext,
      input.scopeParams,
    );

    return this.repository.read({
      scope: {
        tenantId: input.accessContext.tenantId,
        agentDefinitionId: input.agentDefinitionId,
        namespace: input.namespace,
        scopeKey,
      },
      path: normalizedPath,
    });
  }
}

export class WriteAgentHomeEntry {
  public constructor(
    private readonly repository: AgentHomeRepository,
  ) {}

  public async execute(input: {
    accessContext: AccessContext;
    agentDefinitionId: string;
    namespace: AgentHomeNamespace;
    scopeParams: AgentHomeScopeParams;
    path: string;
    content: string;
  }): Promise<AgentHomeEntryRow | null> {
    // Check if write to read-only namespace
    if (input.namespace === 'definition') {
      throw new AgentHomeNamespaceReadOnlyError();
    }

    const normalizedPath = normalizeAgentHomePath(input.path);
    const validatedContent = validateAgentHomeContent(input.content);
    const scopeKey = resolveAgentHomeScopeKey(
      input.namespace,
      input.accessContext,
      input.scopeParams,
      true, // isWrite
    );

    return this.repository.write({
      scope: {
        tenantId: input.accessContext.tenantId,
        agentDefinitionId: input.agentDefinitionId,
        namespace: input.namespace,
        scopeKey,
      },
      path: normalizedPath,
      content: validatedContent,
      contentSha256: sha256(validatedContent),
      contentSizeBytes: contentSizeBytes(validatedContent),
    });
  }
}

export {
  AgentHomeNamespaceReadOnlyError,
  AgentHomeScopeRequiredError,
  InvalidAgentHomeContentError,
  InvalidAgentHomePathError,
};
