export const SERVICE_ACCOUNT_PRINCIPAL_TYPE = 'service_account';

export interface AccessContext {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly principalType: typeof SERVICE_ACCOUNT_PRINCIPAL_TYPE;
  readonly principalId: string;
  readonly policySnapshotVersion: string;
}

export interface ServiceAccountAccessContext extends AccessContext {
  readonly principalType: typeof SERVICE_ACCOUNT_PRINCIPAL_TYPE;
  readonly serviceAccountId: string;
}

export interface AccessContextRequest {
  get(key: 'accessContext'): ServiceAccountAccessContext | null;
}

export function getAuthenticatedAccessContext(
  request: AccessContextRequest,
): ServiceAccountAccessContext {
  const accessContext = request.get('accessContext');
  if (!accessContext)
    throw new Error('Authenticated access context is not available');
  return accessContext;
}
