import type {
  PublishWorkDefinitionSourceInput,
  WorkDefinitionSourceOwner,
  WorkDefinitionSourceRepository,
} from '../../application/ports/work-definition-source-repository.js';
import {
  fingerprintWorkDefinitionSource,
  validateWorkDefinitionCompositionSource,
  type WorkDefinitionSourceDefinition,
  type WorkDefinitionSourceVersion,
  type WorkDefinitionCompositionSource,
} from '../../domain/work/work-definition-source.js';
import { canonicalizeProjectValue } from '../../domain/projects/project-canonicalization.js';

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
  created_at: string | Date;
  published_at: string | Date;
};

const definitionColumns =
  'id,tenant_id,workspace_id,principal_type,principal_id,name,description,created_at';
const versionColumns =
  'id,definition_id,tenant_id,workspace_id,principal_type,principal_id,status,source,fingerprint,created_at,published_at';

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
      [
        id,
        owner.tenantId,
        owner.workspaceId,
        owner.principalType,
        owner.principalId,
      ],
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
      [
        id,
        owner.tenantId,
        owner.workspaceId,
        owner.principalType,
        owner.principalId,
      ],
    );
    return result.rows?.[0] ? mapVersion(result.rows[0]) : null;
  }

  public async publish(input: PublishWorkDefinitionSourceInput) {
    const source = validateWorkDefinitionCompositionSource(input.source);
    const expectedFingerprint = fingerprintWorkDefinitionSource(source);
    if (input.fingerprint !== expectedFingerprint)
      throw new Error('Work Definition source fingerprint mismatch.');
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
      definition.description !== input.description
    )
      throw new Error('Work Definition source identity conflict.');

    await this.db.query(
      `INSERT INTO work_definition_source_versions
       (id,definition_id,tenant_id,workspace_id,principal_type,principal_id,status,source,fingerprint,created_at,published_at)
       VALUES ($1,$2,$3,$4,$5,$6,'published',$7::jsonb,$8,$9,$9)
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
    return { definition, version };
  }
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

function toIso(value: string | Date): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}
