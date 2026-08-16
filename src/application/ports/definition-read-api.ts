import type { AgentVersion } from '../../domain/invokables/agent-version.js';
import type { InvokableOwnerScope } from '../../domain/invokables/invokable.js';
import type { TeamDefinition } from '../../domain/invokables/team-definition.js';
import type { TeamVersion } from '../../domain/invokables/team-version.js';
import type { WorkDefinitionResolutionPort } from './work-definition-resolution.js';

/** Read-only definition seam shared by admission, execution, and Work. */
export interface DefinitionReadApi {
  findPublishedAgentVersionById(
    id: string,
    ownerScope: InvokableOwnerScope,
  ): Promise<AgentVersion | null>;
  findTeamDefinitionById(id: string): Promise<TeamDefinition | null>;
  findPublishedTeamVersionById(
    id: string,
    ownerScope: InvokableOwnerScope,
  ): Promise<TeamVersion | null>;
  /** Optional composition extension; legacy callers can ignore it. */
  readonly workDefinitionResolution?: WorkDefinitionResolutionPort;
}
