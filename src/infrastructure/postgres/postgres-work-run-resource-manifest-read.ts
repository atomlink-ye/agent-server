import type {
  WorkRunCompositionManifest,
  WorkRunManifestScope,
  WorkRunResourceManifestRead,
} from '../../application/ports/work-run-resource-manifest-read.js';
import type { ResolvedResourceManifestEntry } from '../../domain/work/resolved-resource-manifest.js';

interface Queryable {
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rows?: readonly Row[] }>;
}

type Row = {
  work_run_id: string;
  definition_version_id: string;
  root_task_id: string;
  slot: string;
  resource_kind: ResolvedResourceManifestEntry['resourceKind'];
  requested_ref: string | null;
  resolved_version_id: string;
  resolved_fingerprint: string | null;
  resolved_at: string | Date;
};

export class PostgresWorkRunResourceManifestRead
  implements WorkRunResourceManifestRead
{
  public constructor(private readonly db: Queryable) {}

  public async findByRootTaskId(
    rootTaskId: string,
    scope: WorkRunManifestScope,
  ): Promise<WorkRunCompositionManifest | null> {
    const result = await this.db.query<Row>(
      `SELECT wr.id AS work_run_id,wr.definition_version_id,wr.root_task_id,
              m.slot,m.resource_kind,m.requested_ref,m.resolved_version_id,
              m.resolved_fingerprint,m.resolved_at
         FROM work_runs wr
         JOIN tasks root ON root.id=wr.root_task_id
         JOIN work_run_resource_manifest m
           ON m.work_run_id=wr.id
          AND m.tenant_id=wr.tenant_id
          AND m.workspace_id=wr.workspace_id
        WHERE wr.root_task_id=$1 AND wr.tenant_id=$2 AND wr.workspace_id=$3
          AND root.principal_type=$4 AND root.principal_id=$5
        ORDER BY m.slot`,
      [
        rootTaskId,
        scope.tenantId,
        scope.workspaceId,
        scope.principalType,
        scope.principalId,
      ],
    );
    const rows = result.rows ?? [];
    if (rows.length === 0) return null;
    const first = rows[0]!;
    return {
      workRunId: first.work_run_id,
      definitionVersionId: first.definition_version_id,
      rootTaskId: first.root_task_id,
      entries: rows.map((row) => ({
        slot: row.slot,
        resourceKind: row.resource_kind,
        requestedRef: row.requested_ref,
        resolvedVersionId: row.resolved_version_id,
        resolvedFingerprint: row.resolved_fingerprint,
        resolvedAt:
          row.resolved_at instanceof Date
            ? row.resolved_at.toISOString()
            : new Date(row.resolved_at).toISOString(),
      })),
    };
  }
}
