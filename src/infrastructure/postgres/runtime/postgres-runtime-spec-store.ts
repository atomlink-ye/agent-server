import type { RuntimeSpecStore } from '../../../application/ports/runtime-spec-store.js';
import type {
  RuntimeSession,
  RuntimeSessionId,
  RuntimeSpecRevision,
} from '../../../domain/runtime/runtime-session.js';
import {
  assertRuntimeSessionSpec,
  createRuntimeSessionSpec,
  type RuntimeResolvedSkill,
  type RuntimeSessionSpec,
  type RuntimeSessionSpecInput,
} from '../../../domain/runtime/runtime-session-spec.js';

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

interface RuntimeSpecRow extends Record<string, unknown> {
  readonly runtime_session_id: string;
  readonly revision: number | string;
  readonly workspace_id: string;
  readonly subject_kind: 'agent_chat' | 'worker' | 'legacy_agent_task';
  readonly agent_version_id: string | null;
  readonly worker_version_id: string | null;
  readonly environment_version_id: string | null;
  readonly resolved_skills: unknown;
  readonly tool_refs: unknown;
  readonly provider: string;
  readonly model: string | null;
  readonly cwd: string;
  readonly system_prompt_digest: string;
  readonly skill_set_digest: string;
  readonly tool_catalog_digest: string;
  readonly extension_set_digest: string;
  readonly context_epoch: number | string;
  readonly bootstrap_digest: string;
  readonly created_at: string | Date;
}

const SPEC_COLUMNS = `runtime_session_id,revision,workspace_id,subject_kind,agent_version_id,worker_version_id,
  environment_version_id,resolved_skills,tool_refs,provider,model,cwd,
  system_prompt_digest,skill_set_digest,tool_catalog_digest,extension_set_digest,
  context_epoch,bootstrap_digest,created_at`;

export class PostgresRuntimeSpecStore implements RuntimeSpecStore {
  public constructor(private readonly database: Database) {}

  public async get(
    sessionId: RuntimeSessionId,
    revision: RuntimeSpecRevision,
  ): Promise<RuntimeSessionSpec | null> {
    const result = await this.database.query<RuntimeSpecRow>(
      `SELECT ${SPEC_COLUMNS}
         FROM runtime_session_specs
        WHERE runtime_session_id=$1 AND revision=$2`,
      [sessionId, revision],
    );
    return result.rows?.[0] ? mapSpec(result.rows[0]) : null;
  }

  public async getDesired(
    session: RuntimeSession,
  ): Promise<RuntimeSessionSpec> {
    const spec = await this.get(session.id, session.desiredSpecRevision);
    if (!spec)
      throw new Error(
        `Desired runtime session spec ${session.id}:${String(session.desiredSpecRevision)} could not be loaded.`,
      );
    return spec;
  }

  public async append(input: {
    readonly spec: RuntimeSessionSpecInput;
    readonly expectedDesiredRevision: RuntimeSpecRevision;
  }): Promise<void> {
    const persisted = createRuntimeSessionSpec(input.spec);
    const database = await this.transactionClient();
    try {
      await database.query('BEGIN');
      const session = await database.query<{
        desired_spec_revision: number | string;
      }>(
        `SELECT desired_spec_revision
           FROM runtime_sessions
          WHERE id=$1
          FOR UPDATE`,
        [persisted.runtimeSessionId],
      );
      const current = session.rows?.[0];
      if (!current) throw new Error('Runtime session does not exist.');
      if (
        Number(current.desired_spec_revision) !== input.expectedDesiredRevision
      )
        throw new Error('Runtime session desired revision changed.');
      const expected = Number(input.expectedDesiredRevision);
      const revision = Number(persisted.revision);
      if (revision !== expected + 1)
        throw new Error('Runtime session spec revision must advance by one.');

      await database.query(
        `INSERT INTO runtime_session_specs
         (${SPEC_COLUMNS})
         VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
        [
          persisted.runtimeSessionId,
          persisted.revision,
          persisted.workspaceId,
          persisted.subjectKind,
          persisted.agentVersionId,
          persisted.workerVersionId,
          persisted.environmentVersionId,
          JSON.stringify(persisted.resolvedSkills),
          JSON.stringify(persisted.toolRefs),
          persisted.provider,
          persisted.model,
          persisted.cwd,
          persisted.systemPromptDigest,
          persisted.skillSetDigest,
          persisted.toolCatalogDigest,
          persisted.extensionSetDigest,
          persisted.contextEpoch,
          persisted.bootstrapDigest,
          persisted.createdAt,
        ],
      );
      const updated = await database.query(
        `UPDATE runtime_sessions
            SET desired_spec_revision=$2, updated_at=$3
          WHERE id=$1 AND desired_spec_revision=$4`,
        [
          persisted.runtimeSessionId,
          persisted.revision,
          persisted.createdAt,
          input.expectedDesiredRevision,
        ],
      );
      if (updated.rowCount === 0)
        throw new Error(
          'Runtime session desired revision could not be advanced.',
        );
      await database.query('COMMIT');
    } catch (error) {
      await database.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      database.release();
    }
  }

  private async transactionClient(): Promise<Client> {
    if (
      !('connect' in this.database) ||
      typeof this.database.connect !== 'function'
    )
      throw new Error(
        'Runtime spec append requires a Postgres transaction client.',
      );
    return this.database.connect();
  }
}

function mapSpec(row: RuntimeSpecRow): RuntimeSessionSpec {
  const spec = Object.freeze({
    runtimeSessionId: row.runtime_session_id as RuntimeSessionId,
    revision: Number(row.revision) as RuntimeSpecRevision,
    workspaceId: row.workspace_id,
    subjectKind: row.subject_kind,
    agentVersionId: row.agent_version_id,
    workerVersionId: row.worker_version_id,
    environmentVersionId: row.environment_version_id,
    resolvedSkills: Object.freeze(
      jsonArray<RuntimeResolvedSkill>(row.resolved_skills, 'resolved_skills'),
    ),
    toolRefs: Object.freeze(jsonArray<string>(row.tool_refs, 'tool_refs')),
    provider: row.provider,
    model: row.model,
    cwd: row.cwd,
    systemPromptDigest: row.system_prompt_digest,
    skillSetDigest: row.skill_set_digest,
    toolCatalogDigest: row.tool_catalog_digest,
    extensionSetDigest: row.extension_set_digest,
    contextEpoch: Number(row.context_epoch),
    bootstrapDigest: row.bootstrap_digest,
    createdAt: iso(row.created_at),
  });
  assertRuntimeSessionSpec(spec);
  return spec;
}

function jsonArray<T>(value: unknown, field: string): T[] {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  if (!Array.isArray(parsed)) throw new Error(`Persisted ${field} is invalid.`);
  return parsed as T[];
}

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}
