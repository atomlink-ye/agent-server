import type {
  ExecutionSessionBinding,
  ExecutionWorkspaceBinding,
} from './execution-plane.js';

export interface AgentRunRuntimeSession {
  readonly id: string;
  readonly scopeKind: 'team_member' | 'product_session' | 'task';
  readonly scopeId: string;
  readonly taskId: string | null;
  readonly workspaceId: string;
  readonly agentVersionId: string;
  readonly environmentVersionId: string | null;
  readonly toolRefs: readonly string[];
  readonly workspaceBinding: ExecutionWorkspaceBinding | null;
  readonly sessionBinding: ExecutionSessionBinding | null;
}

interface AgentRunRuntimeSkills {
  readonly ref: string;
  readonly digest: string;
}

export interface AgentRunRuntimeSessions {
  findByProductSession(input: {
    readonly productSessionId: string;
    readonly tenantId: string;
    readonly principalType: string;
    readonly principalId: string;
  }): Promise<AgentRunRuntimeSession | null>;
  findByTeamMember?(input: {
    readonly teamMemberRunId: string;
    readonly workspaceId: string;
    readonly tenantId: string;
    readonly principalType: string;
    readonly principalId: string;
  }): Promise<AgentRunRuntimeSession | null>;
  findByTask(input: {
    readonly taskId: string;
    readonly tenantId: string;
    readonly principalType: string;
    readonly principalId: string;
  }): Promise<AgentRunRuntimeSession | null>;
  createOrGetForProductSession(input: {
    readonly productSessionId: string;
    readonly tenantId: string;
    readonly principalType: string;
    readonly principalId: string;
    readonly workspaceId: string;
    readonly agentVersionId: string;
    readonly environmentVersionId: string;
    readonly resolvedSkills: readonly AgentRunRuntimeSkills[];
    readonly toolRefs: readonly string[];
  }): Promise<AgentRunRuntimeSession>;
  createOrGetForTeamMember?(input: {
    readonly teamMemberRunId: string;
    readonly taskId: string;
    readonly tenantId: string;
    readonly principalType: string;
    readonly principalId: string;
    readonly workspaceId: string;
    readonly agentVersionId: string;
    readonly environmentVersionId: string;
    readonly resolvedSkills: readonly AgentRunRuntimeSkills[];
    readonly toolRefs: readonly string[];
  }): Promise<AgentRunRuntimeSession>;
  createOrGetForTask(input: {
    readonly taskId: string;
    readonly tenantId: string;
    readonly principalType: string;
    readonly principalId: string;
    readonly workspaceId: string;
    readonly agentVersionId: string;
    readonly environmentVersionId: string;
    readonly resolvedSkills: readonly AgentRunRuntimeSkills[];
    readonly toolRefs: readonly string[];
  }): Promise<AgentRunRuntimeSession>;
}
