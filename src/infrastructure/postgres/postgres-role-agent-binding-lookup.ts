/**
 * Resolves roster member names to Paseo agent ids.
 *
 * The hop is two steps, not one: `team_member_runs.runtime_session_id` is a
 * uuid into our own `runtime_sessions`, and the Paseo agent id is that row's
 * `provider_agent_id`. Members whose session has not yet been created, or whose
 * session has no provider agent, are omitted rather than returned with a null
 * id - a caller asking for a transcript cannot do anything with such a row.
 *
 * Read-only: one SELECT, no writes.
 */

import type {
  RoleAgentBinding,
  RoleAgentBindingLookup,
} from '../../adapters/paseo/role-transcript-reader.js';

interface Row {
  readonly name: string;
  readonly role: string;
  readonly status: string;
  readonly provider_agent_id: string;
}

export class PostgresRoleAgentBindingLookup implements RoleAgentBindingLookup {
  public constructor(
    private readonly db: {
      query(
        sql: string,
        values?: readonly unknown[],
      ): Promise<{ rows?: readonly Row[] }>;
    },
  ) {}

  public async findBindings(
    teamRunId: string,
  ): Promise<readonly RoleAgentBinding[]> {
    const result = await this.db.query(
      `SELECT m.name, m.role, m.status, s.provider_agent_id
         FROM team_member_runs m
         JOIN runtime_sessions s ON s.id = m.runtime_session_id
        WHERE m.team_run_id = $1
          AND s.provider_agent_id IS NOT NULL
        ORDER BY m.created_at`,
      [teamRunId],
    );
    return (result.rows ?? []).map((row) => ({
      memberName: row.name,
      role: row.role,
      status: row.status,
      providerAgentId: row.provider_agent_id,
    }));
  }
}
