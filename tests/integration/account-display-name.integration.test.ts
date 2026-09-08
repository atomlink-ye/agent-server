import { PGlite } from '@electric-sql/pglite';
import { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';

import { PostgresWorkspaceMembershipRepository } from '../../src/infrastructure/postgres/postgres-workspace-membership-repository.js';
import { applyDurableKernelMigrations } from '../../src/infrastructure/postgres/postgres.js';
import { registerAccountRoutes } from '../../src/entrypoints/api/routes/account.js';
import { HttpError } from '../../src/contracts/http.js';
import type { ApiEnvironment } from '../../src/entrypoints/api/http-types.js';
import type { AppConfig } from '../../src/shared/config.js';

const token = 'account-display-name-token';
const tenantId = 'tenant_account_display_name';
const workspaceId = 'b1000000-0000-4000-8000-000000000101';
const serviceAccountId = 'svc_account_display_name';
const now = '2026-09-08T00:00:00.000Z';

let database: PGlite | undefined;

afterEach(async () => {
  await database?.close();
  database = undefined;
});

describe('the display-name endpoint only reports success when the write actually lands', () => {
  it('lets a brand-new user rename themselves before any membership row was ever seeded', async () => {
    const app = await appForWorkspace(workspaceId);

    // No admission has happened yet for this person -- this is the "opened
    // the page and renamed immediately" case, before AdmitWorkspaceMember
    // would otherwise have lazily created the row.
    const response = await app.request('/api/v1/account/display-name', {
      method: 'PATCH',
      headers: {
        ...headers('brand-new-person'),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ display_name: 'Fan Ye' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ display_name: 'Fan Ye' });

    const row = await database!.query<{ display_name: string }>(
      `SELECT display_name FROM workspace_members
        WHERE tenant_id=$1 AND workspace_id=$2 AND principal_type='user'
          AND principal_id=$3`,
      [tenantId, workspaceId, 'brand-new-person'],
    );
    expect(row.rows).toEqual([{ display_name: 'Fan Ye' }]);
  });

  it('does not report success when the rename cannot land anywhere', async () => {
    // The service account's own workspace does not exist, so both the
    // ensureMember seed and the display-name UPDATE match zero rows -- the
    // exact silent-failure shape the dispatch flagged.
    const missingWorkspaceId = 'b1000000-0000-4000-8000-000000000404';
    const app = await appForWorkspace(missingWorkspaceId, {
      seedWorkspace: false,
    });

    const response = await app.request('/api/v1/account/display-name', {
      method: 'PATCH',
      headers: { ...headers('anyone'), 'content-type': 'application/json' },
      body: JSON.stringify({ display_name: 'Fan Ye' }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: { code: 'workspace_member_not_found' },
    });
  });

  it('renames an already-admitted member and reflects the write, not just the request echo', async () => {
    const app = await appForWorkspace(workspaceId);
    await database!.query(
      `INSERT INTO workspace_members
         (workspace_id,tenant_id,principal_type,principal_id,display_name,
          created_at,updated_at)
       VALUES($1,$2,'user',$3,'Guest CF45',$4,$4)`,
      [workspaceId, tenantId, 'existing-person', now],
    );

    const response = await app.request('/api/v1/account/display-name', {
      method: 'PATCH',
      headers: {
        ...headers('existing-person'),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ display_name: 'Fan Ye' }),
    });

    expect(response.status).toBe(200);
    const row = await database!.query<{ display_name: string }>(
      `SELECT display_name FROM workspace_members
        WHERE tenant_id=$1 AND workspace_id=$2 AND principal_type='user'
          AND principal_id=$3`,
      [tenantId, workspaceId, 'existing-person'],
    );
    expect(row.rows).toEqual([{ display_name: 'Fan Ye' }]);
  });
});

async function appForWorkspace(
  effectiveWorkspaceId: string,
  options: { readonly seedWorkspace?: boolean } = {},
): Promise<Hono<ApiEnvironment>> {
  database = new PGlite();
  await applyDurableKernelMigrations(database);
  if (options.seedWorkspace ?? true) {
    await database.query(
      `INSERT INTO workspaces
         (id,tenant_id,principal_type,principal_id,name,created_at,updated_at)
       VALUES($1,$2,'service_account',$3,$4,$5,$5)`,
      [
        effectiveWorkspaceId,
        tenantId,
        serviceAccountId,
        'Account Display Name Workspace',
        now,
      ],
    );
  }

  const app = new Hono<ApiEnvironment>();
  app.onError((error, context) => {
    if (error instanceof HttpError)
      return context.json(
        { error: { code: error.code, message: error.message } },
        error.status,
      );
    throw error;
  });

  registerAccountRoutes(app, {
    config: testConfig(effectiveWorkspaceId),
    workspaceMembers: new PostgresWorkspaceMembershipRepository(database),
  });

  return app;
}

function testConfig(effectiveWorkspaceId: string): AppConfig {
  return {
    serviceAccounts: [
      {
        serviceAccountId,
        token,
        tenantId,
        workspaceId: effectiveWorkspaceId,
        policyVersion: 'v1',
        disabled: false,
      },
    ],
  } as unknown as AppConfig;
}

function headers(userId: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    'x-agent-server-user-id': userId,
  };
}
