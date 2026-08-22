import type {
  AgentHomeDefinitionEntry,
  AgentHomeDefinitionSource,
} from '../../application/ports/agent-home-definition-source.js';

interface Queryable {
  query<T = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{ rows?: readonly T[] }>;
}

type Database = Queryable | (Queryable & { connect(): Promise<Queryable> });

type AgentVersionRow = {
  description: string | null;
  instructions: string;
};

export class PostgresAgentHomeDefinitionSource implements AgentHomeDefinitionSource {
  public constructor(private readonly database: Database) {}

  public async readDefinition(
    tenantId: string,
    agentDefinitionId: string,
  ): Promise<readonly AgentHomeDefinitionEntry[] | null> {
    const result = await this.database.query<AgentVersionRow>(
      `SELECT description, instructions FROM agent_versions
       WHERE definition_id = $1 AND tenant_id = $2
       ORDER BY
         CASE WHEN status = 'published' THEN 0 ELSE 1 END ASC,
         published_at DESC NULLS LAST,
         created_at DESC
       LIMIT 1`,
      [agentDefinitionId, tenantId],
    );

    const row = result.rows?.[0];
    if (!row) return null;

    return [
      {
        path: 'instructions/README.md',
        content: row.instructions,
      },
      {
        path: 'metadata.json',
        content: JSON.stringify({
          description: row.description,
        }),
      },
    ];
  }
}
