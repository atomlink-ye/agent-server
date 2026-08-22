import type { InvokableOwnerScope } from '../../domain/invokables/invokable.js';
import type { TeamDefinition } from '../../domain/invokables/team-definition.js';
import type { TeamVersion } from '../../domain/invokables/team-version.js';

/**
 * Read-only compatibility seam for Team invokables.
 * Agent reads resolve through AgentRegistry / AgentResolutionApi.
 */
export interface DefinitionReadApi {
  findTeamDefinitionById(id: string): Promise<TeamDefinition | null>;
  findPublishedTeamVersionById(
    id: string,
    ownerScope: InvokableOwnerScope,
  ): Promise<TeamVersion | null>;
}
