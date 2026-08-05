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
