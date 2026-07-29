import { randomUUID } from 'node:crypto';

export type TeamMemberRunStatus =
  'starting' | 'active' | 'idle' | 'stopped' | 'failed';
export type TeamMemberRunRole = 'lead' | 'member';

export interface TeamMemberRun {
  readonly id: string;
  readonly teamRunId: string;
  readonly name: string;
  readonly role: TeamMemberRunRole;
  readonly agentVersionId: string;
  readonly runtimeSessionId: string | null;
  readonly status: TeamMemberRunStatus;
  readonly currentWorkItemId: string | null;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly principalType: string;
  readonly principalId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateTeamMemberRunOptions {
  readonly id?: string;
  readonly teamRunId: string;
  readonly name: string;
  readonly role: 'lead' | 'member';
  readonly agentVersionId: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly principalType: string;
  readonly principalId: string;
  readonly now?: () => Date;
}

export function createTeamMemberRun(
  options: CreateTeamMemberRunOptions,
): TeamMemberRun {
  const timestamp = (options.now ?? (() => new Date()))().toISOString();
  return Object.freeze({
    id: options.id ?? randomUUID(),
    teamRunId: options.teamRunId,
    name: options.name,
    role: options.role,
    agentVersionId: options.agentVersionId,
    runtimeSessionId: null,
    status: 'starting' as const,
    currentWorkItemId: null,
    tenantId: options.tenantId,
    workspaceId: options.workspaceId,
    principalType: options.principalType,
    principalId: options.principalId,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export function activateMemberRun(
  member: TeamMemberRun,
  now: () => Date = () => new Date(),
): TeamMemberRun {
  return Object.freeze({
    ...member,
    status: 'active' as const,
    updatedAt: now().toISOString(),
  });
}

export function idleMemberRun(
  member: TeamMemberRun,
  now: () => Date = () => new Date(),
): TeamMemberRun {
  return Object.freeze({
    ...member,
    status: 'idle' as const,
    currentWorkItemId: null,
    updatedAt: now().toISOString(),
  });
}

export function stopMemberRun(
  member: TeamMemberRun,
  now: () => Date = () => new Date(),
): TeamMemberRun {
  return Object.freeze({
    ...member,
    status: 'stopped' as const,
    updatedAt: now().toISOString(),
  });
}

export function failMemberRun(
  member: TeamMemberRun,
  now: () => Date = () => new Date(),
): TeamMemberRun {
  return Object.freeze({
    ...member,
    status: 'failed' as const,
    updatedAt: now().toISOString(),
  });
}
