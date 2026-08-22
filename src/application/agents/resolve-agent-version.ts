import type {
  AgentRegistry,
  ManagedAgentDefinitionRead,
} from '../ports/agent-registry.js';
import {
  isModelPolicyRef,
  type ModelPolicyRef,
} from '../../domain/agents/managed-agent-package.js';
import { resourceOwner, type ResourceOwner } from '../../domain/tenancy/product-context.js';
import { SUPPORTED_MANAGED_AGENT_TOOL_REFS } from './built-in-skills.js';
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

type CanonicalAgentVersionRead = Pick<AgentRegistry, 'findVersion'> &
  Pick<ManagedAgentDefinitionRead, 'findVersionByTenant'>;

export class ResolveAgentVersion implements AgentResolutionApi {
  public constructor(
    private readonly managed: CanonicalAgentVersionRead,
    private readonly skillCatalog: SkillCatalogPort,
  ) {
  }

  public async resolvePublished(
    versionId: string,
    scope: AgentVersionResolutionScope,
    options: { readonly resolveExtensions?: boolean } = {},
  ): Promise<ResolvedAgentVersion | null> {
    const managedVersion = await this.managed.findVersionByTenant({
      tenantId: scope.tenantId,
      versionId,
    });
    if (managedVersion) {
      if (managedVersion.status !== 'published') return null;
      const identity = resolvedIdentity(managedVersion);
      if (options.resolveExtensions === false) {
        return {
          source: 'managed',
          id: managedVersion.id,
          ...identity,
          instructions: managedVersion.package.spec.instructions,
          modelPolicyRef: readModelPolicyRef(managedVersion),
          proposalLimit: managedVersion.package.spec.memory?.proposalLimit ?? 0,
          skills: [],
          toolRefs: [],
        };
      }
      const toolRefs = managedVersion.package.spec.tools.map((tool) => tool.ref);
      validateToolRefs(toolRefs);
      const skillRefs = managedVersion.package.spec.skills.map((skill) => skill.ref);
      const seenSkills = new Set<string>();
      const skills: ResolvedSkillPackage[] = [];
      for (const ref of skillRefs) {
        if (seenSkills.has(ref))
          throw new Error('The managed Agent references a Skill more than once.');
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
        ...identity,
        instructions: managedVersion.package.spec.instructions,
        modelPolicyRef: readModelPolicyRef(managedVersion),
        proposalLimit: managedVersion.package.spec.memory?.proposalLimit ?? 0,
        skills: Object.freeze(skills),
        toolRefs: Object.freeze([...toolRefs]),
      };
    }
    return null;
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

/**
 * Production registry entities carry all of these fields. Some deliberately
 * bounded unit/runtime fakes predate ContextFS and omit them; keep the new
 * structured identity optional rather than turning those shims into product
 * ownership authorities.
 */
function resolvedIdentity(value: unknown): Readonly<{
  definitionId?: string;
  agentOwner?: ResourceOwner;
}> {
  if (!value || typeof value !== 'object') return Object.freeze({});
  const row = value as Record<string, unknown>;
  const definitionId =
    typeof row.definitionId === 'string' && row.definitionId.length > 0
      ? row.definitionId
      : undefined;
  const canResolveOwner =
    typeof row.tenantId === 'string' &&
    row.tenantId.length > 0 &&
    typeof row.workspaceId === 'string' &&
    row.workspaceId.length > 0 &&
    (row.principalType === 'service_account' || row.principalType === 'user') &&
    typeof row.principalId === 'string' &&
    row.principalId.length > 0;
  return Object.freeze({
    ...(definitionId ? { definitionId } : {}),
    ...(canResolveOwner
      ? {
          agentOwner: resourceOwner({
            tenantId: row.tenantId as string,
            workspaceId: row.workspaceId as string,
            principalType: row.principalType as string,
            principalId: row.principalId as string,
          }),
        }
      : {}),
  });
}
