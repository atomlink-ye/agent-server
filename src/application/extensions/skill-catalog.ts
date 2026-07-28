export type ResolvedSkillPackage = Readonly<{
  ref: string;
  name: string;
  digest: string;
  objectPath: string;
  manifestPath: string;
  delivery: 'native_project';
  requiredToolRefs: readonly string[];
}>;

export type SkillCatalogPort = Readonly<{
  resolve(ref: string): Promise<ResolvedSkillPackage | null>;
}>;
