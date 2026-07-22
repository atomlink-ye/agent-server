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
