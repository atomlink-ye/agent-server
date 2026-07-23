import { createHash, randomUUID } from 'node:crypto';
import type { AccessContext } from '../../application/control-plane/access-context.js';
import type {
  ProductSession,
  SessionRepository,
  UserMessage,
  Workspace,
} from '../../application/ports/session-repository.js';
import { RUN_API_COMPATIBILITY_INVOKABLE_VERSION_ID } from '../../domain/tasks/compatibility-invokable-version.js';
import { encodeRootTaskRunRequestSnapshotRef } from '../../application/tasks/root-task-input.js';

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
  }) {
    const w = await this.getWorkspace(i.workspaceId, i.owner);
    if (!w) return Promise.reject(new Error('not_found'));
    const now = iso(),
      id = randomUUID();
    await this.db.query(
      `INSERT INTO product_sessions(id,workspace_id,tenant_id,principal_type,principal_id,published_agent_version_id,generation,status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,0,'active',$7,$7)`,
      [
        id,
        w.id,
        w.tenantId,
        w.principalType,
        w.principalId,
        i.agentVersionId,
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
  async listMessages(id: string, o: AccessContext) {
    const s = await this.getSession(id, o);
    if (!s) return null;
    const r = await this.db.query(
      `SELECT m.*, t.status, r.id run_id FROM messages m JOIN tasks t ON t.id=m.task_id LEFT JOIN runs r ON r.task_id=t.id WHERE m.session_id=$1 ORDER BY m.generation,m.sequence`,
      [id],
    );
    return (r.rows ?? []).map(mapMessage);
  }
  async postMessage(
    id: string,
    text: string,
    key: string,
    o: AccessContext,
  ): Promise<UserMessage> {
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
        `SELECT m.*,t.status,r.id run_id FROM admissions a JOIN messages m ON m.task_id=a.task_id JOIN tasks t ON t.id=m.task_id LEFT JOIN runs r ON r.task_id=t.id WHERE a.ingress='api' AND a.idempotency_key=$1 AND a.tenant_id=$2 AND a.workspace_id=$3 AND a.principal_type=$4 AND a.principal_id=$5`,
        [key, o.tenantId, row.workspace_id, o.principalType, o.principalId],
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
      await c.query(
        `INSERT INTO tasks(id,tenant_id,workspace_id,principal_type,principal_id,policy_snapshot_version,root_task_id,parent_task_id,parent_run_id,depth,logical_step_key,node_path,status,ingress,invokable_kind,invokable_version_id,input_snapshot_ref,input_fingerprint,created_at,updated_at,session_id,generation,lane_sequence) VALUES($1,$2,$3,$4,$5,'product_session',$1,NULL,NULL,0,NULL,NULL,'queued','api','agent',$6,$7,$8,$9,$9,$10,$11,$12)`,
        [
          taskId,
          o.tenantId,
          row.workspace_id,
          o.principalType,
          o.principalId,
          row.published_agent_version_id,
          encodeRootTaskRunRequestSnapshotRef({ prompt: text }),
          fp,
          now,
          id,
          row.generation,
          seq,
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
        `INSERT INTO admissions(ingress,idempotency_key,request_fingerprint,task_id,tenant_id,workspace_id,principal_type,principal_id,policy_snapshot_version,created_at) VALUES('api',$1,$2,$3,$4,$5,$6,$7,'product_session',$8) ON CONFLICT DO NOTHING`,
        [
          key,
          fp,
          taskId,
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
    await this.db.query(
      `INSERT INTO messages(id,session_id,generation,sequence,role,text,task_id,created_at) SELECT $1,$2,$3,COALESCE(MAX(sequence),0)+1,'assistant',$4,$5,$6 FROM messages WHERE session_id=$2 AND generation=$3 ON CONFLICT DO NOTHING`,
      [randomUUID(), i.sessionId, i.generation, i.text, i.taskId, iso()],
    );
  }
  async reset(id: string, o: AccessContext, _key: string) {
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
      const s = r.rows[0],
        g = Number(s.generation) + 1,
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
