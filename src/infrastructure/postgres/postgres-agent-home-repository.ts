import type {
  AgentHomeRepository,
  ListAgentHomeEntriesInput,
  ReadAgentHomeEntryInput,
  WriteAgentHomeEntryInput,
} from '../../application/ports/agent-home-repository.js';
import { AgentHomeContextAdapter } from '../../application/context/agent-home-context-adapter.js';
import { PostgresLogicalFileStore } from './postgres-logical-file-store.js';

type Database = ConstructorParameters<typeof PostgresLogicalFileStore>[0];

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
