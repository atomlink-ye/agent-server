import { randomUUID } from 'node:crypto';
import { boundedRunEventPayload } from '../../application/ports/run-events.js';
import type {
  RunEvent,
  RunEventRepository,
  RunEventType,
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
  async append(
    runId: string,
    type: RunEventType,
    payload: RunEvent['payload'],
  ) {
    const boundedPayload = boundedRunEventPayload(payload);
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    for (;;) {
      const r = await this.db.query<any>(
        `INSERT INTO run_events(id,run_id,sequence,type,payload,created_at) SELECT $1,$2,COALESCE(MAX(sequence),0)+1,$3,$4::jsonb,$5 FROM run_events WHERE run_id=$2 ON CONFLICT (run_id,sequence) DO NOTHING RETURNING id,run_id,sequence,type,payload,created_at`,
        [id, runId, type, JSON.stringify(boundedPayload), createdAt],
      );
      const x = r.rows?.[0];
      if (!x) continue;
      return {
        id: x.id,
        runId: x.run_id,
        sequence: Number(x.sequence),
        type: x.type,
        payload: boundedRunEventPayload(x.payload),
        createdAt: new Date(x.created_at).toISOString(),
      };
    }
  }
  async list(runId: string, after: number, limit = 100) {
    const r = await this.db.query<any>(
      'SELECT id,run_id,sequence,type,payload,created_at FROM run_events WHERE run_id=$1 AND sequence>$2 ORDER BY sequence LIMIT $3',
      [runId, after, limit],
    );
    const events = (r.rows ?? []).map((x) => ({
      ...x,
      payload: boundedRunEventPayload(x.payload),
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
