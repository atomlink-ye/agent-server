import type { ComputerRepository } from '../../application/ports/computer-repository.js';
import type { Computer, ComputerKind } from '../../domain/runtime/computer.js';
import type {
  PostgresClient,
  PostgresConnectable,
  PostgresQueryable,
} from './postgres-agent-registry.js';

type ComputerRow = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  kind: ComputerKind;
  name: string;
  status: 'online' | 'offline';
  created_at: string | Date;
  updated_at: string | Date;
};

export class PostgresComputerRepository implements ComputerRepository {
  public constructor(
    private readonly database: PostgresQueryable | PostgresConnectable,
  ) {}

  public async create(computer: Computer): Promise<Computer> {
    const result = await this.query<ComputerRow>(
      `INSERT INTO computers
         (id, tenant_id, workspace_id, kind, name, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, tenant_id, workspace_id, kind, name, status, created_at, updated_at`,
      [
        computer.id,
        computer.tenantId,
        computer.workspaceId,
        computer.kind,
        computer.name,
        computer.status,
        computer.createdAt,
        computer.updatedAt,
      ],
    );
    const row = result.rows?.[0];
    if (!row) throw new Error('Computer could not be persisted.');
    return mapComputer(row);
  }

  public async findById(input: {
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly id: string;
  }): Promise<Computer | null> {
    const result = await this.query<ComputerRow>(
      `SELECT id, tenant_id, workspace_id, kind, name, status, created_at, updated_at
         FROM computers
        WHERE id=$1 AND tenant_id=$2 AND workspace_id=$3`,
      [input.id, input.tenantId, input.workspaceId],
    );
    return result.rows?.[0] ? mapComputer(result.rows[0]) : null;
  }

  private async query<Row extends Record<string, unknown>>(
    sql: string,
    values: readonly unknown[],
  ): Promise<{
    readonly rows?: readonly Row[];
    readonly rowCount?: number | null;
  }> {
    const connectable =
      'connect' in this.database && typeof this.database.connect === 'function';
    if (!connectable) return this.database.query<Row>(sql, values);
    const client: PostgresClient = await (
      this.database as PostgresConnectable
    ).connect();
    try {
      return await client.query<Row>(sql, values);
    } finally {
      client.release();
    }
  }
}

function mapComputer(row: ComputerRow): Computer {
  return Object.freeze({
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    kind: row.kind,
    name: row.name,
    status: row.status,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });
}

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}
