import type { AgentDefinition } from '../../domain/agents/managed-agent-definition.js';
import type { ManagedAgentOwner } from '../../domain/agents/managed-agent-owner.js';
import type { ManagedAgentVersion } from '../../domain/agents/managed-agent-version.js';

export interface AgentRegistry {
  /** The repository atomically converges idempotency, definition, and version creation. */
  importAgent(
    command: ImportAgentAtomicCommand,
  ): Promise<ImportAgentAtomicResult>;
  /** The repository atomically converges idempotency and publication. */
  publishAgentVersion(
    command: PublishAgentAtomicCommand,
  ): Promise<ManagedAgentVersion>;
  findDefinition(
    owner: ManagedAgentOwner,
    definitionId: string,
  ): Promise<AgentDefinition | null>;
  findVersion(
    owner: ManagedAgentOwner,
    versionId: string,
  ): Promise<ManagedAgentVersion | null>;
  /**
   * Returns an owner-hidden, repository-ordered page. The repository returns
   * ascending lexicographic (createdAt, id) order. A cursor is opaque to the
   * application and encodes the last emitted (createdAt, id); the next page
   * uses a strict greater-than comparison, with id breaking equal timestamps.
   * This guarantees no skips or duplicates. nextCursor is null only when the
   * result is exhausted. Adapter encoding and comparison live in the adapter.
   */
  listVersionsForOwner(
    owner: ManagedAgentOwner,
    command: ListAgentVersionsCommand,
  ): Promise<ManagedAgentVersionPage | null>;
}

export interface ListAgentVersionsCommand {
  readonly definitionId: string;
  readonly cursor: string | null;
  readonly limit: number;
}

export interface ManagedAgentVersionPage {
  readonly items: readonly ManagedAgentVersion[];
  readonly nextCursor: string | null;
}

export interface ImportAgentAtomicCommand {
  readonly owner: ManagedAgentOwner;
  readonly compatibilityWorkspaceId: string;
  readonly idempotencyKey: string;
  readonly requestFingerprint: string;
  readonly normalizedName: string;
  readonly definition: AgentDefinition;
  readonly version: ManagedAgentVersion;
}
export type ImportAgentAtomicResult = {
  readonly kind: 'created' | 'converged' | 'replayed';
  readonly definition: AgentDefinition;
  readonly version: ManagedAgentVersion;
};
export interface PublishAgentAtomicCommand {
  readonly owner: ManagedAgentOwner;
  readonly idempotencyKey: string;
  readonly requestFingerprint: string;
  readonly versionId: string;
}
