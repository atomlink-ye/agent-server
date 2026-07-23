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
  listVersionsForOwner(
    owner: ManagedAgentOwner,
    definitionId: string,
  ): Promise<ManagedAgentVersionPage>;
}

export interface ManagedAgentVersionPage {
  readonly items: readonly ManagedAgentVersion[];
  readonly nextCursor: string | null;
}

export interface ImportAgentAtomicCommand {
  readonly owner: ManagedAgentOwner;
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
