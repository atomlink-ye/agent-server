import type {
  MemoryVersionReadApi,
  MemoryVersionReadScope,
  WorkMemoryVersion,
} from '../../application/ports/memory-version-read-api.js';

interface Queryable {
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rows?: readonly Row[] }>;
}

type Row = {
  version_id: string;
  memory_id: string;
  store_id: string;
  path: string;
  content: string;
  content_sha256: string;
};

export class PostgresMemoryVersionReadApi implements MemoryVersionReadApi {
  public constructor(private readonly db: Queryable) {}

  public async findVersion(
    versionId: string,
    scope: MemoryVersionReadScope,
  ): Promise<WorkMemoryVersion | null> {
    const result = await this.db.query<Row>(
      `SELECT mv.id AS version_id,mv.memory_id,m.memory_store_id AS store_id,
              m.path,mv.content,mv.content_sha256
         FROM memory_versions mv
         JOIN memories m ON m.id=mv.memory_id
         JOIN memory_stores ms ON ms.id=m.memory_store_id
        WHERE mv.id=$1 AND ms.tenant_id=$2 AND ms.workspace_id=$3
          AND ms.principal_type=$4 AND ms.principal_id=$5`,
      [
        versionId,
        scope.tenantId,
        scope.workspaceId,
        scope.principalType,
        scope.principalId,
      ],
    );
    const row = result.rows?.[0];
    return row
      ? {
          versionId: row.version_id,
          memoryId: row.memory_id,
          storeId: row.store_id,
          path: row.path,
          content: row.content,
          contentSha256: row.content_sha256,
        }
      : null;
  }
}
