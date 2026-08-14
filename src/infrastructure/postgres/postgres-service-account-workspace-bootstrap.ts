import { SERVICE_ACCOUNT_PRINCIPAL_TYPE } from '../../platform/access-context.js';
import type { ServiceAccountRecord } from '../../application/control-plane/service-account-authenticator.js';

const SERVICE_ACCOUNT_WORKSPACE_NAME = 'Service account workspace';

interface WorkspaceOwnerRow extends Record<string, unknown> {
  readonly id: string;
  readonly tenant_id: string;
  readonly principal_type: string;
  readonly principal_id: string;
}

export interface ServiceAccountWorkspaceBootstrapDatabase {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rows?: readonly Row[] }>;
}

export class ServiceAccountWorkspaceBootstrapError extends Error {
  public constructor() {
    super('Configured service-account workspace bootstrap failed.');
    this.name = 'ServiceAccountWorkspaceBootstrapError';
  }
}

export async function ensureServiceAccountWorkspaces(
  database: ServiceAccountWorkspaceBootstrapDatabase,
  accounts: readonly ServiceAccountRecord[],
  now: () => Date = () => new Date(),
): Promise<void> {
  const candidates = new Map<string, ServiceAccountRecord>();
  for (const account of accounts) {
    if (account.disabled || !isCanonicalUuid(account.workspaceId)) continue;
    const key = `${account.tenantId}\u0000${account.workspaceId}\u0000${account.serviceAccountId}`;
    candidates.set(key, account);
  }

  for (const account of candidates.values()) {
    try {
      const timestamp = now().toISOString();
      await database.query(
        `INSERT INTO workspaces(id,tenant_id,principal_type,principal_id,name,created_at,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$6)
         ON CONFLICT (id) DO NOTHING`,
        [
          account.workspaceId,
          account.tenantId,
          SERVICE_ACCOUNT_PRINCIPAL_TYPE,
          account.serviceAccountId,
          SERVICE_ACCOUNT_WORKSPACE_NAME,
          timestamp,
        ],
      );
      const persisted = await database.query<WorkspaceOwnerRow>(
        `SELECT id,tenant_id,principal_type,principal_id FROM workspaces WHERE id=$1`,
        [account.workspaceId],
      );
      const row = persisted.rows?.[0];
      if (
        !row ||
        row.tenant_id !== account.tenantId ||
        row.principal_type !== SERVICE_ACCOUNT_PRINCIPAL_TYPE ||
        row.principal_id !== account.serviceAccountId
      )
        throw new ServiceAccountWorkspaceBootstrapError();
    } catch (error) {
      if (error instanceof ServiceAccountWorkspaceBootstrapError) throw error;
      throw new ServiceAccountWorkspaceBootstrapError();
    }
  }
}

function isCanonicalUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
