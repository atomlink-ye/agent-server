import type { TeamMessageRepository } from '../../application/ports/team-message-repository.js';
import {
  TeamExecutionError,
  type OwnerScope,
} from '../../application/ports/team-execution-repository.js';
import type { TeamMessage } from '../../domain/teams/team-message.js';
import { randomUUID } from 'node:crypto';

interface Queryable {
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{
    readonly rows?: readonly Row[];
    readonly rowCount?: number | null;
  }>;
}
interface Connectable extends Queryable {
  connect(): Promise<Queryable & { release(): void }>;
}
interface MessageRow {
  id: string;
  team_run_id: string;
  tenant_id: string;
  workspace_id: string;
  principal_type: string;
  principal_id: string;
  sequence: number;
  sender_member_run_id: string | null;
  recipient_member_run_id: string;
  work_item_id: string | null;
  attempt_id: string | null;
  kind: TeamMessage['kind'];
  dedup_key: string;
  body: string;
  status: TeamMessage['status'];
  consumed_by_task_id: string | null;
  created_at: string | Date;
  consumed_at: string | Date | null;
}

export class PostgresTeamMessageRepository implements TeamMessageRepository {
  public constructor(
    private readonly database: Queryable &
      Partial<Pick<Connectable, 'connect'>>,
  ) {}

  public async create(message: TeamMessage): Promise<TeamMessage> {
    if (message.kind === 'direct')
      throw new Error(
        'Direct Team messages require the fenced send operation.',
      );
    const result = await this.database.query<MessageRow>(
      `INSERT INTO team_messages
        (id,team_run_id,tenant_id,workspace_id,principal_type,principal_id,sequence,
         sender_member_run_id,recipient_member_run_id,work_item_id,attempt_id,kind,
         dedup_key,body,status,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,
         (SELECT COALESCE(MAX(sequence),0)+1 FROM team_messages WHERE team_run_id=$2),
         $7,$8,$9,$10,$11,$12,$13,'queued',$14)
       ON CONFLICT (team_run_id,dedup_key) DO UPDATE SET dedup_key=EXCLUDED.dedup_key
       RETURNING *`,
      [
        message.id,
        message.teamRunId,
        message.tenantId,
        message.workspaceId,
        message.principalType,
        message.principalId,
        message.senderMemberRunId,
        message.recipientMemberRunId,
        message.workItemId,
        message.attemptId,
        message.kind,
        message.dedupKey,
        message.body,
        message.createdAt,
      ],
    );
    if (!result.rows?.[0]) {
      const existing = await this.database.query<MessageRow>(
        'SELECT * FROM team_messages WHERE team_run_id=$1 AND dedup_key=$2',
        [message.teamRunId, message.dedupKey],
      );
      if (!existing.rows?.[0])
        throw new Error('Team message could not be persisted.');
      return mapMessage(existing.rows[0]);
    }
    return mapMessage(result.rows[0]);
  }

  public async listQueuedWakeRoots() {
    const result = await this.database.query<{
      root_task_id: string;
      tenant_id: string;
      workspace_id: string;
      principal_type: string;
      principal_id: string;
    }>(
      `SELECT DISTINCT tr.root_task_id,tr.tenant_id,tr.workspace_id,tr.principal_type,tr.principal_id
         FROM team_messages m
         JOIN team_runs tr ON tr.id=m.team_run_id
        WHERE m.status='queued'
        ORDER BY tr.root_task_id`,
    );
    return (result.rows ?? []).map((row) => ({
      rootTaskId: row.root_task_id,
      owner: {
        tenantId: row.tenant_id,
        workspaceId: row.workspace_id,
        principalType: row.principal_type,
        principalId: row.principal_id,
      },
    }));
  }
  public async listQueuedForMember(
    teamRunId: string,
    memberId: string,
    owner: OwnerScope,
  ) {
    const result = await this.database.query<MessageRow>(
      `SELECT * FROM team_messages
       WHERE team_run_id=$1 AND recipient_member_run_id=$2 AND status='queued'
         AND tenant_id=$3 AND workspace_id=$4 AND principal_type=$5 AND principal_id=$6
       ORDER BY sequence,id`,
      [teamRunId, memberId, ...ownerValues(owner)],
    );
    return (result.rows ?? []).map(mapMessage);
  }

  public async bindToTask(input: {
    messageIds: readonly string[];
    taskId: string;
    owner: OwnerScope;
  }) {
    if (input.messageIds.length === 0) return [];
    const result = await this.database.query<MessageRow>(
      `UPDATE team_messages SET status='consumed', consumed_by_task_id=$2, consumed_at=now()
       WHERE id = ANY($1::uuid[]) AND status='queued'
         AND tenant_id=$3 AND workspace_id=$4 AND principal_type=$5 AND principal_id=$6
       RETURNING *`,
      [input.messageIds, input.taskId, ...ownerValues(input.owner)],
    );
    return (result.rows ?? []).map(mapMessage);
  }

  public async claimDirectForTask(input: {
    messageId: string;
    taskId: string;
    teamRunId: string;
    recipientMemberRunId: string;
    owner: OwnerScope;
  }): Promise<TeamMessage> {
    const result = await this.database.query<MessageRow>(
      `UPDATE team_messages m
          SET status='consumed', consumed_by_task_id=$2, consumed_at=now()
        WHERE m.id=$1 AND m.team_run_id=$3 AND m.kind='direct' AND m.status='queued'
          AND m.recipient_member_run_id=$4 AND ${ownerSql('m', 5)}
          AND NOT EXISTS (
            SELECT 1 FROM tasks active_task
             WHERE active_task.root_task_id=(SELECT root_task_id FROM team_runs WHERE id=$3)
               AND active_task.team_member_run_id=$4 AND active_task.id<>$2
               AND ${ownerSql('active_task', 5)}
               AND (
                 active_task.status NOT IN ('completed','failed','cancelled')
                 OR EXISTS (
                   SELECT 1 FROM runs active_run
                    WHERE active_run.task_id=active_task.id
                      AND active_run.status NOT IN ('succeeded','failed','timed_out','cancelled')
                 )
               )
          )
       RETURNING m.*`,
      [
        input.messageId,
        input.taskId,
        input.teamRunId,
        input.recipientMemberRunId,
        ...ownerValues(input.owner),
      ],
    );
    if (!result.rows?.[0]) throw new TeamExecutionError('invalid_transition');
    return mapMessage(result.rows[0]);
  }

  public async markDirectDelivered(input: {
    messageId: string;
    taskId: string;
    owner: OwnerScope;
  }): Promise<TeamMessage | null> {
    const result = await this.database.query<MessageRow>(
      `UPDATE team_messages SET status='delivered'
        WHERE id=$1 AND kind='direct' AND status='consumed'
          AND consumed_by_task_id=$2 AND ${ownerSql('', 3)}
       RETURNING *`,
      [input.messageId, input.taskId, ...ownerValues(input.owner)],
    );
    return result.rows?.[0] ? mapMessage(result.rows[0]) : null;
  }

  public async sendDirect(input: {
    teamRunId: string;
    senderMemberRunId: string;
    recipientMemberRunId: string;
    dedupKey: string;
    body: string;
    sourceTaskId: string;
    sourceRunId: string;
    expectedRevision: number;
    owner: OwnerScope;
  }): Promise<TeamMessage> {
    const client = this.database.connect
      ? await this.database.connect()
      : this.database;
    try {
      await client.query('BEGIN');
      const team = await client.query<{ id: string; root_task_id: string }>(
        `SELECT id,root_task_id FROM team_runs
          WHERE id=$1 AND status='active'
            AND revision=$2 AND ${ownerSql('', 3)} FOR UPDATE`,
        [input.teamRunId, input.expectedRevision, ...ownerValues(input.owner)],
      );
      if (team.rowCount !== 1 || !team.rows?.[0])
        throw new TeamExecutionError('stale_state');
      const source = await client.query<{ id: string }>(
        `SELECT t.id FROM tasks t JOIN runs r ON r.id=$2
          WHERE t.id=$1 AND t.root_task_id=$3 AND t.team_member_run_id=$4
            AND t.team_task_kind='lead_turn'
            AND t.status='active' AND r.task_id=t.id AND r.status='running'
            AND ${ownerSql('t', 5)} FOR SHARE`,
        [
          input.sourceTaskId,
          input.sourceRunId,
          team.rows[0].root_task_id,
          input.senderMemberRunId,
          ...ownerValues(input.owner),
        ],
      );
      if (source.rowCount !== 1) throw new TeamExecutionError('stale_state');
      if (input.senderMemberRunId === input.recipientMemberRunId)
        throw new TeamExecutionError('conflict');
      const members = await client.query<{
        id: string;
        role: 'lead' | 'member';
        status: 'starting' | 'active' | 'idle' | 'stopped' | 'failed';
      }>(
        `SELECT id,role,status FROM team_member_runs
          WHERE team_run_id=$1 AND id=ANY($2::uuid[])
            AND ${ownerSql('', 3)} FOR SHARE`,
        [
          input.teamRunId,
          [input.senderMemberRunId, input.recipientMemberRunId],
          ...ownerValues(input.owner),
        ],
      );
      if (members.rowCount !== 2) throw new TeamExecutionError('not_found');
      const sender = members.rows!.find(
        (member) => member.id === input.senderMemberRunId,
      );
      const recipient = members.rows!.find(
        (member) => member.id === input.recipientMemberRunId,
      );
      if (!sender || !recipient || sender.status !== 'active')
        throw new TeamExecutionError('stale_state');
      if (sender.role !== 'lead' || recipient.role !== 'member')
        throw new TeamExecutionError('not_allowed');
      if (recipient.status === 'stopped' || recipient.status === 'failed')
        throw new TeamExecutionError('not_allowed');
      const result = await client.query<MessageRow>(
        `INSERT INTO team_messages
          (id,team_run_id,tenant_id,workspace_id,principal_type,principal_id,sequence,
           sender_member_run_id,recipient_member_run_id,kind,dedup_key,body,status,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,
           (SELECT COALESCE(MAX(sequence),0)+1 FROM team_messages WHERE team_run_id=$2),
           $7,$8,'direct',$9,$10,'queued',now())
         ON CONFLICT (team_run_id,dedup_key) DO NOTHING
         RETURNING *`,
        [
          randomUUID(),
          input.teamRunId,
          ...ownerValues(input.owner),
          input.senderMemberRunId,
          input.recipientMemberRunId,
          input.dedupKey,
          input.body,
        ],
      );
      let message = result.rows?.[0];
      if (!message) {
        const replay = await client.query<MessageRow>(
          `SELECT * FROM team_messages
            WHERE team_run_id=$1 AND dedup_key=$2 AND ${ownerSql('', 3)} FOR SHARE`,
          [input.teamRunId, input.dedupKey, ...ownerValues(input.owner)],
        );
        message = replay.rows?.[0];
        if (
          !message ||
          message.kind !== 'direct' ||
          !['queued', 'consumed', 'delivered', 'read'].includes(
            message.status,
          ) ||
          message.sender_member_run_id !== input.senderMemberRunId ||
          message.recipient_member_run_id !== input.recipientMemberRunId ||
          message.body !== input.body ||
          message.team_run_id !== input.teamRunId ||
          message.tenant_id !== input.owner.tenantId ||
          message.workspace_id !== input.owner.workspaceId ||
          message.principal_type !== input.owner.principalType ||
          message.principal_id !== input.owner.principalId
        )
          throw new TeamExecutionError('conflict');
      }
      await client.query('COMMIT');
      return mapMessage(message);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      if ('release' in client && typeof client.release === 'function')
        client.release();
    }
  }

  public async listDirectForTeamRun(
    teamRunId: string,
    owner: OwnerScope,
  ): Promise<readonly TeamMessage[]> {
    const result = await this.database.query<MessageRow>(
      `SELECT * FROM team_messages
        WHERE team_run_id=$1 AND kind='direct'
          AND status IN ('delivered','read') AND ${ownerSql('', 2)}
        ORDER BY sequence,id`,
      [teamRunId, ...ownerValues(owner)],
    );
    return (result.rows ?? []).map(mapMessage);
  }
}

function ownerValues(owner: OwnerScope): readonly string[] {
  return [
    owner.tenantId,
    owner.workspaceId,
    owner.principalType,
    owner.principalId,
  ];
}
function ownerSql(alias: string, start: number): string {
  const prefix = alias ? `${alias}.` : '';
  return `${prefix}tenant_id=$${start} AND ${prefix}workspace_id=$${start + 1} AND ${prefix}principal_type=$${start + 2} AND ${prefix}principal_id=$${start + 3}`;
}
function mapMessage(row: MessageRow): TeamMessage {
  return Object.freeze({
    id: row.id,
    teamRunId: row.team_run_id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    principalType: row.principal_type,
    principalId: row.principal_id,
    sequence: Number(row.sequence),
    senderMemberRunId: row.sender_member_run_id,
    recipientMemberRunId: row.recipient_member_run_id,
    workItemId: row.work_item_id,
    attemptId: row.attempt_id,
    kind: row.kind,
    dedupKey: row.dedup_key,
    body: row.body,
    status: row.status,
    consumedByTaskId: row.consumed_by_task_id,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : row.created_at,
    consumedAt:
      row.consumed_at instanceof Date
        ? row.consumed_at.toISOString()
        : row.consumed_at,
  });
}
