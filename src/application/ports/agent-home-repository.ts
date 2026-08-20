import type { AgentHomeNamespace } from '../../domain/agents/agent-home.js';

export interface AgentHomeScope {
  readonly tenantId: string;
  readonly agentDefinitionId: string;
  readonly namespace: AgentHomeNamespace;
  readonly scopeKey: string;
}

export interface AgentHomeEntryRow {
  readonly id: string;
  readonly path: string;
  readonly currentVersion: number;
  readonly content: string;
  readonly contentSha256: string;
  readonly contentSizeBytes: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ListAgentHomeEntriesInput {
  readonly scope: AgentHomeScope;
}

export interface ReadAgentHomeEntryInput {
  readonly scope: AgentHomeScope;
  readonly path: string;
}

export interface WriteAgentHomeEntryInput {
  readonly scope: AgentHomeScope;
  readonly path: string;
  readonly content: string;
  readonly contentSha256: string;
  readonly contentSizeBytes: number;
}

export interface AgentHomeRepository {
  list(input: ListAgentHomeEntriesInput): Promise<readonly AgentHomeEntryRow[] | null>;
  read(input: ReadAgentHomeEntryInput): Promise<AgentHomeEntryRow | null>;
  write(input: WriteAgentHomeEntryInput): Promise<AgentHomeEntryRow | null>;
}
