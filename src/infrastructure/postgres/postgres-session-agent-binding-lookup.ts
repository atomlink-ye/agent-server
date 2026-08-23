/**
 * Resolves roster member names to Paseo agent ids.
 *
 * Provider identity is read only through the current active generation:
 * `team_member_runs.runtime_session_id` -> `runtime_sessions.current_generation_id`
 * -> `runtime_session_generations.provider_session_id`. Members whose session,
 * current generation, or provider identity is missing/inactive are omitted
 * rather than returned with a null id.
 *
 * Read-only: one SELECT, no writes.
 */

import type {
  SessionAgentBinding,
  SessionAgentBindingLookup,
} from '../../adapters/paseo/session-transcript-reader.js';

interface Row {
  readonly name: string;
  readonly role: string;
  readonly status: string;
  readonly provider_session_id: string | null;
  readonly provider_workspace_id: string | null;
}

export class PostgresSessionAgentBindingLookup implements SessionAgentBindingLookup {
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
  ): Promise<readonly SessionAgentBinding[]> {
    const result = await this.db.query(
      `SELECT m.name, m.role, m.status, g.provider_session_id,
              g.provider_workspace_id
         FROM team_member_runs m
         JOIN runtime_sessions s ON s.id = m.runtime_session_id
         JOIN runtime_session_generations g
           ON g.id = s.current_generation_id
          AND g.runtime_session_id = s.id
        WHERE m.team_run_id = $1
          AND s.current_generation_id IS NOT NULL
          AND g.status = 'active'
          AND g.provider_session_id IS NOT NULL
          AND g.provider_workspace_id IS NOT NULL
        ORDER BY m.created_at`,
      [teamRunId],
    );
    return (result.rows ?? [])
      .filter(
        (
          row,
        ): row is Row & {
          readonly provider_session_id: string;
          readonly provider_workspace_id: string;
        } =>
          typeof row.provider_session_id === 'string' &&
          row.provider_session_id.length > 0 &&
          typeof row.provider_workspace_id === 'string' &&
          row.provider_workspace_id.length > 0,
      )
      .map((row) => ({
        memberName: row.name,
        role: row.role,
        status: row.status,
        providerAgentId: row.provider_session_id,
      }));
  }
}
