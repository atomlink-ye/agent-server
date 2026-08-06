import { randomUUID } from 'node:crypto';

export type TeamWorkItemStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'blocked'
  | 'cancelled'
  | 'open'
  | 'accepted';

export interface TeamWorkItem {
  readonly id: string;
  readonly teamRunId: string;
  readonly subject: string;
  readonly description: string | null;
  readonly status: TeamWorkItemStatus;
  readonly ownerMemberId: string | null;
  readonly createdByMemberId: string;
  readonly completionSummary: string | null;
  readonly executionTaskId: string | null;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly principalType: string;
  readonly principalId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
}

export interface CreateTeamWorkItemOptions {
  readonly id?: string;
  readonly teamRunId: string;
  readonly subject: string;
  readonly description?: string | null;
  readonly createdByMemberId: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly principalType: string;
  readonly principalId: string;
  readonly now?: () => Date;
}

export function createTeamWorkItem(
  options: CreateTeamWorkItemOptions,
): TeamWorkItem {
  const timestamp = (options.now ?? (() => new Date()))().toISOString();
  return Object.freeze({
    id: options.id ?? randomUUID(),
    teamRunId: options.teamRunId,
    subject: options.subject,
    description: options.description ?? null,
    status: 'pending' as const,
    ownerMemberId: null,
    createdByMemberId: options.createdByMemberId,
    completionSummary: null,
    executionTaskId: null,
    tenantId: options.tenantId,
    workspaceId: options.workspaceId,
    principalType: options.principalType,
    principalId: options.principalId,
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: null,
  });
}

export function cancelWorkItem(
  item: TeamWorkItem,
  now: () => Date = () => new Date(),
): TeamWorkItem {
  if (item.status !== 'in_progress') {
    throw new Error('Only in-progress work items can be cancelled.');
  }
  const updatedAt = now().toISOString();
  return Object.freeze({
    ...item,
    status: 'cancelled' as const,
    updatedAt,
  });
}
