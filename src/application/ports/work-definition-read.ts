import type { InvokableOwnerScope, InvokableRepository } from './invokable-repository.js';
import type { TeamDefinition } from '../../domain/invokables/team-definition.js';
import type { TeamVersion } from '../../domain/invokables/team-version.js';

/** The deliberately read-only seam used by the Work identity boundary. */
export interface WorkDefinitionReadPort {
  findTeamDefinitionById(id: string): Promise<TeamDefinition | null>;
  findPublishedTeamVersionById(
    id: string,
    ownerScope: InvokableOwnerScope,
  ): Promise<TeamVersion | null>;
}

/** Reuses the existing invokable registry without sharing its transactions. */
export class InvokableWorkDefinitionReadAdapter implements WorkDefinitionReadPort {
  public constructor(private readonly repository: InvokableRepository) {}

  public findTeamDefinitionById(id: string): Promise<TeamDefinition | null> {
    return this.repository.findTeamDefinitionById(id);
  }

  public findPublishedTeamVersionById(
    id: string,
    ownerScope: InvokableOwnerScope,
  ): Promise<TeamVersion | null> {
    return this.repository.findPublishedTeamVersionById(id, ownerScope);
  }
}
