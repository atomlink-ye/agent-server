import type { AgentHomeRepository } from '../../application/ports/agent-home-repository.js';
import { AgentHomeContextAdapter } from '../../application/context/agent-home-context-adapter.js';
import { PostgresLogicalFileStore } from './postgres-logical-file-store.js';

interface Queryable {
  query<T = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{ rows?: readonly T[]; rowCount?: number | null }>;
}

type Database = Queryable;

export class PostgresAgentHomeRepository implements AgentHomeRepository {
  private readonly adapter: AgentHomeContextAdapter;

  public constructor(database: Database) {
    this.adapter = new AgentHomeContextAdapter(
      new PostgresLogicalFileStore(database),
    );
  }

  public list(input: ListAgentHomeEntriesInput) {
    return this.adapter.list(input);
  }

  public read(input: ReadAgentHomeEntryInput) {
    return this.adapter.read(input);
  }

  public write(input: WriteAgentHomeEntryInput) {
    return this.adapter.write(input);
  }
}
