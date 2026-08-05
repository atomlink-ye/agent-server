import type { ResolvedSkillPackage } from './skill-catalog.js';
import type { RuntimeExtensionBinding } from '../ports/agent-runtime.js';

export interface RuntimeExtensionBinder {
  bind(input: {
    readonly tenantId: string;
    readonly principalType: string;
    readonly principalId: string;
    readonly workspaceId: string;
    readonly productSessionId?: string;
    readonly scopeId?: string;
    readonly taskId?: string;
    readonly runId?: string;
    readonly teamMemberRunId?: string;
    readonly contextEpoch?: string;
    readonly cellCwd?: string;
    readonly skills: readonly ResolvedSkillPackage[];
    readonly toolRefs: readonly string[];
  }): Promise<RuntimeExtensionBinding | undefined>;

  refreshForTeamMember?(input: {
    readonly grantId?: string;
    readonly teamMemberRunId: string;
    readonly scopeId: string;
    readonly taskId: string;
    readonly runId: string;
    readonly allowedTools: readonly string[];
    readonly contextEpoch: string;
    readonly ttlMs?: number;
  }): unknown;

  getTeamMemberGrant?(input: {
    readonly teamMemberRunId: string;
    readonly scopeId: string;
  }): import('./runtime-tool-grant-service.js').RuntimeToolGrant | null;
}
