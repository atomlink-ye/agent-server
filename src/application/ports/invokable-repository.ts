import type { InvokableOwnerScope } from '../../domain/invokables/invokable.js';
import type { TeamDefinition } from '../../domain/invokables/team-definition.js';
import type { TeamVersion } from '../../domain/invokables/team-version.js';

export type { InvokableOwnerScope };

/**
 * Compatibility repository for Team invokables only.
 *
 * AgentDefinition / ManagedAgentVersion are owned by AgentRegistry and
 * AgentResolutionApi. Do not add Agent persistence back to this seam.
 */
export interface InvokableRepository {
  saveTeamDefinition(definition: TeamDefinition): Promise<void>;
  findTeamDefinitionById(id: string): Promise<TeamDefinition | null>;
  listTeamVersionsByDefinitionId?(
    id: string,
    ownerScope: InvokableOwnerScope,
    limit: number,
    cursor?: string | null,
  ): Promise<{ items: TeamVersion[]; nextCursor: string | null }>;
  saveTeamVersion(version: TeamVersion): Promise<void>;
  findTeamVersionById(id: string): Promise<TeamVersion | null>;
  findPublishedTeamVersionById(
    id: string,
    ownerScope: InvokableOwnerScope,
  ): Promise<TeamVersion | null>;
  findTeamRegistryIdempotency?(input: {
    operation: 'import' | 'publish';
    idempotencyKey: string;
    requestFingerprint: string;
    ownerScope: InvokableOwnerScope;
  }): Promise<{ definitionId: string | null; versionId: string | null }>;
  recordTeamRegistryIdempotency?(input: {
    operation: 'import' | 'publish';
    idempotencyKey: string;
    requestFingerprint: string;
    definitionId?: string | null;
    versionId?: string | null;
    ownerScope: InvokableOwnerScope;
  }): Promise<{ definitionId: string | null; versionId: string | null }>;
  importTeamVersionAtomically?(input: {
    definition: TeamDefinition;
    version: TeamVersion;
    idempotencyKey: string;
    requestFingerprint: string;
  }): Promise<{
    kind: 'created' | 'replayed';
    definition: TeamDefinition;
    version: TeamVersion;
  }>;
  publishTeamVersionAtomically?(input: {
    version: TeamVersion;
    idempotencyKey: string;
    requestFingerprint: string;
  }): Promise<TeamVersion>;
}

export class InvokableVersionImmutableError extends Error {
  public constructor() {
    super('Published invokable versions are immutable.');
    this.name = 'InvokableVersionImmutableError';
  }
}
