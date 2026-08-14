import type { ResolvedSkillPackage } from '../extensions/skill-catalog.js';
import type {
  ExecutionSessionBinding,
  ExecutionWorkspaceBinding,
} from './execution-plane.js';

export interface RuntimeSession {
  readonly id: string;
  readonly scopeKind: 'product_session' | 'task' | 'team_member';
  readonly scopeId: string;
  readonly productSessionId: string | null;
  readonly taskId: string | null;
  readonly launchSnapshotId: string;
  readonly workspaceId: string;
  readonly agentVersionId: string;
  readonly environmentVersionId: string;
  readonly resolvedSkills: readonly Pick<
    ResolvedSkillPackage,
    'ref' | 'digest'
  >[];
  readonly toolRefs: readonly string[];
  readonly workspaceBinding: ExecutionWorkspaceBinding | null;
  readonly sessionBinding: ExecutionSessionBinding | null;
  /** @deprecated Compatibility projection while ExecuteRun migrates. */
  readonly paseoWorkspaceId: string | null;
  /** @deprecated Compatibility projection while ExecuteRun migrates. */
  readonly providerAgentId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RuntimeSessionRepository {
  createOrGetForTeamMember?(input: {
    teamMemberRunId: string;
    taskId: string;
    tenantId: string;
    principalType: string;
    principalId: string;
    workspaceId: string;
    agentVersionId: string;
    environmentVersionId: string;
    resolvedSkills: readonly Pick<ResolvedSkillPackage, 'ref' | 'digest'>[];
    toolRefs: readonly string[];
  }): Promise<RuntimeSession>;
  findByTeamMember?(input: {
    teamMemberRunId: string;
    tenantId: string;
    workspaceId: string;
    principalType: string;
    principalId: string;
  }): Promise<RuntimeSession | null>;
  /** @deprecated Use RuntimeWorkspaceRepository.findForTeamRun. */
  findPaseoWorkspaceByTeamRun?(input: {
    teamRunId: string;
    tenantId: string;
    workspaceId: string;
    principalType: string;
    principalId: string;
  }): Promise<string | null>;
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
  createOrGetForTask(input: {
    taskId: string;
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
  findByTask(input: {
    taskId: string;
    tenantId: string;
    principalType: string;
    principalId: string;
  }): Promise<RuntimeSession | null>;
  bindExecution(input: {
    readonly id: string;
    readonly workspaceBinding: ExecutionWorkspaceBinding;
    readonly sessionBinding: ExecutionSessionBinding;
  }): Promise<RuntimeSession>;
  /** @deprecated Compatibility method while old runtime callers migrate. */
  bindProvider(input: {
    id: string;
    paseoWorkspaceId: string;
    providerAgentId: string;
  }): Promise<RuntimeSession>;
}
