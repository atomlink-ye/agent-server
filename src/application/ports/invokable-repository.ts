import type { AgentDefinition } from '../../domain/invokables/agent-definition.js';
import type { AgentVersion } from '../../domain/invokables/agent-version.js';
import type { CompiledTeamPlan } from '../../domain/invokables/compiled-team-plan.js';
import type { InvokableOwnerScope } from '../../domain/invokables/invokable.js';
import type { TeamDefinition } from '../../domain/invokables/team-definition.js';
import type { TeamVersion } from '../../domain/invokables/team-version.js';

export type { InvokableOwnerScope };

export interface InvokableRepository {
  saveAgentDefinition(definition: AgentDefinition): Promise<void>;
  findAgentDefinitionById(id: string): Promise<AgentDefinition | null>;
  saveAgentVersion(version: AgentVersion): Promise<void>;
  findAgentVersionById(id: string): Promise<AgentVersion | null>;
  findPublishedAgentVersionById(
    id: string,
    ownerScope: InvokableOwnerScope,
  ): Promise<AgentVersion | null>;
  saveTeamDefinition(definition: TeamDefinition): Promise<void>;
  findTeamDefinitionById(id: string): Promise<TeamDefinition | null>;
  saveTeamVersion(version: TeamVersion): Promise<void>;
  findTeamVersionById(id: string): Promise<TeamVersion | null>;
  findPublishedTeamVersionById(
    id: string,
    ownerScope: InvokableOwnerScope,
  ): Promise<TeamVersion | null>;
  saveCompiledTeamPlan(plan: CompiledTeamPlan): Promise<void>;
  findCompiledTeamPlanByVersionId(
    teamVersionId: string,
  ): Promise<CompiledTeamPlan | null>;
}

export class InvokableVersionImmutableError extends Error {
  public constructor() {
    super('Published invokable versions are immutable.');
    this.name = 'InvokableVersionImmutableError';
  }
}
