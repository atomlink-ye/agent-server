import { randomUUID } from 'node:crypto';

import type { RuntimeSessionStore } from '../../../application/ports/runtime-session-store.js';
import type {
  RuntimeScope,
  RuntimeSession,
  RuntimeSessionId,
  RuntimeSessionOwner,
  RuntimeSessionStatus,
  RuntimeSpecRevision,
} from '../../../domain/runtime/runtime-session.js';
import { runtimeSpecRevision } from '../../../domain/runtime/runtime-session.js';
import { createRuntimeSessionSpec } from '../../../domain/runtime/runtime-session-spec.js';

interface Queryable {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{
    readonly rows?: readonly Row[];
    readonly rowCount?: number | null;
  }>;
}

interface Client extends Queryable {
  release(): void;
}

interface Connectable extends Queryable {
  connect(): Promise<Client>;
}

type Database = Queryable | Connectable;

interface RuntimeSessionRow extends Record<string, unknown> {
  readonly id: string;
  readonly tenant_id: string;
  readonly workspace_id: string;
  readonly principal_type: string;
  readonly principal_id: string;
  readonly scope_kind: string;
  readonly scope_id: string;
  readonly scope_epoch: number | string | null;
  readonly desired_spec_revision: number | string;
  readonly current_generation_id: string | null;
  readonly status: RuntimeSessionStatus;
  readonly created_at: string | Date;
  readonly updated_at: string | Date;
  readonly closed_at: string | Date | null;
}

const SESSION_COLUMNS = `id,tenant_id,workspace_id,principal_type,principal_id,
  scope_kind,scope_id,scope_epoch,desired_spec_revision,current_generation_id,
  status,created_at,updated_at,closed_at`;

export class PostgresRuntimeSessionStore implements RuntimeSessionStore {
  public constructor(private readonly database: Database) {}

  public async findById(id: RuntimeSessionId): Promise<RuntimeSession | null> {
    const result = await this.database.query<RuntimeSessionRow>(
      `SELECT ${SESSION_COLUMNS} FROM runtime_sessions WHERE id=$1`,
      [id],
    );
    return result.rows?.[0] ? mapSession(result.rows[0]) : null;
  }

  public async findByScope(
    owner: RuntimeSessionOwner,
    scope: RuntimeScope,
  ): Promise<RuntimeSession | null> {
    const result = await this.database.query<RuntimeSessionRow>(
      `SELECT ${SESSION_COLUMNS}
         FROM runtime_sessions
        WHERE tenant_id=$1 AND workspace_id=$2 AND principal_type=$3
          AND principal_id=$4 AND scope_kind=$5 AND scope_id=$6
          AND scope_epoch IS NOT DISTINCT FROM $7`,
      [
        owner.tenantId,
        owner.workspaceId,
        owner.principalType,
        owner.principalId,
        scope.kind,
        scope.id,
        scopeEpoch(scope),
      ],
    );
    return result.rows?.[0] ? mapSession(result.rows[0]) : null;
  }

  public async createWithInitialSpec(input: {
    readonly owner: RuntimeSessionOwner;
    readonly scope: RuntimeScope;
    readonly spec: Parameters<
      RuntimeSessionStore['createWithInitialSpec']
    >[0]['spec'];
    readonly now: string;
  }): Promise<RuntimeSession> {
    const id = randomUUID() as RuntimeSessionId;
    const initialSpec = createRuntimeSessionSpec({
      ...input.spec,
      runtimeSessionId: id,
      revision: runtimeSpecRevision(1),
      createdAt: input.now,
    });
    if (initialSpec.workspaceId !== input.owner.workspaceId)
      throw new Error(
        'Runtime session spec workspace does not match its owner.',
      );

    const database = await this.transactionClient();
    try {
      await database.query('BEGIN');
      const result = await database.query<RuntimeSessionRow>(
        `INSERT INTO runtime_sessions
         (id,tenant_id,workspace_id,principal_type,principal_id,scope_kind,
          scope_id,scope_epoch,desired_spec_revision,current_generation_id,
          status,created_at,updated_at,closed_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,'provisioning',$10,$10,NULL)
         ON CONFLICT DO NOTHING
         RETURNING ${SESSION_COLUMNS}`,
        [
          id,
          input.owner.tenantId,
          input.owner.workspaceId,
          input.owner.principalType,
          input.owner.principalId,
          input.scope.kind,
          input.scope.id,
          scopeEpoch(input.scope),
          initialSpec.revision,
          input.now,
        ],
      );
      const created = result.rows?.[0];
      if (!created) {
        const existingResult = await database.query<RuntimeSessionRow>(
          `SELECT ${SESSION_COLUMNS}
             FROM runtime_sessions
            WHERE tenant_id=$1 AND workspace_id=$2 AND principal_type=$3
              AND principal_id=$4 AND scope_kind=$5 AND scope_id=$6
              AND scope_epoch IS NOT DISTINCT FROM $7`,
          [
            input.owner.tenantId,
            input.owner.workspaceId,
            input.owner.principalType,
            input.owner.principalId,
            input.scope.kind,
            input.scope.id,
            scopeEpoch(input.scope),
          ],
        );
        const existing = existingResult.rows?.[0];
        if (!existing) throw new Error('Runtime session could not be created.');
        await database.query('COMMIT');
        return mapSession(existing);
      }

      await database.query(
        `INSERT INTO runtime_session_specs
         (runtime_session_id,revision,workspace_id,agent_version_id,
          environment_version_id,resolved_skills,tool_refs,provider,model,cwd,
          system_prompt_digest,skill_set_digest,tool_catalog_digest,
          extension_set_digest,context_epoch,bootstrap_digest,created_at)
         VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [
          initialSpec.runtimeSessionId,
          initialSpec.revision,
          initialSpec.workspaceId,
          initialSpec.agentVersionId,
          initialSpec.environmentVersionId,
          JSON.stringify(initialSpec.resolvedSkills),
          JSON.stringify(initialSpec.toolRefs),
          initialSpec.provider,
          initialSpec.model,
          initialSpec.cwd,
          initialSpec.systemPromptDigest,
          initialSpec.skillSetDigest,
          initialSpec.toolCatalogDigest,
          initialSpec.extensionSetDigest,
          initialSpec.contextEpoch,
          initialSpec.bootstrapDigest,
          initialSpec.createdAt,
        ],
      );
      await database.query('COMMIT');
      return mapSession(created);
    } catch (error) {
      await database.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      database.release();
    }
  }

  public async bindCurrentGeneration(
    id: RuntimeSessionId,
    generationId: string,
    updatedAt: string,
  ): Promise<void> {
    const result = await this.database.query(
      `UPDATE runtime_sessions
          SET current_generation_id=$2, updated_at=$3
        WHERE id=$1
          AND EXISTS (
            SELECT 1 FROM runtime_session_generations rsg
             WHERE rsg.id=$2 AND rsg.runtime_session_id=runtime_sessions.id
          )`,
      [id, generationId, updatedAt],
    );
    if (result.rowCount === 0)
      throw new Error(
        'Runtime session generation binding could not be updated.',
      );
  }

  public async markStatus(
    id: RuntimeSessionId,
    status: RuntimeSessionStatus,
    updatedAt: string,
  ): Promise<void> {
    const result = await this.database.query(
      `UPDATE runtime_sessions SET status=$2, updated_at=$3 WHERE id=$1`,
      [id, status, updatedAt],
    );
    if (result.rowCount === 0)
      throw new Error('Runtime session status could not be updated.');
  }

  public async close(id: RuntimeSessionId, closedAt: string): Promise<void> {
    const result = await this.database.query(
      `UPDATE runtime_sessions
          SET status='closed', closed_at=$2, updated_at=$2
        WHERE id=$1`,
      [id, closedAt],
    );
    if (result.rowCount === 0)
      throw new Error('Runtime session could not be closed.');
  }

  private async transactionClient(): Promise<Client> {
    if (
      !('connect' in this.database) ||
      typeof this.database.connect !== 'function'
    )
      throw new Error(
        'Initial runtime session creation requires a Postgres transaction client.',
      );
    return this.database.connect();
  }
}

function scopeEpoch(scope: RuntimeScope): number | null {
  return scope.kind === 'agent_chat' ? scope.epoch : null;
}

function mapSession(row: RuntimeSessionRow): RuntimeSession {
  return Object.freeze({
    id: row.id as RuntimeSessionId,
    owner: Object.freeze({
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      principalType: row.principal_type,
      principalId: row.principal_id,
    }),
    scope: mapScope(row),
    desiredSpecRevision: Number(
      row.desired_spec_revision,
    ) as RuntimeSpecRevision,
    currentGenerationId:
      row.current_generation_id as RuntimeSession['currentGenerationId'],
    status: row.status,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    closedAt: row.closed_at === null ? null : iso(row.closed_at),
  });
}

function mapScope(row: RuntimeSessionRow): RuntimeScope {
  if (row.scope_kind === 'agent_chat') {
    if (row.scope_epoch === null)
      throw new Error('Agent chat runtime scope is missing its epoch.');
    return Object.freeze({
      kind: 'agent_chat',
      id: row.scope_id,
      epoch: Number(row.scope_epoch),
    });
  }
  if (
    row.scope_kind === 'team_member' ||
    row.scope_kind === 'product_session' ||
    row.scope_kind === 'task' ||
    row.scope_kind === 'run'
  )
    return Object.freeze({ kind: row.scope_kind, id: row.scope_id });
  throw new Error(`Unknown runtime session scope kind: ${row.scope_kind}`);
}

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}
