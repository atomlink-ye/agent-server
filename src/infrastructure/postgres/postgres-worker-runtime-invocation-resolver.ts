import type { WorkerRuntimeInvocationResolver } from '../../application/ports/worker-runtime-invocation-resolver.js';
import { ContextViewResolver } from '../../application/context/context-view-resolver.js';
import type { RuntimeInvocationContext } from '../../domain/runtime/runtime-invocation-context.js';
import {
  principalRef,
  productScope,
  resourceOwner,
} from '../../domain/tenancy/product-context.js';

interface Queryable {
  query<T = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rows?: readonly T[] }>;
}

type Row = {
  scope_kind: 'task' | 'team_member' | 'product_session' | 'agent_chat';
  scope_id: string;
  task_id: string | null;
  tenant_id: string;
  principal_type: string;
  principal_id: string;
  workspace_id: string;
  agent_version_id: string;
  definition_id: string | null;
  agent_tenant_id: string | null;
  agent_workspace_id: string | null;
  agent_principal_type: string | null;
  agent_principal_id: string | null;
  root_task_id: string | null;
  work_id: string | null;
  work_run_id: string | null;
};

/**
 * Reconstructs formal Work runtime identity from canonical durable facts. This
 * keeps ContextFS projection out of AgentRunExecutor and makes the runtime
 * boundary self-describing without parsing prompts.
 */
export class PostgresWorkerRuntimeInvocationResolver implements WorkerRuntimeInvocationResolver {
  public constructor(
    private readonly db: Queryable,
    private readonly views: ContextViewResolver = new ContextViewResolver(),
  ) {}

  public async resolve(
    runtimeSessionId: string,
  ): Promise<RuntimeInvocationContext | null> {
    const result = await this.db.query<Row>(
      `SELECT rs.scope_kind,rs.scope_id,rs.task_id,rs.tenant_id,
              rs.principal_type,rs.principal_id,
              sls.workspace_id,sls.agent_version_id,
              av.definition_id,
              av.tenant_id AS agent_tenant_id,
              av.workspace_id AS agent_workspace_id,
              av.principal_type AS agent_principal_type,
              av.principal_id AS agent_principal_id,
              t.root_task_id,
              wr.work_id,wr.id AS work_run_id
         FROM runtime_sessions rs
         JOIN session_launch_snapshots sls ON sls.id=rs.launch_snapshot_id
         LEFT JOIN tasks t ON t.id=rs.task_id
         LEFT JOIN agent_versions av ON av.id=sls.agent_version_id
         LEFT JOIN LATERAL (
           SELECT candidate.id,candidate.work_id
             FROM work_runs candidate
            WHERE t.root_task_id IS NOT NULL
              AND candidate.tenant_id=rs.tenant_id
              AND candidate.workspace_id::text=sls.workspace_id
              AND (
                candidate.root_task_id=t.root_task_id
                OR EXISTS (
                  SELECT 1 FROM admissions a
                   WHERE a.task_id=t.root_task_id
                     AND a.tenant_id=rs.tenant_id
                     AND a.principal_type=rs.principal_type
                     AND a.principal_id=rs.principal_id
                     AND a.idempotency_key=('work-run:' || candidate.id::text)
                )
              )
            ORDER BY candidate.created_at DESC,candidate.id DESC
            LIMIT 1
         ) wr ON TRUE
        WHERE rs.id=$1`,
      [runtimeSessionId],
    );
    const row = result.rows?.[0];
    if (!row) return null;
    if (row.scope_kind !== 'task' && row.scope_kind !== 'team_member')
      return null;
    if (
      !row.task_id ||
      !row.definition_id ||
      !row.agent_tenant_id ||
      !row.agent_workspace_id ||
      !row.agent_principal_type ||
      !row.agent_principal_id ||
      !row.work_id ||
      !row.work_run_id
    )
      return null;

    const product = productScope({
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
    });
    const actor = principalRef({
      principalType: row.principal_type,
      principalId: row.principal_id,
    });
    const agentOwner = resourceOwner({
      tenantId: row.agent_tenant_id,
      workspaceId: row.agent_workspace_id,
      principalType: row.agent_principal_type,
      principalId: row.agent_principal_id,
    });
    const contextView = this.views.forWorker({
      productScope: product,
      agentDefinitionId: row.definition_id,
      workId: row.work_id,
      runtimeSessionId,
    });

    return Object.freeze({
      scope:
        row.scope_kind === 'team_member'
          ? {
              kind: 'team_member' as const,
              teamMemberRunId: row.scope_id,
            }
          : { kind: 'task' as const, taskId: row.task_id },
      productScope: product,
      actor,
      agentOwner,
      agentDefinitionId: row.definition_id,
      agentVersionId: row.agent_version_id,
      workId: row.work_id,
      workRunId: row.work_run_id,
      contextView,
    });
  }
}
