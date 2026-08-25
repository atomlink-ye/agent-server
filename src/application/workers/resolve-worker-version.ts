import { isModelPolicyRef } from '../../domain/agents/managed-agent-package.js';
import { resourceOwner } from '../../domain/tenancy/product-context.js';
import { SUPPORTED_MANAGED_AGENT_TOOL_REFS } from '../agents/built-in-skills.js';
import type { ResolvedSkillPackage, SkillCatalogPort } from '../extensions/skill-catalog.js';
import type {
  ResolvedWorkerVersion,
  WorkerRegistry,
  WorkerResolutionApi,
  WorkerVersionResolutionScope,
} from '../ports/worker-registry.js';

export class ResolveWorkerVersion implements WorkerResolutionApi {
  public constructor(
    private readonly registry: Pick<WorkerRegistry, 'findVersionByTenant'>,
    private readonly skillCatalog: SkillCatalogPort,
  ) {}

  public async resolvePublished(
    versionId: string,
    scope: WorkerVersionResolutionScope,
    options: { readonly resolveExtensions?: boolean } = {},
  ): Promise<ResolvedWorkerVersion | null> {
    const version = await this.registry.findVersionByTenant({
      tenantId: scope.tenantId,
      versionId,
    });
    if (!version || version.status !== 'published') return null;
    const modelPolicyRef = version.package.spec.runtime.modelPolicyRef;
    if (!isModelPolicyRef(modelPolicyRef))
      throw new Error('Unsupported Worker model policy reference.');
    const base = {
      source: 'worker' as const,
      id: version.id,
      definitionId: version.definitionId,
      workerOwner: resourceOwner({
        tenantId: version.tenantId,
        workspaceId: version.workspaceId,
        principalType: version.principalType,
        principalId: version.principalId,
      }),
      instructions: version.package.spec.instructions,
      modelPolicyRef,
      proposalLimit: version.package.spec.memory?.proposalLimit ?? 0,
    };
    if (options.resolveExtensions === false)
      return Object.freeze({ ...base, skills: [], toolRefs: [] });

    const toolRefs = version.package.spec.tools.map((tool) => tool.ref);
    validateWorkerToolRefs(toolRefs);
    const skills: ResolvedSkillPackage[] = [];
    const seenSkills = new Set<string>();
    for (const skill of version.package.spec.skills) {
      if (seenSkills.has(skill.ref))
        throw new Error('The Worker references a Skill more than once.');
      seenSkills.add(skill.ref);
      const resolved = await this.skillCatalog.resolve(skill.ref);
      if (!resolved) throw new Error('The Worker references an unsupported Skill.');
      skills.push(resolved);
    }
    for (const skill of skills)
      for (const required of skill.requiredToolRefs)
        if (!toolRefs.includes(required))
          throw new Error('A Worker Skill required Tool is not granted.');

    return Object.freeze({
      ...base,
      skills: Object.freeze(skills),
      toolRefs: Object.freeze([...toolRefs]),
    });
  }
}

function validateWorkerToolRefs(refs: readonly string[]): void {
  const seen = new Set<string>();
  for (const ref of refs) {
    if (seen.has(ref)) throw new Error('The Worker references a Tool more than once.');
    if (!SUPPORTED_MANAGED_AGENT_TOOL_REFS.has(ref))
      throw new Error('The Worker references an unsupported Tool.');
    seen.add(ref);
  }
}
