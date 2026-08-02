import { registerSkill } from '../../application/extensions/skill-registry.js';

export interface ProjectSkillRegistrar {
  register(input: {
    readonly ref: string;
    readonly name: string;
    readonly sourceRoot: string;
    readonly expectedDigest?: string;
    readonly requiredToolRefs: readonly string[];
  }): Promise<{
    readonly ref: string;
    readonly digest: string;
    readonly changed: boolean;
  }>;
}

export class LocalProjectSkillRegistrar implements ProjectSkillRegistrar {
  public constructor(
    private readonly registryRoot = process.env
      .AGENT_SERVER_SKILL_REGISTRY_ROOT,
  ) {
    if (!registryRoot) throw new Error('skill_registry_root_missing');
  }
  public async register(input: {
    readonly ref: string;
    readonly name: string;
    readonly sourceRoot: string;
    readonly expectedDigest?: string;
    readonly requiredToolRefs: readonly string[];
  }): Promise<{
    readonly ref: string;
    readonly digest: string;
    readonly changed: boolean;
  }> {
    const result = await registerSkill({
      ...input,
      registryRoot: this.registryRoot!,
    });
    return { ref: result.ref, digest: result.digest, changed: result.changed };
  }
}
