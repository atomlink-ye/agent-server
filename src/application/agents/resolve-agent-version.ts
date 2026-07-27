import type { AgentRegistry } from '../ports/agent-registry.js';
import type {
  InvokableOwnerScope,
  InvokableRepository,
} from '../ports/invokable-repository.js';
import type { ManagedAgentOwner } from '../../domain/agents/managed-agent-owner.js';
import {
  loadBuiltInSkills,
  type ResolvedBuiltInSkill,
} from './built-in-skills.js';

export type AgentVersionResolutionScope = InvokableOwnerScope;
export type ResolvedAgentVersion = Readonly<{
  source: 'managed' | 'legacy';
  id: string;
  instructions: string;
  proposalLimit?: number;
  skills: readonly ResolvedBuiltInSkill[];
}>;

export class ResolveAgentVersion {
  public constructor(
    private readonly managed: Pick<AgentRegistry, 'findVersion'>,
    private readonly legacy: Pick<
      InvokableRepository,
      'findPublishedAgentVersionById'
    >,
  ) {}

  public async resolvePublished(
    versionId: string,
    scope: AgentVersionResolutionScope,
  ): Promise<ResolvedAgentVersion | null> {
    const managedVersion = await this.managed.findVersion(
      managedOwner(scope),
      versionId,
    );
    if (managedVersion) {
      if (managedVersion.status !== 'published') return null;
      return {
        source: 'managed',
        id: managedVersion.id,
        instructions: managedVersion.package.spec.instructions,
        proposalLimit: managedVersion.package.spec.memory?.proposalLimit ?? 0,
        skills: await loadBuiltInSkills(
          managedVersion.package.spec.skills.map((skill) => skill.ref),
        ),
      };
    }
    const legacyVersion = await this.legacy.findPublishedAgentVersionById(
      versionId,
      scope,
    );
    return legacyVersion
      ? {
          source: 'legacy',
          id: legacyVersion.id,
          instructions: legacyVersion.instructions,
          proposalLimit: 0,
          skills: [],
        }
      : null;
  }
}

function managedOwner(scope: AgentVersionResolutionScope): ManagedAgentOwner {
  return {
    tenantId: scope.tenantId,
    principalType: scope.principalType,
    principalId: scope.principalId,
  };
}
