import type { ResolvedSkillPackage } from '../extensions/skill-catalog.js';

export interface RuntimeSession {
  readonly id: string;
  readonly productSessionId: string;
  readonly launchSnapshotId: string;
  readonly agentVersionId: string;
  readonly environmentVersionId: string;
  readonly resolvedSkills: readonly Pick<
    ResolvedSkillPackage,
    'ref' | 'digest'
  >[];
  readonly toolRefs: readonly string[];
  readonly paseoWorkspaceId: string | null;
  readonly providerAgentId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RuntimeSessionRepository {
  createOrGetForProductSession(input: {
    productSessionId: string;
    tenantId: string;
    principalType: string;
    principalId: string;
    workspaceId: string;
    agentVersionId: string;
    environmentVersionId: string;
    resolvedSkills: readonly Pick<ResolvedSkillPackage, 'ref' | 'digest'>[];
    toolRefs: readonly string[];
  }): Promise<RuntimeSession>;
  findByProductSession(input: {
    productSessionId: string;
    tenantId: string;
    principalType: string;
    principalId: string;
  }): Promise<RuntimeSession | null>;
  bindProvider(input: {
    id: string;
    paseoWorkspaceId: string;
    providerAgentId: string;
  }): Promise<RuntimeSession>;
}
