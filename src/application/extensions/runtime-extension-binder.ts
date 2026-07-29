import type { ResolvedSkillPackage } from './skill-catalog.js';
import type { RuntimeExtensionBinding } from '../ports/agent-runtime.js';

export interface RuntimeExtensionBinder {
  bind(input: {
    readonly tenantId: string;
    readonly principalType: string;
    readonly principalId: string;
    readonly workspaceId: string;
    readonly productSessionId?: string;
    readonly cellCwd?: string;
    readonly skills: readonly ResolvedSkillPackage[];
    readonly toolRefs: readonly string[];
  }): Promise<RuntimeExtensionBinding | undefined>;
}
