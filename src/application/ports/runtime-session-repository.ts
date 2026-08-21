import type { RuntimeScope } from '../../domain/runtime/runtime-invocation-context.js';
import type { ResolvedSkillPackage } from '../extensions/skill-catalog.js';
import type {
  ExecutionSessionBinding,
  ExecutionWorkspaceBinding,
} from './execution-plane.js';

export interface RuntimeSession {
  readonly id: string;
  /** Canonical runtime identity. Legacy flat fields remain during migration. */
  readonly scope: RuntimeScope;
  readonly scopeKind: RuntimeScope['kind'];
  readonly scopeId: string;
  readonly productSessionId: string | null;
  readonly taskId: string | null;
  readonly launchSnapshotId: string;
  readonly workspaceId: string;
  readonly agentVersionId: string;
  /** Chat brains may run without a Product Work environment version. */
  readonly environmentVersionId: string | null;
  readonly resolvedSkills: readonly Pick<
    ResolvedSkillPackage,
    'ref' | 'digest'
  >[];
  readonly toolRefs: readonly string[];
  readonly workspaceBinding: ExecutionWorkspaceBinding | null;
  readonly sessionBinding: ExecutionSessionBinding | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RuntimeSessionLookup {
  findById(id: string): Promise<RuntimeSession | null>;
  findByExecutionSessionBinding(
    binding: ExecutionSessionBinding,
  ): Promise<RuntimeSession | null>;
}

export interface RuntimeSessionRepository {
  createOrGetForAgentChat?(input: {
    agentChatRuntimeId: string;
    runtimeEpoch: number;
    tenantId: string;
    principalType: string;
    principalId: string;
    workspaceId: string;
    agentVersionId: string;
    resolvedSkills: readonly Pick<ResolvedSkillPackage, 'ref' | 'digest'>[];
    toolRefs: readonly string[];
  }): Promise<RuntimeSession>;
  findByAgentChat?(input: {
    agentChatRuntimeId: string;
    runtimeEpoch: number;
    tenantId: string;
    workspaceId: string;
    principalType: string;
    principalId: string;
  }): Promise<RuntimeSession | null>;
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
}
