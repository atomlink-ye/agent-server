import type {
  AgentRegistry,
  ImportAgentAtomicCommand,
  ListAgentVersionsCommand,
  ManagedAgentVersionPage,
  PublishAgentAtomicCommand,
} from '../../application/ports/agent-registry.js';
import {
  AgentNotFoundError,
  IdempotencyConflictError,
  InvalidAgentListCursorError,
  InvalidAgentListLimitError,
} from '../../application/agents/errors.js';
import type { AgentDefinition } from '../../domain/agents/managed-agent-definition.js';
import type { ManagedAgentOwner } from '../../domain/agents/managed-agent-owner.js';
import {
  canonicalizeManagedAgentJson,
  rehydrateManagedAgentPackage,
  type ManagedAgentPackage,
} from '../../domain/agents/managed-agent-package.js';
import type { ManagedAgentVersion } from '../../domain/agents/managed-agent-version.js';

export interface PostgresQueryable {
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{
    readonly rows?: readonly Row[];
    readonly rowCount?: number | null;
  }>;
}
export interface PostgresConnectable extends PostgresQueryable {
  connect(): Promise<PostgresClient>;
}
export interface PostgresClient extends PostgresQueryable {
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
  created_at: string | Date;
  updated_at: string | Date;
  role_label: string | null;
  summary: string | null;
};
type VersionRow = DefinitionRow & {
  definition_id: string;
  status: 'draft' | 'published';
  description: string | null;
  instructions: string;
  canonical_package: ManagedAgentPackage;
  fingerprint: string;
  pattern_metadata: Record<string, unknown>;
  compiler_metadata: Record<string, unknown>;
  policy_snapshot: { modelPolicyRef: string };
  reference_snapshot: { tools: readonly unknown[]; skills: readonly unknown[] };
  tool_skill_snapshot: {
    tools: readonly unknown[];
    skills: readonly unknown[];
  };
  validation_report: { valid: true; metadata: { normalizedName: string } };
  compiled_package: Record<string, unknown>;
  execution_snapshot: Record<string, unknown>;
  published_at: string | Date | null;
};
type IdempotencyRow = {
  request_fingerprint: string;
  definition_id: string | null;
  version_id: string | null;
};

export class PostgresAgentRegistry implements AgentRegistry {
  private queryOnlyTransactionTail: Promise<void> = Promise.resolve();

  public constructor(
    private readonly database: PostgresQueryable | PostgresConnectable,
  ) {}

  public importAgent(command: ImportAgentAtomicCommand) {
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
        const result = await loadImportResult(
          db,
          command.owner,
          claim.definition_id,
          claim.version_id,
        );
        return { kind: 'replayed' as const, ...result };
      }

      const definitionResult = await db.query<DefinitionRow>(
        `INSERT INTO agent_definitions
          (id, tenant_id, workspace_id, principal_type, principal_id, name, managed_discriminator, normalized_name, role_label, summary, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,'managed_agent_v1',$7,$8,$9,$10,$11)
         ON CONFLICT DO NOTHING
         RETURNING id, tenant_id, workspace_id, principal_type, principal_id, name, normalized_name, role_label, summary, created_at, updated_at`,
        [
          command.definition.id,
          command.owner.tenantId,
          command.compatibilityWorkspaceId,
          command.owner.principalType,
          command.owner.principalId,
          command.definition.displayName,
          command.normalizedName,
          command.definition.roleLabel,
          command.definition.summary,
          command.definition.createdAt,
          command.definition.updatedAt,
        ],
      );
      const definition =
        definitionResult.rows?.[0] ??
        (
          await db.query<DefinitionRow>(
            `SELECT id, tenant_id, workspace_id, principal_type, principal_id, name, normalized_name, role_label, summary, created_at, updated_at
           FROM agent_definitions WHERE tenant_id=$1 AND principal_type=$2 AND principal_id=$3 AND normalized_name=$4
             AND managed_discriminator='managed_agent_v1' FOR UPDATE`,
            ownerNameValues(command.owner, command.normalizedName),
          )
        ).rows?.[0];
      if (!definition)
        throw new Error('Managed agent definition could not be persisted.');

      const versionResult = await db.query<VersionRow>(
        `INSERT INTO agent_versions
          (id, definition_id, tenant_id, workspace_id, principal_type, principal_id, status, name, description, instructions,
           managed_discriminator, canonical_package, fingerprint, pattern_metadata, compiler_metadata, policy_snapshot,
           reference_snapshot, tool_skill_snapshot, validation_report, compiled_package, execution_snapshot,
           created_at, updated_at, published_at)
         VALUES ($1,$2,$3,$4,$5,$6,'draft',$7,$8,$9,'managed_agent_v1',$10::jsonb,$11,$12::jsonb,$13::jsonb,$14::jsonb,$15::jsonb,$16::jsonb,$17::jsonb,$18::jsonb,$19::jsonb,$20,$21,NULL)
         ON CONFLICT DO NOTHING
         RETURNING *`,
        versionValues(command, definition),
      );
      const version =
        versionResult.rows?.[0] ??
        (
          await db.query<VersionRow>(
            `SELECT * FROM agent_versions WHERE definition_id=$1 AND fingerprint=$2 AND managed_discriminator='managed_agent_v1' FOR UPDATE`,
            [definition.id, dbFingerprint(command.version.fingerprint)],
          )
        ).rows?.[0];
      if (!version)
        throw new Error('Managed agent version could not be persisted.');
      await db.query(
        `UPDATE agent_registry_idempotency SET definition_id=$6, version_id=$7, updated_at=GREATEST(created_at, now())
           WHERE operation='import' AND tenant_id=$1 AND principal_type=$2 AND principal_id=$3 AND idempotency_key=$4 AND request_fingerprint=$5`,
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

  public publishAgentVersion(
    command: PublishAgentAtomicCommand,
  ): Promise<ManagedAgentVersion> {
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
        const row = await this.loadVersion(
          db,
          command.owner,
          claim.version_id,
          false,
        );
        if (!row) throw new AgentNotFoundError();
        return mapVersion(row);
      }
      const rowResult = await db.query<VersionRow>(
        `SELECT * FROM agent_versions WHERE id=$1 AND tenant_id=$2 AND principal_type=$3 AND principal_id=$4
          AND managed_discriminator='managed_agent_v1' FOR UPDATE`,
        [
          command.versionId,
          command.owner.tenantId,
          command.owner.principalType,
          command.owner.principalId,
        ],
      );
      const row = rowResult.rows?.[0];
      if (!row) throw new AgentNotFoundError();
      let published = row;
      if (row.status === 'draft') {
        const result = await db.query<VersionRow>(
          `UPDATE agent_versions
             SET status='published', published_at=GREATEST(created_at, now()), updated_at=GREATEST(created_at, now())
           WHERE id=$1 RETURNING *`,
          [row.id],
        );
        published = result.rows?.[0] ?? row;
      }
      await db.query(
        `UPDATE agent_registry_idempotency SET definition_id=$6, version_id=$7, updated_at=now()
          WHERE operation='publish' AND tenant_id=$1 AND principal_type=$2 AND principal_id=$3 AND idempotency_key=$4 AND request_fingerprint=$5`,
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

  public async findDefinition(
    owner: ManagedAgentOwner,
    definitionId: string,
  ): Promise<AgentDefinition | null> {
    const result = await this.database.query<DefinitionRow>(
      `SELECT id,tenant_id,workspace_id,principal_type,principal_id,name,normalized_name,role_label,summary,created_at,updated_at FROM agent_definitions
       WHERE id=$1 AND tenant_id=$2 AND managed_discriminator='managed_agent_v1'`,
      [definitionId, owner.tenantId],
    );
    return result.rows?.[0] ? mapDefinition(result.rows[0]) : null;
  }

  public async findVersion(
    owner: ManagedAgentOwner,
    versionId: string,
  ): Promise<ManagedAgentVersion | null> {
    const result = await this.database.query<VersionRow>(
      `SELECT * FROM agent_versions WHERE id=$1 AND tenant_id=$2 AND managed_discriminator='managed_agent_v1'`,
      [versionId, owner.tenantId],
    );
    return result.rows?.[0] ? mapVersion(result.rows[0]) : null;
  }

  public async listVersionsForOwner(
    owner: ManagedAgentOwner,
    command: ListAgentVersionsCommand,
  ): Promise<ManagedAgentVersionPage | null> {
    if (
      !Number.isInteger(command.limit) ||
      command.limit < 1 ||
      command.limit > 100
    )
      throw new InvalidAgentListLimitError();
    const cursor = command.cursor ? decodeCursor(command.cursor) : null;
    const definition = await this.findDefinition(owner, command.definitionId);
    if (!definition) return null;
    const values: unknown[] = [
      command.definitionId,
      owner.tenantId,
      command.limit + 1,
    ];
    const cursorSql = cursor
      ? ` AND (created_at,id) > ($4::timestamptz,$5::uuid)`
      : '';
    if (cursor) values.push(cursor.createdAt, cursor.id);
    const result = await this.database.query<VersionRow>(
      `SELECT * FROM agent_versions WHERE definition_id=$1 AND tenant_id=$2
        AND managed_discriminator='managed_agent_v1'${cursorSql} ORDER BY created_at ASC,id ASC LIMIT $3`,
      values,
    );
    const rows = [...(result.rows ?? [])];
    const hasNext = rows.length > command.limit;
    const items = rows.slice(0, command.limit).map(mapVersion);
    const last = items[items.length - 1];
    return {
      items,
      nextCursor:
        hasNext && last ? encodeCursor(last.createdAt, last.id) : null,
    };
  }

  private async loadVersion(
    db: PostgresQueryable,
    owner: ManagedAgentOwner,
    id: string,
    lock: boolean,
  ): Promise<VersionRow | null> {
    const result = await db.query<VersionRow>(
      `SELECT * FROM agent_versions WHERE id=$1 AND tenant_id=$2 AND managed_discriminator='managed_agent_v1'${lock ? ' FOR UPDATE' : ''}`,
      [id, owner.tenantId],
    );
    return result.rows?.[0] ?? null;
  }

  private async transaction<T>(
    work: (db: PostgresQueryable) => Promise<T>,
  ): Promise<T> {
    const connectable =
      'connect' in this.database && typeof this.database.connect === 'function';
    if (!connectable) {
      let result!: T;
      let failure: unknown;
      const run = this.queryOnlyTransactionTail.then(async () => {
        try {
          result = await this.runTransaction(this.database, work);
        } catch (error) {
          failure = error;
        }
      });
      this.queryOnlyTransactionTail = run.then(() => undefined);
      await run;
      if (failure !== undefined) throw failure;
      return result;
    }

    const connected = await (this.database as PostgresConnectable).connect();
    try {
      return await this.runTransaction(connected, work);
    } finally {
      connected.release();
    }
  }

  private async runTransaction<T>(
    client: PostgresQueryable,
    work: (db: PostgresQueryable) => Promise<T>,
  ): Promise<T> {
    let began = false;
    try {
      await client.query('BEGIN');
      began = true;
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      if (began) await this.bestEffortRollback(client, began);
      throw error;
    }
  }

  private async bestEffortRollback(
    client: PostgresQueryable,
    began: boolean,
  ): Promise<void> {
    if (!began) return;
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the original work/commit error.
    }
  }
}

async function claimIdempotency(
  db: PostgresQueryable,
  operation: string,
  owner: ManagedAgentOwner,
  key: string,
  fingerprint: string,
): Promise<IdempotencyRow> {
  await db.query(
    `INSERT INTO agent_registry_idempotency (operation,tenant_id,principal_type,principal_id,idempotency_key,request_fingerprint,created_at,updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,now(),now()) ON CONFLICT (operation,tenant_id,principal_type,principal_id,idempotency_key) DO NOTHING`,
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
    `SELECT request_fingerprint,definition_id,version_id FROM agent_registry_idempotency WHERE operation=$1 AND tenant_id=$2 AND principal_type=$3 AND principal_id=$4 AND idempotency_key=$5 FOR UPDATE`,
    [operation, owner.tenantId, owner.principalType, owner.principalId, key],
  );
  if (!result.rows?.[0])
    throw new Error('Idempotency claim could not be persisted.');
  return result.rows[0];
}
function ownerNameValues(
  owner: ManagedAgentOwner,
  name: string,
): readonly unknown[] {
  return [owner.tenantId, owner.principalType, owner.principalId, name];
}
function versionValues(
  command: ImportAgentAtomicCommand,
  definition: DefinitionRow,
): readonly unknown[] {
  const v = command.version;
  return [
    v.id,
    definition.id,
    definition.tenant_id,
    definition.workspace_id,
    definition.principal_type,
    definition.principal_id,
    v.displayName,
    v.package.spec.description,
    v.package.spec.instructions,
    JSON.stringify(v.package),
    dbFingerprint(v.fingerprint),
    JSON.stringify(v.compiler),
    JSON.stringify(v.compiler),
    JSON.stringify(v.policySnapshot),
    JSON.stringify(v.referenceSnapshot),
    JSON.stringify(v.referenceSnapshot),
    JSON.stringify(v.validationSnapshot),
    JSON.stringify({ canonicalJson: v.canonicalJson }),
    JSON.stringify({
      provider: v.package.spec.runtime.provider,
      mode: v.package.spec.runtime.mode,
    }),
    v.createdAt,
    v.updatedAt,
  ];
}
async function loadImportResult(
  db: PostgresQueryable,
  owner: ManagedAgentOwner,
  definitionId: string,
  versionId: string,
) {
  const d = await db.query<DefinitionRow>(
    `SELECT id,tenant_id,workspace_id,principal_type,principal_id,name,normalized_name,role_label,summary,created_at,updated_at FROM agent_definitions WHERE id=$1 AND tenant_id=$2 AND managed_discriminator='managed_agent_v1'`,
    [definitionId, owner.tenantId],
  );
  const v = await db.query<VersionRow>(
    `SELECT * FROM agent_versions WHERE id=$1 AND tenant_id=$2 AND managed_discriminator='managed_agent_v1'`,
    [versionId, owner.tenantId],
  );
  if (!d.rows?.[0] || !v.rows?.[0]) throw new AgentNotFoundError();
  return {
    definition: mapDefinition(d.rows[0]),
    version: mapVersion(v.rows[0]),
  };
}
function mapDefinition(row: DefinitionRow): AgentDefinition {
  return Object.freeze({
    id: row.id,
    tenantId: row.tenant_id,
    principalType: row.principal_type,
    principalId: row.principal_id,
    normalizedName: row.normalized_name,
    displayName: row.name,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    roleLabel: row.role_label ?? null,
    summary: row.summary ?? null,
  });
}
function mapVersion(row: VersionRow): ManagedAgentVersion {
  const pkg = rehydrateManagedAgentPackage(row.canonical_package);
  return deepFreeze({
    id: row.id,
    definitionId: row.definition_id,
    tenantId: row.tenant_id,
    principalType: row.principal_type,
    principalId: row.principal_id,
    status: row.status,
    displayName: row.name,
    package: pkg,
    canonicalJson: canonicalizeManagedAgentJson(pkg),
    fingerprint: row.fingerprint.startsWith('sha256:')
      ? row.fingerprint
      : `sha256:${row.fingerprint}`,
    compiler: row.compiler_metadata as ManagedAgentVersion['compiler'],
    policySnapshot: row.policy_snapshot,
    referenceSnapshot: row.reference_snapshot,
    validationSnapshot: row.validation_report,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    publishedAt: row.published_at ? iso(row.published_at) : null,
  });
}
function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}
function dbFingerprint(value: string): string {
  return value.startsWith('sha256:') ? value.slice('sha256:'.length) : value;
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value as object)) deepFreeze(child);
  }
  return value;
}
function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify([createdAt, id]), 'utf8').toString(
    'base64url',
  );
}
function decodeCursor(value: string): { createdAt: string; id: string } {
  try {
    const decoded = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    );
    if (
      !Array.isArray(decoded) ||
      decoded.length !== 2 ||
      typeof decoded[0] !== 'string' ||
      typeof decoded[1] !== 'string' ||
      decoded[0] !== new Date(decoded[0]).toISOString() ||
      !isCanonicalUuid(decoded[1])
    )
      throw new Error();
    return { createdAt: decoded[0], id: decoded[1] };
  } catch {
    throw new InvalidAgentListCursorError();
  }
}

function isCanonicalUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
