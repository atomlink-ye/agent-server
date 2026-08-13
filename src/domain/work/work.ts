import type { OwnerScope } from '../tenancy/owner-scope.js';

export type WorkId = string;
export type WorkOwnerScope = Pick<OwnerScope, 'tenantId' | 'workspaceId'>;
export type WorkOrigin = 'created' | 'backfilled';

export interface Work {
  readonly id: WorkId;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly definitionId: string;
  readonly currentDefinitionVersionId: string;
  readonly title: string;
  readonly origin: WorkOrigin;
  readonly archivedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateWorkInput {
  readonly id: WorkId;
  readonly owner: WorkOwnerScope;
  readonly definitionId: string;
  readonly definitionVersionId: string;
  readonly title: string;
  readonly origin?: WorkOrigin;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

export class InvalidWorkError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidWorkError';
  }
}

export class WorkNotFoundError extends Error {
  public constructor() {
    super('The work was not found for the requested owner scope.');
    this.name = 'WorkNotFoundError';
  }
}

export class WorkIdentityConflictError extends Error {
  public constructor(
    message = 'The work identity conflicts with an existing row.',
  ) {
    super(message);
    this.name = 'WorkIdentityConflictError';
  }
}

export class WorkWorkspaceScopeUnavailableError extends Error {
  public constructor() {
    super('The authenticated workspace scope is not provisioned.');
    this.name = 'WorkWorkspaceScopeUnavailableError';
  }
}

export function createWork(input: CreateWorkInput): Work {
  const title = input.title.trim();
  if (!input.id || !input.owner.tenantId || !input.owner.workspaceId)
    throw new InvalidWorkError('A work id and owner scope are required.');
  if (!input.definitionId || !input.definitionVersionId)
    throw new InvalidWorkError(
      'A definition and definition version are required.',
    );
  if (title.length < 1 || title.length > 200)
    throw new InvalidWorkError(
      'Work title must contain between 1 and 200 characters.',
    );
  const now = input.createdAt ?? new Date().toISOString();
  return {
    id: input.id,
    tenantId: input.owner.tenantId,
    workspaceId: input.owner.workspaceId,
    definitionId: input.definitionId,
    currentDefinitionVersionId: input.definitionVersionId,
    title,
    origin: input.origin ?? 'created',
    archivedAt: null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
  };
}
