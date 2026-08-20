import type { ResolvedSkillPackage } from './skill-catalog.js';
import type { ExecutionExtensionBinding } from '../ports/execution-plane.js';
import type { RuntimeToolChatContext } from './runtime-tool-grant-service.js';

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
    readonly teamRunId?: string;
    readonly contextEpoch?: string;
    /** Trusted origin for a Chat turn, when this binding serves one. */
    readonly chatContext?: RuntimeToolChatContext;
    readonly cellCwd?: string;
    readonly skills: readonly ResolvedSkillPackage[];
    /** User/domain tools only. Platform Collaboration tools are auto-mounted. */
    readonly toolRefs: readonly string[];
    readonly catalogTools?: readonly string[];
  }): Promise<ExecutionExtensionBinding | undefined>;

  refreshForTeamMember?(input: {
    readonly grantId?: string;
    readonly teamMemberRunId: string;
    readonly scopeId: string;
    readonly taskId: string;
    readonly runId: string;
    /** User/domain tools allowed for this turn. */
    readonly allowedTools: readonly string[];
    readonly contextEpoch: string;
    readonly ttlMs?: number;
  }): import('./runtime-tool-grant-service.js').RuntimeToolGrant;

  closeTeamMemberTurn?(input: {
    readonly grantId: string;
    readonly teamMemberRunId: string;
    readonly scopeId: string;
    readonly ttlMs?: number;
  }): import('./runtime-tool-grant-service.js').RuntimeToolGrant;

  getTeamMemberGrant?(input: {
    readonly teamMemberRunId: string;
    readonly scopeId: string;
  }): import('./runtime-tool-grant-service.js').RuntimeToolGrant | null;
  revoke?(grantId: string): void;
  revokeForTeamRun?(teamRunId: string): void;
  activeToolCalls?(grantId: string): number;
}
