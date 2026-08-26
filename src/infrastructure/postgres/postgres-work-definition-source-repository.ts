import type {
  ProductWorkDefinitionVersionRecord,
  PublishWorkDefinitionSourceInput,
  WorkDefinitionApplyRequestRecord,
  WorkDefinitionSourceOwner,
  WorkDefinitionSourceRepository,
  WorkDefinitionVersionListPage,
} from '../../application/ports/work-definition-source-repository.js';
import { canonicalizeProjectValue } from '../../domain/projects/project-canonicalization.js';
import {
  fingerprintWorkDefinitionSource,
  validateWorkDefinitionCompositionSource,
  type WorkDefinitionSourceDefinition,
  type WorkDefinitionSourceVersion,
  type WorkDefinitionCompositionSource,
} from '../../domain/work/work-definition-source.js';
interface Queryable {
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rows?: readonly Row[] }>;
}

type DefinitionRow = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  principal_type: string;
  principal_id: string;
  name: string;
  description: string | null;
  created_at: string | Date;
};

type VersionRow = {
  id: string;
  definition_id: string;
  tenant_id: string;
  workspace_id: string;
  principal_type: string;
  principal_id: string;
  status: 'published';
  source: WorkDefinitionCompositionSource;
  fingerprint: string;
  author_source: Readonly<Record<string, unknown>> | null;
  author_fingerprint: string | null;
  created_at: string | Date;
  published_at: string | Date;
};

type ProductVersionRow = VersionRow & {
  product_resolved_fingerprint: string | null;
};

type ApplyRequestRow = {
  idempotency_key: string;
  request_fingerprint: string;
  definition_id: string;
  version_id: string;
  resolved_fingerprint: string;
  created_at: string | Date;
};

const definitionColumns =
  'id,tenant_id,workspace_id,principal_type,principal_id,name,description,created_at';
const versionColumns =
  'id,definition_id,tenant_id,workspace_id,principal_type,principal_id,status,source,fingerprint,author_source,author_fingerprint,created_at,published_at';

export class PostgresWorkDefinitionSourceRepository implements WorkDefinitionSourceRepository {
  public constructor(private readonly db: Queryable) {}

  public async findDefinition(
    id: string,
    owner: WorkDefinitionSourceOwner,
  ): Promise<WorkDefinitionSourceDefinition | null> {
    const result = await this.db.query<DefinitionRow>(
      `SELECT ${definitionColumns}
         FROM work_definition_source_definitions
        WHERE id=$1 AND tenant_id=$2 AND workspace_id=$3
          AND principal_type=$4 AND principal_id=$5`,
      ownerValues(id, owner),
    );
    return result.rows?.[0] ? mapDefinition(result.rows[0]) : null;
  }

  public async findPublishedVersion(
    id: string,
    owner: WorkDefinitionSourceOwner,
  ): Promise<WorkDefinitionSourceVersion | null> {
    const result = await this.db.query<VersionRow>(
      `SELECT ${versionColumns}
         FROM work_definition_source_versions
        WHERE id=$1 AND tenant_id=$2 AND workspace_id=$3
          AND principal_type=$4 AND principal_id=$5 AND status='published'`,
      ownerValues(id, owner),
    );
    return result.rows?.[0] ? mapVersion(result.rows[0]) : null;
  }

  public async publish(input: PublishWorkDefinitionSourceInput) {
    const source = validateWorkDefinitionCompositionSource(input.source);
    const expectedFingerprint = fingerprintWorkDefinitionSource(source);
    if (input.fingerprint !== expectedFingerprint)
      throw new Error('Work Definition source fingerprint mismatch.');
    if (
      (input.authorSource === undefined) !==
      (input.authorFingerprint === undefined)
    )
      throw new Error('Work Definition Product author metadata is incomplete.');

    await this.db.query(
      `INSERT INTO work_definition_source_definitions
       (id,tenant_id,workspace_id,principal_type,principal_id,name,description,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO NOTHING`,
      [
        input.definitionId,
        input.owner.tenantId,
        input.owner.workspaceId,
        input.owner.principalType,
        input.owner.principalId,
        input.name,
        input.description,
        input.now,
      ],
    );
    const definition = await this.findDefinition(
      input.definitionId,
      input.owner,
    );
    if (
      !definition ||
      definition.name !== input.name ||
      (input.authorFingerprint === undefined &&
        definition.description !== input.description)
    )
      throw new Error('Work Definition source identity conflict.');

    await this.db.query(
      `INSERT INTO work_definition_source_versions
       (id,definition_id,tenant_id,workspace_id,principal_type,principal_id,status,
        source,fingerprint,author_source,author_fingerprint,created_at,published_at)
       VALUES ($1,$2,$3,$4,$5,$6,'published',$7::jsonb,$8,$9::jsonb,$10,$11,$11)
       ON CONFLICT (id) DO NOTHING`,
      [
        input.versionId,
        input.definitionId,
        input.owner.tenantId,
        input.owner.workspaceId,
        input.owner.principalType,
        input.owner.principalId,
        JSON.stringify(source),
        input.fingerprint,
        input.authorSource === undefined
          ? null
          : JSON.stringify(input.authorSource),
        input.authorFingerprint ?? null,
        input.now,
      ],
    );
    const version = await this.findPublishedVersion(
      input.versionId,
      input.owner,
    );
    if (
      !version ||
      version.definitionId !== input.definitionId ||
      version.fingerprint !== input.fingerprint ||
      canonicalizeProjectValue(version.source) !==
        canonicalizeProjectValue(source)
    )
      throw new Error('Work Definition source version conflict.');
    if (input.authorFingerprint !== undefined) {
      const product = await this.findProductVersion(version.id, input.owner);
      if (
        !product ||
        product.authorFingerprint !== input.authorFingerprint ||
        canonicalizeProjectValue(product.authorSource) !==
          canonicalizeProjectValue(input.authorSource)
      )
        throw new Error('Work Definition Product source version conflict.');
    }
    return { definition, version };
  }

  public async findProductVersion(
    id: string,
    owner: WorkDefinitionSourceOwner,
  ): Promise<ProductWorkDefinitionVersionRecord | null> {
    const result = await this.db.query<ProductVersionRow>(
      productVersionSelect(
        `v.id=$1 AND v.tenant_id=$2 AND v.workspace_id=$3
         AND v.principal_type=$4 AND v.principal_id=$5`,
      ),
      ownerValues(id, owner),
    );
    const row = result.rows?.[0];
    if (!row || !row.author_source || !row.author_fingerprint) return null;
    return mapProductVersion(row);
  }

  public async findProductVersionByAuthorFingerprint(input: {
    readonly definitionId: string;
    readonly owner: WorkDefinitionSourceOwner;
    readonly authorFingerprint: string;
  }): Promise<ProductWorkDefinitionVersionRecord | null> {
    const result = await this.db.query<ProductVersionRow>(
      productVersionSelect(
        `v.definition_id=$1 AND v.tenant_id=$2 AND v.workspace_id=$3
         AND v.principal_type=$4 AND v.principal_id=$5
         AND v.author_fingerprint=$6`,
      ),
      [
        input.definitionId,
        input.owner.tenantId,
        input.owner.workspaceId,
        input.owner.principalType,
        input.owner.principalId,
        input.authorFingerprint,
      ],
    );
    return result.rows?.[0] ? mapProductVersion(result.rows[0]) : null;
  }

  public async listProductVersions(input: {
    readonly definitionId: string;
    readonly owner: WorkDefinitionSourceOwner;
    readonly limit: number;
    readonly cursor: string | null;
  }): Promise<WorkDefinitionVersionListPage> {
    const cursor = input.cursor ? decodeCursor(input.cursor) : null;
    const values: unknown[] = [
      input.definitionId,
      input.owner.tenantId,
      input.owner.workspaceId,
      input.owner.principalType,
      input.owner.principalId,
    ];
    let cursorSql = '';
    if (cursor) {
      values.push(cursor.createdAt, cursor.id);
      cursorSql = `AND (v.created_at,v.id) < ($6::timestamptz,$7::uuid)`;
    }
    values.push(input.limit + 1);
    const limitIndex = values.length;
    const result = await this.db.query<ProductVersionRow>(
      `${productVersionSelect(
        `v.definition_id=$1 AND v.tenant_id=$2 AND v.workspace_id=$3
         AND v.principal_type=$4 AND v.principal_id=$5
         AND v.author_fingerprint IS NOT NULL ${cursorSql}`,
      )}
       ORDER BY v.created_at DESC,v.id DESC LIMIT $${limitIndex}`,
      values,
    );
    const rows = [...(result.rows ?? [])];
    const hasMore = rows.length > input.limit;
    if (hasMore) rows.pop();
    const items = rows.map(mapProductVersion);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        hasMore && last
          ? encodeCursor({
              createdAt: last.version.createdAt,
              id: last.version.id,
            })
          : null,
    };
  }

  public async recordResolvedFingerprint(input: {
    readonly versionId: string;
    readonly owner: WorkDefinitionSourceOwner;
    readonly resolvedFingerprint: string;
    readonly now: string;
  }): Promise<string> {
    const version = await this.findPublishedVersion(
      input.versionId,
      input.owner,
    );
    if (!version) throw new Error('Work Definition version not found.');
    await this.db.query(
      `INSERT INTO work_definition_version_resolutions
       (version_id,tenant_id,workspace_id,principal_type,principal_id,resolved_fingerprint,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (version_id) DO NOTHING`,
      [
        input.versionId,
        input.owner.tenantId,
        input.owner.workspaceId,
        input.owner.principalType,
        input.owner.principalId,
        input.resolvedFingerprint,
        input.now,
      ],
    );
    const result = await this.db.query<{ resolved_fingerprint: string }>(
      `SELECT resolved_fingerprint FROM work_definition_version_resolutions
       WHERE version_id=$1 AND tenant_id=$2 AND workspace_id=$3
         AND principal_type=$4 AND principal_id=$5`,
      ownerValues(input.versionId, input.owner),
    );
    const persisted = result.rows?.[0]?.resolved_fingerprint;
    if (!persisted || persisted !== input.resolvedFingerprint)
      throw new Error('Work Definition resolved fingerprint conflict.');
    return persisted;
  }

  public async findApplyRequest(input: {
    readonly owner: WorkDefinitionSourceOwner;
    readonly idempotencyKey: string;
  }): Promise<WorkDefinitionApplyRequestRecord | null> {
    const result = await this.db.query<ApplyRequestRow>(
      `SELECT idempotency_key,request_fingerprint,definition_id,version_id,resolved_fingerprint,created_at
         FROM work_definition_apply_requests
        WHERE tenant_id=$1 AND workspace_id=$2 AND principal_type=$3
          AND principal_id=$4 AND idempotency_key=$5`,
      [
        input.owner.tenantId,
        input.owner.workspaceId,
        input.owner.principalType,
        input.owner.principalId,
        input.idempotencyKey,
      ],
    );
    return result.rows?.[0] ? mapApplyRequest(result.rows[0]) : null;
  }

  public async recordApplyRequest(input: {
    readonly owner: WorkDefinitionSourceOwner;
    readonly idempotencyKey: string;
    readonly requestFingerprint: string;
    readonly definitionId: string;
    readonly versionId: string;
    readonly resolvedFingerprint: string;
    readonly now: string;
  }): Promise<WorkDefinitionApplyRequestRecord> {
    await this.db.query(
      `INSERT INTO work_definition_apply_requests
       (tenant_id,workspace_id,principal_type,principal_id,idempotency_key,
        request_fingerprint,definition_id,version_id,resolved_fingerprint,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (tenant_id,workspace_id,principal_type,principal_id,idempotency_key)
       DO NOTHING`,
      [
        input.owner.tenantId,
        input.owner.workspaceId,
        input.owner.principalType,
        input.owner.principalId,
        input.idempotencyKey,
        input.requestFingerprint,
        input.definitionId,
        input.versionId,
        input.resolvedFingerprint,
        input.now,
      ],
    );
    const persisted = await this.findApplyRequest({
      owner: input.owner,
      idempotencyKey: input.idempotencyKey,
    });
    if (
      !persisted ||
      persisted.requestFingerprint !== input.requestFingerprint ||
      persisted.definitionId !== input.definitionId ||
      persisted.versionId !== input.versionId ||
      persisted.resolvedFingerprint !== input.resolvedFingerprint
    )
      throw new Error('idempotency_conflict');
    return persisted;
  }

  public async associateAgentWorkflow(input: {
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly principalType: string;
    readonly principalId: string;
    readonly agentDefinitionId: string;
    readonly definitionId: string;
    readonly definitionVersionId: string;
    readonly now: string;
  }): Promise<void> {
    const owner: WorkDefinitionSourceOwner = {
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      principalType: input.principalType,
      principalId: input.principalId,
    };
    const [definition, version, agent] = await Promise.all([
      this.findDefinition(input.definitionId, owner),
      this.findPublishedVersion(input.definitionVersionId, owner),
      this.db.query<{ id: string }>(
        `SELECT id FROM agent_definitions
          WHERE id=$1 AND tenant_id=$2 AND workspace_id=$3
            AND principal_type=$4 AND principal_id=$5
            AND managed_discriminator='managed_agent_v1'`,
        [
          input.agentDefinitionId,
          input.tenantId,
          input.workspaceId,
          input.principalType,
          input.principalId,
        ],
      ),
    ]);
    if (
      !definition ||
      !version ||
      version.definitionId !== definition.id ||
      !agent.rows?.[0]
    )
      throw new Error('agent_work_binding_not_found');

    await this.db.query(
      `INSERT INTO agent_work_bindings
       (tenant_id,workspace_id,principal_type,principal_id,agent_definition_id,
        work_definition_id,active_work_definition_version_id,status,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,'enabled',$8,$8)
       ON CONFLICT (tenant_id,workspace_id,principal_type,principal_id,agent_definition_id,work_definition_id)
       DO UPDATE SET active_work_definition_version_id=EXCLUDED.active_work_definition_version_id,
                     status='enabled',updated_at=EXCLUDED.updated_at`,
      [
        input.tenantId,
        input.workspaceId,
        input.principalType,
        input.principalId,
        input.agentDefinitionId,
        input.definitionId,
        input.definitionVersionId,
        input.now,
      ],
    );
  }

  public async listDefinitionsForAgent(input: {
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly principalType: string;
    readonly principalId: string;
    readonly agentDefinitionId: string;
  }): Promise<readonly WorkDefinitionSourceDefinition[]> {
    const result = await this.db.query<DefinitionRow>(
      `SELECT d.${definitionColumns.split(',').join(',d.')}
         FROM agent_work_bindings a
         JOIN work_definition_source_definitions d
           ON d.id=a.work_definition_id
          AND d.tenant_id=a.tenant_id AND d.workspace_id=a.workspace_id
          AND d.principal_type=a.principal_type AND d.principal_id=a.principal_id
        WHERE a.tenant_id=$1 AND a.workspace_id=$2
          AND a.principal_type=$3 AND a.principal_id=$4
          AND a.agent_definition_id=$5 AND a.status='enabled'
        ORDER BY a.created_at ASC`,
      [
        input.tenantId,
        input.workspaceId,
        input.principalType,
        input.principalId,
        input.agentDefinitionId,
      ],
    );
    return (result.rows ?? []).map(mapDefinition);
  }

  public async listAgentWorkBindings(input: {
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly principalType: string;
    readonly principalId: string;
    readonly agentDefinitionId: string;
  }) {
    const result = await this.db.query<DefinitionRow & VersionRow>(
      `SELECT d.${definitionColumns.split(',').join(',d.')},v.${versionColumns.split(',').join(',v.')}
         FROM agent_work_bindings a
         JOIN work_definition_source_definitions d
           ON d.id=a.work_definition_id
          AND d.tenant_id=a.tenant_id AND d.workspace_id=a.workspace_id
          AND d.principal_type=a.principal_type AND d.principal_id=a.principal_id
         JOIN work_definition_source_versions v
           ON v.id=a.active_work_definition_version_id
          AND v.definition_id=a.work_definition_id
          AND v.tenant_id=a.tenant_id AND v.workspace_id=a.workspace_id
          AND v.principal_type=a.principal_type AND v.principal_id=a.principal_id
          AND v.status='published'
        WHERE a.tenant_id=$1 AND a.workspace_id=$2
          AND a.principal_type=$3 AND a.principal_id=$4
          AND a.agent_definition_id=$5 AND a.status='enabled'
        ORDER BY a.created_at ASC`,
      [
        input.tenantId,
        input.workspaceId,
        input.principalType,
        input.principalId,
        input.agentDefinitionId,
      ],
    );
    return (result.rows ?? []).map((row) => ({
      definition: mapDefinition(row),
      version: mapVersion(row),
    }));
  }
}

function productVersionSelect(where: string): string {
  return `SELECT v.${versionColumns.split(',').join(',v.')},
                 r.resolved_fingerprint AS product_resolved_fingerprint
            FROM work_definition_source_versions v
       LEFT JOIN work_definition_version_resolutions r ON r.version_id=v.id
           WHERE ${where} AND v.status='published'`;
}

function mapDefinition(row: DefinitionRow): WorkDefinitionSourceDefinition {
  return {
    id: row.id,
    owner: {
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      principalType: row.principal_type,
      principalId: row.principal_id,
    },
    name: row.name,
    description: row.description,
    createdAt: toIso(row.created_at),
  };
}

function mapVersion(row: VersionRow): WorkDefinitionSourceVersion {
  const source = validateWorkDefinitionCompositionSource(row.source);
  if (row.fingerprint !== fingerprintWorkDefinitionSource(source))
    throw new Error('Persisted Work Definition source fingerprint mismatch.');
  return {
    id: row.id,
    definitionId: row.definition_id,
    owner: {
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      principalType: row.principal_type,
      principalId: row.principal_id,
    },
    status: 'published',
    source,
    fingerprint: row.fingerprint,
    createdAt: toIso(row.created_at),
    publishedAt: toIso(row.published_at),
  };
}

function mapProductVersion(
  row: ProductVersionRow,
): ProductWorkDefinitionVersionRecord {
  if (!row.author_source || !row.author_fingerprint)
    throw new Error('Work Definition version is not Product-authored.');
  return {
    version: mapVersion(row),
    authorSource: row.author_source,
    authorFingerprint: row.author_fingerprint,
    resolvedFingerprint: row.product_resolved_fingerprint,
  };
}

function mapApplyRequest(
  row: ApplyRequestRow,
): WorkDefinitionApplyRequestRecord {
  return {
    idempotencyKey: row.idempotency_key,
    requestFingerprint: row.request_fingerprint,
    definitionId: row.definition_id,
    versionId: row.version_id,
    resolvedFingerprint: row.resolved_fingerprint,
    createdAt: toIso(row.created_at),
  };
}

function ownerValues(
  id: string,
  owner: WorkDefinitionSourceOwner,
): readonly unknown[] {
  return [
    id,
    owner.tenantId,
    owner.workspaceId,
    owner.principalType,
    owner.principalId,
  ];
}

function encodeCursor(value: {
  readonly createdAt: string;
  readonly id: string;
}): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeCursor(value: string): {
  readonly createdAt: string;
  readonly id: string;
} {
  try {
    const parsed = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    ) as {
      createdAt?: unknown;
      id?: unknown;
    };
    if (
      typeof parsed.createdAt !== 'string' ||
      Number.isNaN(new Date(parsed.createdAt).getTime()) ||
      typeof parsed.id !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(parsed.id)
    )
      throw new Error('invalid');
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    throw new InvalidWorkDefinitionVersionCursorError();
  }
}

export class InvalidWorkDefinitionVersionCursorError extends Error {
  public readonly code = 'invalid_cursor';
  public constructor() {
    super('The Work Definition version cursor is invalid.');
    this.name = 'InvalidWorkDefinitionVersionCursorError';
  }
}

function toIso(value: string | Date): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}
