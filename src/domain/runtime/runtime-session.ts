/** A nominal type used to keep runtime identities distinct at domain edges. */
export type Brand<T, B extends string> = T & {
  readonly __brand: B;
};

export type RuntimeSessionId = Brand<string, 'RuntimeSessionId'>;
export type RuntimeSpecRevision = Brand<number, 'RuntimeSpecRevision'>;
export type RuntimeGenerationId = Brand<string, 'RuntimeGenerationId'>;
export type RuntimeTurnId = Brand<string, 'RuntimeTurnId'>;
export type RuntimeGrantId = Brand<string, 'RuntimeGrantId'>;

export function runtimeSpecRevision(value: number): RuntimeSpecRevision {
  if (!Number.isInteger(value) || value < 1)
    throw new Error('Runtime spec revisions must be positive integers.');
  return value as RuntimeSpecRevision;
}

export type RuntimeScope =
  | Readonly<{
      readonly kind: 'agent_chat';
      readonly id: string;
      readonly epoch: number;
    }>
  | Readonly<{
      readonly kind: 'team_member';
      readonly id: string;
    }>
  | Readonly<{
      readonly kind: 'product_session';
      readonly id: string;
    }>
  | Readonly<{
      readonly kind: 'task';
      readonly id: string;
    }>
  | Readonly<{
      readonly kind: 'run';
      readonly id: string;
    }>;

export interface RuntimeSessionOwner {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly principalType: string;
  readonly principalId: string;
}

export type RuntimeSessionStatus =
  'provisioning' | 'ready' | 'reconciling' | 'degraded' | 'closed';

/** Stable Agent Server identity; provider state belongs to a generation. */
export interface RuntimeSession {
  readonly id: RuntimeSessionId;
  readonly owner: RuntimeSessionOwner;
  readonly scope: RuntimeScope;
  readonly desiredSpecRevision: RuntimeSpecRevision;
  readonly currentGenerationId: RuntimeGenerationId | null;
  readonly status: RuntimeSessionStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly closedAt: string | null;
}
