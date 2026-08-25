import type {
  ImportWorkerAtomicCommand,
  PublishWorkerAtomicCommand,
  WorkerRegistry,
} from '../../application/ports/worker-registry.js';
import {
  IdempotencyConflictError,
  AgentNotFoundError,
} from '../../application/agents/errors.js';
import type { WorkerDefinition } from '../../domain/workers/worker-definition.js';
import type { WorkerOwner } from '../../domain/workers/worker-owner.js';
import {
  rehydrateWorkerPackage,
  type WorkerPackage,
} from '../../domain/workers/worker-package.js';
import type { WorkerVersion } from '../../domain/workers/worker-version.js';

export interface WorkerRegistryQueryable {
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{
    readonly rows?: readonly Row[];
    readonly rowCount?: number | null;
  }>;
}

export interface WorkerRegistryConnectable extends WorkerRegistryQueryable {
  connect(): Promise<WorkerRegistryClient>;
}

export interface WorkerRegistryClient extends WorkerRegistryQueryable {
  release(): void;
}

type DefinitionRow = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  principal_type: string;
  principal_id: string;
  name: string;
  normalized_name: string;
  description: string | null;
  created_at: string | Date;
  updated_at: string | Date;
};

type VersionRow = {
  id: string;
  definition_id: string;
  tenant_id: string;
  workspace_id: string;
  principal_type: string;
  principal_id: string;
  status: 'draft' | 'published';
  name: string;
  description: string | null;
  instructions: string;
  canonical_package: WorkerPackage;
  fingerprint: string;
  compiler_metadata: Record<string, unknown>;
  created_at: string | Date;
  updated_at: string | Date;
  published_at: string | Date | null;
};

type IdempotencyRow = {
  request_fingerprint: string;
  definition_id: string | null;
  version_id: string | null;
};

/** Concrete storage adapter for the formal Work Worker namespace. */
export class PostgresWorkerRegistry implements WorkerRegistry {
  private queryOnlyTail: Promise<void> = Promise.resolve();

  public constructor(
    private readonly database:
      WorkerRegistryQueryable | WorkerRegistryConnectable,
  ) {}

  public importWorker(command: ImportWorkerAtomicCommand) {
    return this.transaction(async (db) => {
      const claim = await claimIdempotency(
        db,
        'import',
        command.owner,
        command.idempotencyKey,
        command.requestFingerprint,
      );
      if (claim.request_fingerprint !== command.requestFingerprint)
        throw new IdempotencyConflictError();
      if (claim.definition_id && claim.version_id) {
        const replay = await loadResult(
          db,
          command.owner,
          claim.definition_id,
          claim.version_id,
        );
        return { kind: 'replayed' as const, ...replay };
      }

      const definitionInsert = await db.query<DefinitionRow>(
        `INSERT INTO worker_definitions
          (id,tenant_id,workspace_id,principal_type,principal_id,name,normalized_name,description,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT DO NOTHING
         RETURNING *`,
        [
          command.definition.id,
          command.owner.tenantId,
          command.owner.workspaceId,
          command.owner.principalType,
          command.owner.principalId,
          command.definition.displayName,
          command.normalizedName,
          command.definition.description,
          command.definition.createdAt,
          command.definition.updatedAt,
        ],
      );
      const definition =
        definitionInsert.rows?.[0] ??
        (
          await db.query<DefinitionRow>(
            `SELECT * FROM worker_definitions
             WHERE tenant_id=$1 AND principal_type=$2 AND principal_id=$3
               AND normalized_name=$4 FOR UPDATE`,
            [
              command.owner.tenantId,
              command.owner.principalType,
              command.owner.principalId,
              command.normalizedName,
            ],
          )
        ).rows?.[0];
      if (!definition)
        throw new Error('Worker definition could not be persisted.');

      const versionInsert = await db.query<VersionRow>(
        `INSERT INTO worker_versions
          (id,definition_id,tenant_id,workspace_id,principal_type,principal_id,status,
           name,description,instructions,canonical_package,fingerprint,compiler_metadata,
           created_at,updated_at,published_at)
         VALUES ($1,$2,$3,$4,$5,$6,'draft',$7,$8,$9,$10::jsonb,$11,$12::jsonb,$13,$14,NULL)
         ON CONFLICT DO NOTHING
         RETURNING *`,
        [
          command.version.id,
          definition.id,
          definition.tenant_id,
          definition.workspace_id,
          definition.principal_type,
          definition.principal_id,
          command.version.displayName,
          command.version.description,
          command.version.package.spec.instructions,
          JSON.stringify(command.version.package),
          dbFingerprint(command.version.fingerprint),
          JSON.stringify(command.version.compiler),
          command.version.createdAt,
          command.version.updatedAt,
        ],
      );
      const version =
        versionInsert.rows?.[0] ??
        (
          await db.query<VersionRow>(
            `SELECT * FROM worker_versions
             WHERE definition_id=$1 AND fingerprint=$2 FOR UPDATE`,
            [definition.id, dbFingerprint(command.version.fingerprint)],
          )
        ).rows?.[0];
      if (!version) throw new Error('Worker version could not be persisted.');

      await db.query(
        `UPDATE worker_registry_idempotency
            SET definition_id=$6,version_id=$7,updated_at=GREATEST(created_at,now())
          WHERE operation='import' AND tenant_id=$1 AND principal_type=$2
            AND principal_id=$3 AND idempotency_key=$4 AND request_fingerprint=$5`,
        [
          command.owner.tenantId,
          command.owner.principalType,
          command.owner.principalId,
          command.idempotencyKey,
          command.requestFingerprint,
          definition.id,
          version.id,
        ],
      );
      return {
        kind:
          definition.id === command.definition.id &&
          version.id === command.version.id
            ? ('created' as const)
            : ('converged' as const),
        definition: mapDefinition(definition),
        version: mapVersion(version),
      };
    });
  }

  public publishWorkerVersion(
    command: PublishWorkerAtomicCommand,
  ): Promise<WorkerVersion> {
    return this.transaction(async (db) => {
      const claim = await claimIdempotency(
        db,
        'publish',
        command.owner,
        command.idempotencyKey,
        command.requestFingerprint,
      );
      if (claim.request_fingerprint !== command.requestFingerprint)
        throw new IdempotencyConflictError();
      if (claim.version_id) {
        const row = await loadVersion(
          db,
          command.owner,
          claim.version_id,
          false,
        );
        if (!row) throw new AgentNotFoundError();
        return mapVersion(row);
      }
      const result = await db.query<VersionRow>(
        `SELECT * FROM worker_versions
          WHERE id=$1 AND tenant_id=$2 AND workspace_id=$3
            AND principal_type=$4 AND principal_id=$5 FOR UPDATE`,
        [
          command.versionId,
          command.owner.tenantId,
          command.owner.workspaceId,
          command.owner.principalType,
          command.owner.principalId,
        ],
      );
      const row = result.rows?.[0];
      if (!row) throw new AgentNotFoundError();
      const published =
        row.status === 'draft'
          ? ((
              await db.query<VersionRow>(
                `UPDATE worker_versions
                    SET status='published',published_at=GREATEST(created_at,now()),
                        updated_at=GREATEST(created_at,now())
                  WHERE id=$1 RETURNING *`,
                [row.id],
              )
            ).rows?.[0] ?? row)
          : row;
      await db.query(
        `UPDATE worker_registry_idempotency SET definition_id=$6,version_id=$7,updated_at=now()
          WHERE operation='publish' AND tenant_id=$1 AND principal_type=$2
            AND principal_id=$3 AND idempotency_key=$4 AND request_fingerprint=$5`,
        [
          command.owner.tenantId,
          command.owner.principalType,
          command.owner.principalId,
          command.idempotencyKey,
          command.requestFingerprint,
          published.definition_id,
          published.id,
        ],
      );
      return mapVersion(published);
    });
  }

  public async findDefinition(owner: WorkerOwner, definitionId: string) {
    const result = await this.database.query<DefinitionRow>(
      `SELECT * FROM worker_definitions WHERE id=$1 AND tenant_id=$2 AND workspace_id=$3
       AND principal_type=$4 AND principal_id=$5`,
      [
        definitionId,
        owner.tenantId,
        owner.workspaceId,
        owner.principalType,
        owner.principalId,
      ],
    );
    return result.rows?.[0] ? mapDefinition(result.rows[0]) : null;
  }

  public async findVersion(owner: WorkerOwner, versionId: string) {
    const result = await this.database.query<VersionRow>(
      `SELECT * FROM worker_versions WHERE id=$1 AND tenant_id=$2 AND workspace_id=$3
       AND principal_type=$4 AND principal_id=$5`,
      [
        versionId,
        owner.tenantId,
        owner.workspaceId,
        owner.principalType,
        owner.principalId,
      ],
    );
    return result.rows?.[0] ? mapVersion(result.rows[0]) : null;
  }

  public async findVersionByTenant(input: {
    tenantId: string;
    versionId: string;
  }) {
    const result = await this.database.query<VersionRow>(
      `SELECT * FROM worker_versions WHERE id=$1 AND tenant_id=$2`,
      [input.versionId, input.tenantId],
    );
    return result.rows?.[0] ? mapVersion(result.rows[0]) : null;
  }

  private async transaction<T>(
    work: (db: WorkerRegistryQueryable) => Promise<T>,
  ): Promise<T> {
    if (
      'connect' in this.database &&
      typeof this.database.connect === 'function'
    ) {
      const client = await this.database.connect();
      try {
        return await runTransaction(client, work);
      } finally {
        client.release();
      }
    }
    let result!: T;
    let failure: unknown;
    const run = this.queryOnlyTail.then(async () => {
      try {
        result = await runTransaction(this.database, work);
      } catch (error) {
        failure = error;
      }
    });
    this.queryOnlyTail = run.then(() => undefined);
    await run;
    if (failure !== undefined) throw failure;
    return result;
  }
}

async function runTransaction<T>(
  db: WorkerRegistryQueryable,
  work: (db: WorkerRegistryQueryable) => Promise<T>,
): Promise<T> {
  await db.query('BEGIN');
  try {
    const result = await work(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

async function claimIdempotency(
  db: WorkerRegistryQueryable,
  operation: 'import' | 'publish',
  owner: WorkerOwner,
  key: string,
  fingerprint: string,
): Promise<IdempotencyRow> {
  await db.query(
    `INSERT INTO worker_registry_idempotency
      (operation,tenant_id,principal_type,principal_id,idempotency_key,request_fingerprint,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,now(),now()) ON CONFLICT DO NOTHING`,
    [
      operation,
      owner.tenantId,
      owner.principalType,
      owner.principalId,
      key,
      fingerprint,
    ],
  );
  const result = await db.query<IdempotencyRow>(
    `SELECT request_fingerprint,definition_id,version_id FROM worker_registry_idempotency
      WHERE operation=$1 AND tenant_id=$2 AND principal_type=$3 AND principal_id=$4
        AND idempotency_key=$5 FOR UPDATE`,
    [operation, owner.tenantId, owner.principalType, owner.principalId, key],
  );
  if (!result.rows?.[0])
    throw new Error('Worker idempotency claim could not be persisted.');
  return result.rows[0];
}

async function loadResult(
  db: WorkerRegistryQueryable,
  owner: WorkerOwner,
  definitionId: string,
  versionId: string,
) {
  const [definition, version] = await Promise.all([
    db.query<DefinitionRow>(
      `SELECT * FROM worker_definitions WHERE id=$1 AND tenant_id=$2 AND workspace_id=$3 AND principal_type=$4 AND principal_id=$5`,
      [
        definitionId,
        owner.tenantId,
        owner.workspaceId,
        owner.principalType,
        owner.principalId,
      ],
    ),
    db.query<VersionRow>(
      `SELECT * FROM worker_versions WHERE id=$1 AND tenant_id=$2 AND workspace_id=$3 AND principal_type=$4 AND principal_id=$5`,
      [
        versionId,
        owner.tenantId,
        owner.workspaceId,
        owner.principalType,
        owner.principalId,
      ],
    ),
  ]);
  if (!definition.rows?.[0] || !version.rows?.[0])
    throw new AgentNotFoundError();
  return {
    definition: mapDefinition(definition.rows[0]),
    version: mapVersion(version.rows[0]),
  };
}

async function loadVersion(
  db: WorkerRegistryQueryable,
  owner: WorkerOwner,
  id: string,
  lock: boolean,
) {
  const result = await db.query<VersionRow>(
    `SELECT * FROM worker_versions WHERE id=$1 AND tenant_id=$2 AND workspace_id=$3 AND principal_type=$4 AND principal_id=$5${lock ? ' FOR UPDATE' : ''}`,
    [
      id,
      owner.tenantId,
      owner.workspaceId,
      owner.principalType,
      owner.principalId,
    ],
  );
  return result.rows?.[0] ?? null;
}

function mapDefinition(row: DefinitionRow): WorkerDefinition {
  return Object.freeze({
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    principalType: row.principal_type,
    principalId: row.principal_id,
    normalizedName: row.normalized_name,
    displayName: row.name,
    description: row.description,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });
}

function mapVersion(row: VersionRow): WorkerVersion {
  const pkg = rehydrateWorkerPackage(row.canonical_package);
  return Object.freeze({
    id: row.id,
    definitionId: row.definition_id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    principalType: row.principal_type,
    principalId: row.principal_id,
    status: row.status,
    displayName: row.name,
    description: row.description,
    package: pkg,
    canonicalJson: JSON.stringify(pkg),
    fingerprint: row.fingerprint.startsWith('sha256:')
      ? row.fingerprint
      : `sha256:${row.fingerprint}`,
    compiler: row.compiler_metadata as WorkerVersion['compiler'],
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    publishedAt: row.published_at ? iso(row.published_at) : null,
  });
}

function dbFingerprint(value: string): string {
  return value.startsWith('sha256:') ? value.slice('sha256:'.length) : value;
}
function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}
