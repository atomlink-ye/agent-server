import { createHash, randomUUID } from 'node:crypto';
import type { AccessContext } from '../../platform/access-context.js';
import type {
  ProductSession,
  ProductSessionListPage,
  SessionRepository,
  UserMessage,
  Workspace,
} from '../../application/ports/session-repository.js';
import { RUN_API_COMPATIBILITY_INVOKABLE_VERSION_ID } from '../../domain/tasks/compatibility-invokable-version.js';
import { encodeRootTaskRunRequestSnapshotRef } from '../../application/tasks/root-task-input.js';
import { originReference } from '../../application/sessions/session-turn-origin.js';
import type { SubmitSessionTurnInput } from '../../application/ports/session-repository.js';
import { SessionCreationError } from '../../application/sessions/session-errors.js';
import { SessionListQueryError } from '../../application/sessions/session-errors.js';

interface Q {
  query<R = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{ rows?: readonly R[]; rowCount?: number | null }>;
  connect?(): Promise<any>;
  release?(): void;
}
const iso = () => new Date().toISOString();
export class PostgresSessionRepository implements SessionRepository {
  constructor(private readonly db: any) {}
  async createWorkspace(name: string, o: AccessContext): Promise<Workspace> {
    const now = iso(),
      id = randomUUID();
    await this.db.query(
      `INSERT INTO workspaces(id,tenant_id,principal_type,principal_id,name,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$6)`,
      [id, o.tenantId, o.principalType, o.principalId, name, now],
    );
    return {
      id,
      tenantId: o.tenantId,
      principalType: o.principalType,
      principalId: o.principalId,
      name,
      createdAt: now,
      updatedAt: now,
    };
  }
  async getWorkspace(id: string, o: AccessContext) {
    const r = await this.db.query(
      `SELECT * FROM workspaces WHERE id=$1 AND tenant_id=$2 AND principal_type=$3 AND principal_id=$4`,
      [id, o.tenantId, o.principalType, o.principalId],
    );
    return r.rows?.[0] ? mapWorkspace(r.rows[0]) : null;
  }
  async createSession(i: {
    workspaceId: string;
    agentVersionId: string;
    owner: AccessContext;
    environmentVersionId?: string;
    requireEnvironment?: boolean;
  }) {
    const w = await this.getWorkspace(i.workspaceId, i.owner);
    if (!w) throw new SessionCreationError('workspace_not_found');
    const published = await this.db.query(
      `SELECT id FROM agent_versions WHERE id=$1 AND tenant_id=$2 AND principal_type=$3 AND principal_id=$4 AND status='published'`,
      [
        i.agentVersionId,
        i.owner.tenantId,
        i.owner.principalType,
        i.owner.principalId,
      ],
    );
    if (!published.rows?.[0])
      throw new SessionCreationError('agent_version_not_found');
    const env = i.environmentVersionId
      ? await this.db.query(
          `SELECT id FROM environment_versions WHERE id=$1 AND tenant_id=$2 AND principal_type=$3 AND principal_id=$4 AND status='published'`,
          [
            i.environmentVersionId,
            i.owner.tenantId,
            i.owner.principalType,
            i.owner.principalId,
          ],
        )
      : await this.db.query(
          `SELECT id FROM environment_versions WHERE tenant_id=$1 AND principal_type=$2 AND principal_id=$3 AND status='published'`,
          [i.owner.tenantId, i.owner.principalType, i.owner.principalId],
        );
    if (i.environmentVersionId && !env.rows?.[0])
      throw new SessionCreationError('environment_version_not_found');
    if (
      !i.environmentVersionId &&
      ((env.rows?.length ?? 0) > 1 ||
        (i.requireEnvironment && env.rows?.length !== 1))
    )
      throw new SessionCreationError('environment_required');
    const environmentVersionId = env.rows?.[0]?.id ?? null;
    const now = iso(),
      id = randomUUID();
    await this.db.query(
      `INSERT INTO product_sessions(id,workspace_id,tenant_id,principal_type,principal_id,published_agent_version_id,published_environment_version_id,generation,status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,0,'active',$8,$8)`,
      [
        id,
        w.id,
        w.tenantId,
        w.principalType,
        w.principalId,
        i.agentVersionId,
        environmentVersionId,
        now,
      ],
    );
    await this.db.query(
      `INSERT INTO session_lanes(session_id,generation) VALUES($1,0)`,
      [id],
    );
    return {
      id,
      workspaceId: w.id,
      tenantId: w.tenantId,
      principalType: w.principalType,
      principalId: w.principalId,
      publishedAgentVersionId: i.agentVersionId,
      environmentVersionId,
      generation: 0,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    } as ProductSession;
  }
  async getSession(id: string, o: AccessContext) {
    const r = await this.db.query(
      `SELECT * FROM product_sessions WHERE id=$1 AND tenant_id=$2 AND principal_type=$3 AND principal_id=$4`,
      [id, o.tenantId, o.principalType, o.principalId],
    );
    return r.rows?.[0] ? mapSession(r.rows[0]) : null;
  }
  async listSessions(
    o: AccessContext,
    input: {
      readonly workspaceId: string;
      readonly limit: number;
      readonly cursor: string | null;
    },
  ): Promise<ProductSessionListPage> {
    if (
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 50
    )
      throw new SessionListQueryError('invalid_limit');
    const cursor = input.cursor ? decodeSessionCursor(input.cursor) : null;
    const values: unknown[] = [
      o.tenantId,
      input.workspaceId,
      o.principalType,
      o.principalId,
      input.limit + 1,
    ];
    const cursorSql = cursor
      ? ` AND (COALESCE(latest.created_at, s.created_at), s.id) < ($6::timestamptz, $7::uuid)`
      : '';
    if (cursor) values.push(cursor.sortAt, cursor.sessionId);
    const result = await this.db.query(
      `SELECT s.id, s.created_at,
              latest.created_at AS last_message_at,
              latest.role AS preview_role,
              latest.text AS preview_text,
              first_user.text AS title_text
         FROM product_sessions s
         LEFT JOIN LATERAL (
           SELECT m.created_at, m.role, m.text
             FROM messages m
            WHERE m.session_id=s.id AND m.role IN ('user','assistant')
            ORDER BY m.generation DESC, m.sequence DESC
            LIMIT 1
         ) latest ON true
         LEFT JOIN LATERAL (
           SELECT m.text
             FROM messages m
            WHERE m.session_id=s.id AND m.role='user'
            ORDER BY m.generation ASC, m.sequence ASC
            LIMIT 1
         ) first_user ON true
        WHERE s.tenant_id=$1 AND s.workspace_id=$2 AND s.principal_type=$3 AND s.principal_id=$4${cursorSql}
        ORDER BY COALESCE(latest.created_at, s.created_at) DESC, s.id DESC
        LIMIT $5`,
      values,
    );
    const rows = [...(result.rows ?? [])];
    const hasNext = rows.length > input.limit;
    const items = rows.slice(0, input.limit).map(mapSessionListItem);
    const last = rows[input.limit - 1];
    return {
      items,
      nextCursor:
        hasNext && last
          ? encodeSessionCursor(
              new Date(last.last_message_at ?? last.created_at).toISOString(),
              String(last.id),
            )
          : null,
    };
  }
  async listMessages(id: string, o: AccessContext) {
    const s = await this.getSession(id, o);
    if (!s) return null;
    const r = await this.db.query(
      `SELECT m.*, t.status, r.id run_id FROM messages m JOIN tasks t ON t.id=m.task_id LEFT JOIN runs r ON r.task_id=t.id WHERE m.session_id=$1 ORDER BY m.generation,m.sequence`,
      [id],
    );
    return (r.rows ?? []).map(mapMessage);
  }
  async postMessage(i: SubmitSessionTurnInput): Promise<UserMessage> {
    const { sessionId: id, text, idempotencyKey: key, owner: o, origin } = i;
    const c = await this.acquire();
    await c.query('BEGIN');
    try {
      const s = await c.query(
        `SELECT s.*, l.generation lane_generation,l.next_sequence,l.active_task_id FROM product_sessions s JOIN session_lanes l ON l.session_id=s.id WHERE s.id=$1 AND s.tenant_id=$2 AND s.principal_type=$3 AND s.principal_id=$4 FOR UPDATE`,
        [id, o.tenantId, o.principalType, o.principalId],
      );
      const row = s.rows?.[0];
      if (!row) throw new Error('not_found');
      const existing = await c.query(
        `SELECT m.*,t.status,r.id run_id FROM admissions a JOIN messages m ON m.task_id=a.task_id JOIN tasks t ON t.id=m.task_id LEFT JOIN runs r ON r.task_id=t.id WHERE m.session_id=$1 AND a.ingress=$2 AND a.idempotency_key=$3 AND a.tenant_id=$4 AND a.workspace_id=$5 AND a.principal_type=$6 AND a.principal_id=$7`,
        [
          id,
          origin.channel,
          key,
          o.tenantId,
          row.workspace_id,
          o.principalType,
          o.principalId,
        ],
      );
      if (existing.rows?.[0]) {
        await c.query('COMMIT');
        return mapMessage(existing.rows[0]);
      }
      const seq = Number(row.next_sequence),
        now = iso(),
        taskId = randomUUID(),
        runId = randomUUID(),
        msgId = randomUUID(),
        fp = createHash('sha256').update(text).digest('hex'),
        active = row.active_task_id ?? taskId;
      const pinned = await c.query(
        `SELECT snapshot_id, content_hash FROM workspace_memory_snapshots WHERE tenant_id=$1 AND workspace_id=$2 AND projection_status='ready' ORDER BY version DESC LIMIT 1`,
        [o.tenantId, row.workspace_id],
      );
      const memorySnapshotId = pinned.rows?.[0]?.snapshot_id ?? null;
      const memorySnapshotHash = pinned.rows?.[0]?.content_hash ?? null;
      await c.query(
        `INSERT INTO tasks(id,tenant_id,workspace_id,principal_type,principal_id,policy_snapshot_version,root_task_id,parent_task_id,parent_run_id,depth,logical_step_key,node_path,status,ingress,origin_ref,invokable_kind,invokable_version_id,input_snapshot_ref,input_fingerprint,memory_snapshot_id,memory_snapshot_hash,created_at,updated_at,session_id,generation,lane_sequence) VALUES($1,$2,$3,$4,$5,'product_session',$1,NULL,NULL,0,NULL,NULL,'queued',$15,$16,'agent',$6,$7,$8,$9,$10,$11,$11,$12,$13,$14)`,
        [
          taskId,
          o.tenantId,
          row.workspace_id,
          o.principalType,
          o.principalId,
          row.published_agent_version_id,
          encodeRootTaskRunRequestSnapshotRef({ prompt: text }),
          fp,
          memorySnapshotId,
          memorySnapshotHash,
          now,
          id,
          row.generation,
          seq,
          origin.channel,
          originReference(origin),
        ],
      );
      await c.query(
        `INSERT INTO runs(id,task_id,attempt,status,created_at,updated_at) VALUES($1,$2,1,'queued',$3,$3)`,
        [runId, taskId, now],
      );
      await c.query(
        `INSERT INTO messages(id,session_id,generation,sequence,role,text,task_id,created_at) VALUES($1,$2,$3,$4,'user',$5,$6,$7)`,
        [msgId, id, row.generation, seq, text, taskId, now],
      );
      await c.query(
        `INSERT INTO admissions(ingress,origin_ref,idempotency_key,request_fingerprint,task_id,session_id,tenant_id,workspace_id,principal_type,principal_id,policy_snapshot_version,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'product_session',$11)`,
        [
          origin.channel,
          originReference(origin),
          key,
          fp,
          taskId,
          id,
          o.tenantId,
          row.workspace_id,
          o.principalType,
          o.principalId,
          now,
        ],
      );
      await c.query(
        `INSERT INTO run_dispatches(run_id,event_type,created_at) VALUES($1,'run.enqueue',$2) ON CONFLICT DO NOTHING`,
        [runId, now],
      );
      await c.query(
        `UPDATE session_lanes SET next_sequence=$2, active_task_id=COALESCE(active_task_id,$3) WHERE session_id=$1`,
        [id, seq + 1, active],
      );
      await c.query('COMMIT');
      return {
        id: msgId,
        sessionId: id,
        generation: Number(row.generation),
        sequence: seq,
        role: 'user' as const,
        text,
        taskId,
        runId,
        status: 'queued',
        createdAt: now,
      };
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release?.();
    }
  }
  async appendAssistantMessage(i: {
    sessionId: string;
    generation: number;
    taskId: string;
    runId: string;
    text: string;
  }): Promise<void> {
    const c = await this.acquire();
    await c.query('BEGIN');
    try {
      const lane = await c.query(
        `SELECT next_sequence FROM session_lanes WHERE session_id=$1 AND generation=$2 FOR UPDATE`,
        [i.sessionId, i.generation],
      );
      const sequence = Number(lane.rows?.[0]?.next_sequence);
      if (!Number.isSafeInteger(sequence) || sequence < 1)
        throw new Error('session lane not found');
      await c.query(
        `INSERT INTO messages(id,session_id,generation,sequence,role,text,task_id,created_at) VALUES($1,$2,$3,$4,'assistant',$5,$6,$7) ON CONFLICT(session_id,generation,sequence) DO NOTHING`,
        [
          randomUUID(),
          i.sessionId,
          i.generation,
          sequence,
          i.text,
          i.taskId,
          iso(),
        ],
      );
      await c.query(
        `UPDATE session_lanes SET next_sequence=$3 WHERE session_id=$1 AND generation=$2`,
        [i.sessionId, i.generation, sequence + 1],
      );
      await c.query('COMMIT');
    } catch (error) {
      await c.query('ROLLBACK');
      throw error;
    } finally {
      c.release?.();
    }
  }
  async reset(id: string, o: AccessContext, key: string) {
    const c = await this.acquire();
    await c.query('BEGIN');
    try {
      const r = await c.query(
        `SELECT s.* FROM product_sessions s JOIN session_lanes l ON l.session_id=s.id WHERE s.id=$1 AND s.tenant_id=$2 AND s.principal_type=$3 AND s.principal_id=$4 FOR UPDATE`,
        [id, o.tenantId, o.principalType, o.principalId],
      );
      if (!r.rows?.[0]) {
        await c.query('ROLLBACK');
        return null;
      }
      const s = r.rows[0];
      const replay = await c.query(
        `SELECT generation, updated_at FROM session_reset_idempotency WHERE session_id=$1 AND idempotency_key=$2`,
        [id, key],
      );
      if (replay.rows?.[0]) {
        await c.query('COMMIT');
        return {
          ...mapSession(s),
          generation: Number(replay.rows[0].generation),
          updatedAt: new Date(replay.rows[0].updated_at).toISOString(),
        } as ProductSession;
      }
      const g = Number(s.generation) + 1,
        now = iso();
      await c.query(
        `UPDATE tasks
            SET status='cancelled', failure_detail='cancelled_by_reset', updated_at=$2
          WHERE session_id=$1
            AND generation=$3
            AND status='queued'
            AND id <> (SELECT active_task_id FROM session_lanes WHERE session_id=$1)`,
        [id, now, g - 1],
      );
      await c.query(
        `UPDATE session_lanes SET generation=$2,next_sequence=1,active_cancellation_requested=CASE WHEN active_task_id IS NOT NULL THEN true ELSE false END WHERE session_id=$1`,
        [id, g],
      );
      await c.query(
        `UPDATE product_sessions SET generation=$2,updated_at=$3 WHERE id=$1`,
        [id, g, now],
      );
      await c.query(
        `INSERT INTO session_reset_idempotency(session_id,idempotency_key,generation,updated_at) VALUES($1,$2,$3,$4)`,
        [id, key, g, now],
      );
      await c.query('COMMIT');
      return {
        ...mapSession(s),
        generation: g,
        updatedAt: now,
      } as ProductSession;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release?.();
    }
  }
  private async acquire() {
    return this.db.connect ? await this.db.connect() : this.db;
  }
}
function mapWorkspace(r: any): Workspace {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    principalType: r.principal_type,
    principalId: r.principal_id,
    name: r.name,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}
function mapSession(r: any): ProductSession {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    tenantId: r.tenant_id,
    principalType: r.principal_type,
    principalId: r.principal_id,
    publishedAgentVersionId: r.published_agent_version_id,
    environmentVersionId: r.published_environment_version_id,
    generation: Number(r.generation),
    status: r.status,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}
function mapMessage(r: any): UserMessage {
  return {
    id: r.id,
    sessionId: r.session_id,
    generation: Number(r.generation),
    sequence: Number(r.sequence),
    role: r.role,
    text: r.text,
    taskId: r.task_id,
    runId: r.run_id,
    status: r.status,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

function mapSessionListItem(r: any) {
  const preview = sanitizeExcerpt(r.preview_text, 120);
  return {
    sessionId: String(r.id),
    title: sanitizeExcerpt(r.title_text, 60) ?? 'New chat',
    preview,
    previewRole:
      preview !== null &&
      (r.preview_role === 'user' || r.preview_role === 'assistant')
        ? r.preview_role
        : null,
    lastMessageAt: r.last_message_at
      ? new Date(r.last_message_at).toISOString()
      : null,
    createdAt: new Date(r.created_at).toISOString(),
  } as const;
}

function sanitizeExcerpt(value: unknown, maxCodePoints: number): string | null {
  if (typeof value !== 'string') return null;
  const plain = value
    .replace(/\s/gu, ' ')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/<[^>]*>/gu, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/(^|\s)#{1,6}\s+/gu, '$1')
    .replace(/(^|\s)[>*-]\s+/gu, '$1')
    .replace(/[*~`]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  return Array.from(plain).slice(0, maxCodePoints).join('') || null;
}

function encodeSessionCursor(sortAt: string, sessionId: string): string {
  return Buffer.from(JSON.stringify([sortAt, sessionId]), 'utf8').toString(
    'base64url',
  );
}

function decodeSessionCursor(value: string): {
  readonly sortAt: string;
  readonly sessionId: string;
} {
  try {
    if (
      value.length > 256 ||
      value.length === 0 ||
      !/^[A-Za-z0-9_-]+$/.test(value)
    )
      throw new Error();
    const decoded = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    );
    if (
      !Array.isArray(decoded) ||
      decoded.length !== 2 ||
      typeof decoded[0] !== 'string' ||
      decoded[0] !== new Date(decoded[0]).toISOString() ||
      typeof decoded[1] !== 'string' ||
      !isCanonicalUuid(decoded[1])
    )
      throw new Error();
    const sortAt = decoded[0];
    const sessionId = decoded[1];
    if (encodeSessionCursor(sortAt, sessionId) !== value) throw new Error();
    return { sortAt, sessionId };
  } catch {
    throw new SessionListQueryError('invalid_cursor');
  }
}

function isCanonicalUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
