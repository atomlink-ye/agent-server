import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import { applyDurableKernelMigrations } from './postgres.js';
import { PostgresSessionAgentBindingLookup } from './postgres-session-agent-binding-lookup.js';

async function transcriptDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE TABLE team_member_runs (
      team_run_id text NOT NULL,
      runtime_session_id text NOT NULL,
      name text NOT NULL,
      role text NOT NULL,
      status text NOT NULL,
      created_at timestamptz NOT NULL
    );
    CREATE TABLE runtime_sessions (
      id text PRIMARY KEY,
      current_generation_id text NULL
    );
    CREATE TABLE runtime_session_generations (
      id text PRIMARY KEY,
      runtime_session_id text NOT NULL,
      provider_session_id text NULL,
      provider_workspace_id text NULL,
      status text NOT NULL
    );
  `);
  return database;
}

describe('PostgresSessionAgentBindingLookup', () => {
  it('reads only the current active generation provider identity', async () => {
    const database = await transcriptDatabase();
    await database.query(
      `INSERT INTO runtime_sessions(id,current_generation_id) VALUES
        ('runtime-current','generation-current'),
        ('runtime-missing','generation-missing'),
        ('runtime-inactive','generation-inactive')`,
    );
    await database.query(
      `INSERT INTO runtime_session_generations(
         id,runtime_session_id,provider_session_id,provider_workspace_id,status
       ) VALUES
        ('generation-current','runtime-current','provider-current','workspace-current','active'),
        ('generation-stale','runtime-current','provider-stale','workspace-stale','superseded'),
        ('generation-missing','runtime-missing',NULL,'workspace-missing','active'),
        ('generation-inactive','runtime-inactive','provider-inactive','workspace-inactive','failed')`,
    );
    await database.query(
      `INSERT INTO team_member_runs(
         team_run_id,runtime_session_id,name,role,status,created_at
       ) VALUES
        ('team-run','runtime-current','Current','member','active',now()),
        ('team-run','runtime-missing','Missing','member','active',now()),
        ('team-run','runtime-inactive','Inactive','member','active',now())`,
    );

    const lookup = new PostgresSessionAgentBindingLookup(database);
    await expect(lookup.findBindings('team-run')).resolves.toEqual([
      {
        memberName: 'Current',
        role: 'member',
        status: 'active',
        providerAgentId: 'provider-current',
      },
    ]);
  });

  it('leaves the retired binding table absent after durable migrations', async () => {
    const database = new PGlite();
    await applyDurableKernelMigrations(database);
    const registered = await database.query<{ version: string }>(
      `SELECT version FROM durable_kernel_schema_migrations WHERE version=$1`,
      ['0057_drop_runtime_session_bindings'],
    );
    const result = await database.query<{ relation: string | null }>(
      `SELECT to_regclass('runtime_session_bindings') AS relation`,
    );
    expect(registered.rows).toEqual([
      { version: '0057_drop_runtime_session_bindings' },
    ]);
    expect(result.rows[0]?.relation ?? null).toBeNull();
  });
});
