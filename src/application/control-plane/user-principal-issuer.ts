import {
  USER_PRINCIPAL_TYPE,
  type ServiceAccountAccessContext,
  type UserAccessContext,
} from '../../domain/access-context.js';

export class InvalidUserIdError extends Error {
  constructor() {
    super('userId is required to issue a user access context');
    this.name = 'InvalidUserIdError';
  }
}

/**
 * Mints a UserAccessContext representing a human principal, on behalf of an
 * already-authenticated service account, within that service account's own
 * tenant/workspace scope.
 */
export function issueUserAccessContext(
  issuer: ServiceAccountAccessContext,
  userId: string,
): UserAccessContext {
  if (typeof userId !== 'string' || !userId.trim()) {
    throw new InvalidUserIdError();
  }
  return Object.freeze({
    tenantId: issuer.tenantId,
    workspaceId: issuer.workspaceId,
    principalType: USER_PRINCIPAL_TYPE,
    principalId: userId,
    userId,
    policySnapshotVersion: issuer.policySnapshotVersion,
  });
}
