import { describe, expect, it } from 'vitest';

import type { ServiceAccountRecord } from '../../application/control-plane/service-account-authenticator.js';
import {
  ensureServiceAccountWorkspaces,
  ServiceAccountWorkspaceBootstrapError,
} from './postgres-service-account-workspace-bootstrap.js';

const workspaceId = '00000000-0000-4000-8000-000000000201';

describe('ensureServiceAccountWorkspaces', () => {
  it('inserts enabled canonical scopes and skips disabled or legacy scopes', async () => {
    const database = createDatabase();

    await ensureServiceAccountWorkspaces(
      database,
      [
        account({ workspaceId }),
        account({ serviceAccountId: 'svc_disabled', disabled: true }),
        account({
          serviceAccountId: 'svc_legacy',
          workspaceId: 'workspace_main',
        }),
      ],
      () => new Date('2026-08-11T01:02:03.000Z'),
    );

    expect(database.inserts).toHaveLength(1);
    expect(database.inserts[0]).toEqual([
      workspaceId,
      'tenant-1',
      'service_account',
      'svc-1',
      'Service account workspace',
      '2026-08-11T01:02:03.000Z',
    ]);
  });

  it('is idempotent and deduplicates compatible repeats without overwriting', async () => {
    const database = createDatabase();
    const records = [account({ workspaceId }), account({ workspaceId })];

    await ensureServiceAccountWorkspaces(database, records);
    await ensureServiceAccountWorkspaces(database, records);

    expect(database.inserts).toHaveLength(2);
    expect(database.rows.get(workspaceId)).toEqual({
      id: workspaceId,
      tenant_id: 'tenant-1',
      principal_type: 'service_account',
      principal_id: 'svc-1',
    });
  });

  it('fails closed when a canonical workspace belongs to another owner', async () => {
    const database = createDatabase({
      [workspaceId]: {
        id: workspaceId,
        tenant_id: 'tenant-other',
        principal_type: 'service_account',
        principal_id: 'svc-other',
      },
    });

    await expect(
      ensureServiceAccountWorkspaces(database, [account({ workspaceId })]),
    ).rejects.toBeInstanceOf(ServiceAccountWorkspaceBootstrapError);
    expect(database.inserts).toHaveLength(1);
  });
});

function account(
  overrides: Partial<ServiceAccountRecord> = {},
): ServiceAccountRecord {
  return {
    serviceAccountId: 'svc-1',
    token: 'token-1',
    tenantId: 'tenant-1',
    workspaceId,
    policyVersion: 'policy-1',
    disabled: false,
    ...overrides,
  };
}

function createDatabase(initial: Record<string, WorkspaceRow> = {}) {
  const rows = new Map(Object.entries(initial));
  const inserts: readonly unknown[][] = [];
  const database = {
    rows,
    inserts: inserts as unknown[][],
    async query<Row extends Record<string, unknown>>(
      sql: string,
      values: readonly unknown[] = [],
    ): Promise<{ readonly rows?: readonly Row[] }> {
      if (sql.startsWith('SELECT')) {
        const row = rows.get(String(values[0]));
        return { rows: (row ? [row] : []) as unknown as Row[] };
      }
      const copy = [...values];
      database.inserts.push(copy);
      if (!rows.has(String(values[0])))
        rows.set(String(values[0]), {
          id: String(values[0]),
          tenant_id: String(values[1]),
          principal_type: String(values[2]),
          principal_id: String(values[3]),
        });
      return { rows: [] as Row[] };
    },
  };
  return database;
}

type WorkspaceRow = {
  readonly id: string;
  readonly tenant_id: string;
  readonly principal_type: string;
  readonly principal_id: string;
};
