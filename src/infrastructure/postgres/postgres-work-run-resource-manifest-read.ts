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
  work_id: string;
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

export class PostgresWorkRunResourceManifestRead implements WorkRunResourceManifestRead {
  public constructor(private readonly db: Queryable) {}

  public async findByRootTaskId(
    rootTaskId: string,
    scope: WorkRunManifestScope,
  ): Promise<WorkRunCompositionManifest | null> {
    const result = await this.db.query<Row>(
      `SELECT wr.work_id,wr.id AS work_run_id,wr.definition_version_id,$1::uuid AS root_task_id,
              m.slot,m.resource_kind,m.requested_ref,m.resolved_version_id,
              m.resolved_fingerprint,m.resolved_at
         FROM tasks root
         JOIN work_runs wr
         ON wr.tenant_id=root.tenant_id
          AND wr.workspace_id::text=root.workspace_id
          AND (
            wr.root_task_id=root.id
            OR EXISTS (
              SELECT 1 FROM admissions a
               WHERE a.task_id=root.id
                 AND a.tenant_id=root.tenant_id
                 AND a.principal_type=root.principal_type
                 AND a.principal_id=root.principal_id
                 AND a.idempotency_key=('work-run:' || wr.id::text)
            )
          )
         JOIN work_run_resource_manifest m
           ON m.work_run_id=wr.id
          AND m.tenant_id=wr.tenant_id
          AND m.workspace_id=wr.workspace_id
        WHERE root.id=$1 AND root.tenant_id=$2 AND root.workspace_id=$3
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
      workId: first.work_id,
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
