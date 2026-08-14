import type { AgentRegistry } from '../ports/agent-registry.js';
import type { DefinitionReadApi } from '../ports/definition-read-api.js';
import type { ManagedAgentOwner } from '../../domain/agents/managed-agent-owner.js';
import {
  isModelPolicyRef,
  type ModelPolicyRef,
} from '../../domain/agents/managed-agent-package.js';
import {
  AGENT_SERVER_MEMORY_READ_TOOL_REF,
  SUPPORTED_MANAGED_AGENT_TOOL_REFS,
} from './built-in-skills.js';
import type {
  ResolvedSkillPackage,
  SkillCatalogPort,
} from '../extensions/skill-catalog.js';
import type {
  AgentVersionResolutionScope,
  AgentResolutionApi,
  ResolvedAgentVersion,
} from '../ports/agent-resolution-api.js';

export type {
  AgentVersionResolutionScope,
  ResolvedAgentVersion,
} from '../ports/agent-resolution-api.js';

export class ResolveAgentVersion implements AgentResolutionApi {
  public constructor(
    private readonly managed: Pick<AgentRegistry, 'findVersion'>,
    private readonly legacy: Pick<
      DefinitionReadApi,
      'findPublishedAgentVersionById'
    >,
    private readonly skillCatalog: SkillCatalogPort,
  ) {}

  public async resolvePublished(
    versionId: string,
    scope: AgentVersionResolutionScope,
    options: { readonly resolveExtensions?: boolean } = {},
  ): Promise<ResolvedAgentVersion | null> {
    const managedVersion = await this.managed.findVersion(
      managedOwner(scope),
      versionId,
    );
    if (managedVersion) {
      if (managedVersion.status !== 'published') return null;
      if (options.resolveExtensions === false) {
        return {
          source: 'managed',
          id: managedVersion.id,
          instructions: managedVersion.package.spec.instructions,
          modelPolicyRef: readModelPolicyRef(managedVersion),
          proposalLimit: managedVersion.package.spec.memory?.proposalLimit ?? 0,
          skills: [],
          toolRefs: [],
        };
      }
      const toolRefs = managedVersion.package.spec.tools.map(
        (tool) => tool.ref,
      );
      validateToolRefs(toolRefs);
      const skillRefs = managedVersion.package.spec.skills.map(
        (skill) => skill.ref,
      );
      const seenSkills = new Set<string>();
      const skills: ResolvedSkillPackage[] = [];
      for (const ref of skillRefs) {
        if (seenSkills.has(ref))
          throw new Error(
            'The managed Agent references a Skill more than once.',
          );
        seenSkills.add(ref);
        const resolved = await this.skillCatalog.resolve(ref);
        if (!resolved)
          throw new Error('The managed Agent references an unsupported Skill.');
        skills.push(resolved);
      }
      for (const skill of skills) {
        for (const required of skill.requiredToolRefs) {
          if (!toolRefs.includes(required))
            throw new Error('A Skill required Tool is not granted.');
        }
      }
      return {
        source: 'managed',
        id: managedVersion.id,
        instructions: managedVersion.package.spec.instructions,
        modelPolicyRef: readModelPolicyRef(managedVersion),
        proposalLimit: managedVersion.package.spec.memory?.proposalLimit ?? 0,
        skills: Object.freeze(skills),
        toolRefs: Object.freeze([...toolRefs]),
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
          modelPolicyRef: 'free-only',
          proposalLimit: 0,
          skills: [],
          toolRefs: [],
        }
      : null;
  }
}

function readModelPolicyRef(version: {
  readonly package: {
    readonly spec: {
      readonly runtime?: { readonly modelPolicyRef?: unknown };
    };
  };
}): ModelPolicyRef {
  const ref = version.package.spec.runtime?.modelPolicyRef;
  if (!isModelPolicyRef(ref))
    throw new Error('Unsupported model policy reference.');
  return ref;
}

function validateToolRefs(refs: readonly string[]): void {
  const seen = new Set<string>();
  for (const ref of refs) {
    if (seen.has(ref) || !SUPPORTED_MANAGED_AGENT_TOOL_REFS.has(ref))
      throw new Error('The managed Agent references an unsupported Tool.');
    seen.add(ref);
  }
}

function managedOwner(scope: AgentVersionResolutionScope): ManagedAgentOwner {
  return {
    tenantId: scope.tenantId,
    principalType: scope.principalType,
    principalId: scope.principalId,
  };
}
