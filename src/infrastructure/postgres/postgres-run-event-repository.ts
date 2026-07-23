import { randomUUID } from 'node:crypto';
import type {
  RunEvent,
  RunEventRepository,
  RunEventType,
  RuntimeSessionBinding,
} from '../../application/ports/run-events.js';
export class PostgresRunEventRepository implements RunEventRepository {
  public constructor(
    private readonly db: {
      query<R = Record<string, unknown>>(
        sql: string,
        values?: readonly unknown[],
      ): Promise<{ rows?: readonly R[]; rowCount?: number | null }>;
    },
  ) {}
  async bind(input: RuntimeSessionBinding) {
    await this.db.query(
      `INSERT INTO runtime_session_bindings(run_id,provider_agent_id,created_at) VALUES($1,$2,$3) ON CONFLICT(run_id) DO UPDATE SET provider_agent_id=COALESCE(EXCLUDED.provider_agent_id,runtime_session_bindings.provider_agent_id)`,
      [input.runId, input.providerAgentId ?? null, input.createdAt],
    );
  }
  async getBinding(runId: string) {
    const r = await this.db.query<any>(
      'SELECT run_id,provider_agent_id,created_at FROM runtime_session_bindings WHERE run_id=$1',
      [runId],
    );
    const x = r.rows?.[0];
    return x
      ? {
          runId: x.run_id,
          ...(x.provider_agent_id
            ? { providerAgentId: x.provider_agent_id }
            : {}),
          createdAt: new Date(x.created_at).toISOString(),
        }
      : null;
  }
  async append(
    runId: string,
    type: RunEventType,
    payload: RunEvent['payload'],
  ) {
    const r = await this.db.query<any>(
      `INSERT INTO run_events(id,run_id,sequence,type,payload,created_at) SELECT $1,$2,COALESCE(MAX(sequence),0)+1,$3,$4::jsonb,$5 FROM run_events WHERE run_id=$2 ON CONFLICT(run_id,type) DO UPDATE SET type=EXCLUDED.type RETURNING id,run_id,sequence,type,payload,created_at`,
      [
        randomUUID(),
        runId,
        type,
        JSON.stringify(payload),
        new Date().toISOString(),
      ],
    );
    const x = r.rows![0]!;
    return {
      id: x.id,
      runId: x.run_id,
      sequence: Number(x.sequence),
      type: x.type,
      payload: x.payload,
      createdAt: new Date(x.created_at).toISOString(),
    };
  }
  async list(runId: string, after: number, limit = 100) {
    const r = await this.db.query<any>(
      'SELECT id,run_id,sequence,type,payload,created_at FROM run_events WHERE run_id=$1 AND sequence>$2 ORDER BY sequence LIMIT $3',
      [runId, after, limit],
    );
    const events = (r.rows ?? []).map((x) => ({
      ...x,
      runId: x.run_id,
      sequence: Number(x.sequence),
      createdAt: new Date(x.created_at).toISOString(),
    }));
    return {
      events,
      nextCursor: events.length === limit ? events.at(-1)!.sequence : null,
    };
  }
}
