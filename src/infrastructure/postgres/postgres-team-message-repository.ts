import { randomUUID } from 'node:crypto';

import type { TeamMessageRepository } from '../../application/ports/team-message-repository.js';
import {
  TeamExecutionError,
  type OwnerScope,
} from '../../application/ports/team-execution-repository.js';
import type { TeamMessage } from '../../domain/teams/team-message.js';

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
  about_work_item_id: string | null;
  reply_to_message_id: string | null;
  kind: TeamMessage['kind'];
  dedup_key: string;
  body: string;
  priority: TeamMessage['priority'];
  requires_ack: boolean;
  status: TeamMessage['status'];
  consumed_by_task_id: string | null;
  source_task_id: string | null;
  source_run_id: string | null;
  created_at: string | Date;
  consumed_at: string | Date | null;
  acknowledged_at: string | Date | null;
  cancelled_at: string | Date | null;
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
         sender_member_run_id,recipient_member_run_id,work_item_id,attempt_id,about_work_item_id,
         reply_to_message_id,kind,dedup_key,body,priority,requires_ack,status,source_task_id,source_run_id,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,
         (SELECT COALESCE(MAX(sequence),0)+1 FROM team_messages WHERE team_run_id=$2),
         $7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'queued',$18,$19,$20)
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
        message.aboutWorkItemId,
        message.replyToMessageId,
        message.kind,
        message.dedupKey,
        message.body,
        message.priority,
        message.requiresAck,
        message.sourceTaskId,
        message.sourceRunId,
        message.createdAt,
      ],
    );
    if (result.rows?.[0]) return mapMessage(result.rows[0]);
    const existing = await this.database.query<MessageRow>(
      'SELECT * FROM team_messages WHERE team_run_id=$1 AND dedup_key=$2',
      [message.teamRunId, message.dedupKey],
    );
    if (!existing.rows?.[0])
      throw new Error('Team message could not be persisted.');
    return mapMessage(existing.rows[0]);
  }

  public async listQueuedWakeRoots() {
    const result = await this.database.query<{
      root_task_id: string;
      tenant_id: string;
      workspace_id: string;
      principal_type: string;
      principal_id: string;
    }>(`SELECT DISTINCT tr.root_task_id,tr.tenant_id,tr.workspace_id,tr.principal_type,tr.principal_id
          FROM team_messages m JOIN team_runs tr ON tr.id=m.team_run_id
         WHERE m.status='queued' ORDER BY tr.root_task_id`);
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
      `SELECT * FROM team_messages WHERE team_run_id=$1 AND recipient_member_run_id=$2 AND status='queued'
        AND ${ownerSql('', 3)} ORDER BY sequence,id`,
      [teamRunId, memberId, ...ownerValues(owner)],
    );
    return (result.rows ?? []).map(mapMessage);
  }

  public async bindToTask(input: {
    messageIds: readonly string[];
    taskId: string;
    owner: OwnerScope;
  }) {
    if (!input.messageIds.length) return [];
    const result = await this.database.query<MessageRow>(
      `UPDATE team_messages SET status='consumed',consumed_by_task_id=$2,consumed_at=now()
        WHERE id=ANY($1::uuid[]) AND status='queued' AND ${ownerSql('', 3)} RETURNING *`,
      [input.messageIds, input.taskId, ...ownerValues(input.owner)],
    );
    return (result.rows ?? []).map(mapMessage);
  }

  public async requeueDirectForFailedTask(input: {
    messageIds: readonly string[];
    taskId: string;
    owner: OwnerScope;
  }) {
    if (!input.messageIds.length) return [];
    const result = await this.database.query<MessageRow>(
      `UPDATE team_messages
          SET status='queued', consumed_by_task_id=NULL, consumed_at=NULL
        WHERE id=ANY($1::uuid[])
          AND kind='direct'
          AND status='consumed'
          AND consumed_by_task_id=$2
          AND ${ownerSql('', 3)}
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
    const claimed = await this.claimDirectBatchForTask({
      messageIds: [input.messageId],
      taskId: input.taskId,
      teamRunId: input.teamRunId,
      recipientMemberRunId: input.recipientMemberRunId,
      owner: input.owner,
    });
    if (!claimed[0]) throw new TeamExecutionError('invalid_transition');
    return claimed[0];
  }

  public async claimDirectBatchForTask(input: {
    messageIds: readonly string[];
    taskId: string;
    teamRunId: string;
    recipientMemberRunId: string;
    owner: OwnerScope;
  }): Promise<readonly TeamMessage[]> {
    if (!input.messageIds.length) return [];
    const result = await this.database.query<MessageRow>(
      `UPDATE team_messages m SET status='consumed',consumed_by_task_id=$2,consumed_at=now()
        WHERE m.id=ANY($1::uuid[]) AND m.team_run_id=$3 AND m.kind='direct' AND m.status='queued'
          AND m.recipient_member_run_id=$4 AND ${ownerSql('m', 5)}
          AND NOT EXISTS (
            SELECT 1 FROM tasks active_task
             WHERE active_task.root_task_id=(SELECT root_task_id FROM team_runs WHERE id=$3)
               AND active_task.team_member_run_id=$4 AND active_task.id<>$2 AND ${ownerSql('active_task', 5)}
               AND (active_task.status NOT IN ('completed','failed','cancelled') OR EXISTS (
                 SELECT 1 FROM runs active_run WHERE active_run.task_id=active_task.id
                   AND active_run.status NOT IN ('succeeded','failed','timed_out','cancelled'))))
        RETURNING m.*`,
      [
        input.messageIds,
        input.taskId,
        input.teamRunId,
        input.recipientMemberRunId,
        ...ownerValues(input.owner),
      ],
    );
    if ((result.rows?.length ?? 0) !== input.messageIds.length)
      throw new TeamExecutionError('invalid_transition');
    return (result.rows ?? [])
      .map(mapMessage)
      .sort((a, b) => a.sequence - b.sequence);
  }

  public async sendDirect(
    input: Parameters<TeamMessageRepository['sendDirect']>[0],
  ): Promise<TeamMessage> {
    const client = this.database.connect
      ? await this.database.connect()
      : this.database;
    try {
      await client.query('BEGIN');
      const team = await client.query<{ id: string; root_task_id: string }>(
        `SELECT id,root_task_id FROM team_runs WHERE id=$1 AND status='active' AND revision=$2 AND ${ownerSql('', 3)} FOR UPDATE`,
        [input.teamRunId, input.expectedRevision, ...ownerValues(input.owner)],
      );
      const teamRows = team.rows ?? [];
      const teamRow = teamRows[0];
      if (teamRows.length !== 1 || !teamRow)
        throw new TeamExecutionError('stale_state');
      const source = await client.query(
        `SELECT 1 FROM tasks t JOIN runs r ON r.id=$2
          WHERE t.id=$1 AND t.root_task_id=$3 AND t.team_member_run_id=$4
            AND t.team_task_kind IN ('lead_turn','work_attempt','direct_message')
            AND t.status NOT IN ('completed','failed','cancelled')
            AND r.task_id=t.id AND r.status NOT IN ('succeeded','failed','timed_out','cancelled')
            AND ${ownerSql('t', 5)} FOR SHARE`,
        [
          input.sourceTaskId,
          input.sourceRunId,
          teamRow.root_task_id,
          input.senderMemberRunId,
          ...ownerValues(input.owner),
        ],
      );
      if (!source.rows?.[0]) throw new TeamExecutionError('stale_state');
      if (input.senderMemberRunId === input.recipientMemberRunId)
        throw new TeamExecutionError('conflict');
      const members = await client.query<{ id: string; status: string }>(
        `SELECT id,status FROM team_member_runs WHERE team_run_id=$1 AND id=ANY($2::uuid[]) AND ${ownerSql('', 3)} FOR SHARE`,
        [
          input.teamRunId,
          [input.senderMemberRunId, input.recipientMemberRunId],
          ...ownerValues(input.owner),
        ],
      );
      const memberRows = members.rows ?? [];
      if (memberRows.length !== 2) throw new TeamExecutionError('not_found');
      const sender = memberRows.find(
        (member) => member.id === input.senderMemberRunId,
      );
      const recipient = memberRows.find(
        (member) => member.id === input.recipientMemberRunId,
      );
      if (
        !sender ||
        !recipient ||
        ['stopped', 'failed'].includes(sender.status) ||
        ['stopped', 'failed'].includes(recipient.status)
      )
        throw new TeamExecutionError('not_allowed');
      if (input.aboutWorkItemId) {
        const work = await client.query(
          `SELECT 1 FROM team_work_items WHERE id=$1 AND team_run_id=$2 AND ${ownerSql('', 3)} FOR SHARE`,
          [input.aboutWorkItemId, input.teamRunId, ...ownerValues(input.owner)],
        );
        if (!work.rows?.[0]) throw new TeamExecutionError('not_found');
      }
      if (input.replyToMessageId) {
        const parent = await client.query<MessageRow>(
          `SELECT * FROM team_messages WHERE id=$1 AND team_run_id=$2 AND kind='direct' AND ${ownerSql('', 3)} FOR SHARE`,
          [
            input.replyToMessageId,
            input.teamRunId,
            ...ownerValues(input.owner),
          ],
        );
        if (!parent.rows?.[0]) throw new TeamExecutionError('not_found');
      }
      const result = await client.query<MessageRow>(
        `INSERT INTO team_messages
          (id,team_run_id,tenant_id,workspace_id,principal_type,principal_id,sequence,
           sender_member_run_id,recipient_member_run_id,about_work_item_id,reply_to_message_id,kind,dedup_key,body,
           priority,requires_ack,status,source_task_id,source_run_id,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,(SELECT COALESCE(MAX(sequence),0)+1 FROM team_messages WHERE team_run_id=$2),
           $7,$8,$9,$10,'direct',$11,$12,$13,$14,'queued',$15,$16,now())
         ON CONFLICT (team_run_id,dedup_key) DO NOTHING RETURNING *`,
        [
          randomUUID(),
          input.teamRunId,
          ...ownerValues(input.owner),
          input.senderMemberRunId,
          input.recipientMemberRunId,
          input.aboutWorkItemId ?? null,
          input.replyToMessageId ?? null,
          input.dedupKey,
          input.body,
          input.priority ?? 'normal',
          input.requiresAck ?? false,
          input.sourceTaskId,
          input.sourceRunId,
        ],
      );
      let row = result.rows?.[0];
      if (!row) {
        const replay = await client.query<MessageRow>(
          `SELECT * FROM team_messages WHERE team_run_id=$1 AND dedup_key=$2 AND ${ownerSql('', 3)} FOR SHARE`,
          [input.teamRunId, input.dedupKey, ...ownerValues(input.owner)],
        );
        row = replay.rows?.[0];
        if (
          !row ||
          row.kind !== 'direct' ||
          row.sender_member_run_id !== input.senderMemberRunId ||
          row.recipient_member_run_id !== input.recipientMemberRunId ||
          row.body !== input.body
        )
          throw new TeamExecutionError('conflict');
      }
      await client.query('COMMIT');
      return mapMessage(row);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      if ('release' in client && typeof client.release === 'function')
        client.release();
    }
  }

  public async acknowledgeDirect(input: {
    messageId: string;
    recipientMemberRunId: string;
    sourceTaskId: string;
    sourceRunId: string;
    owner: OwnerScope;
  }): Promise<TeamMessage> {
    const source = await this.database.query(
      `SELECT 1 FROM tasks t JOIN runs r ON r.id=$2
        WHERE t.id=$1 AND t.team_member_run_id=$3 AND t.status NOT IN ('completed','failed','cancelled')
          AND r.task_id=t.id AND r.status NOT IN ('succeeded','failed','timed_out','cancelled') AND ${ownerSql('t', 4)}`,
      [
        input.sourceTaskId,
        input.sourceRunId,
        input.recipientMemberRunId,
        ...ownerValues(input.owner),
      ],
    );
    if (!source.rows?.[0]) throw new TeamExecutionError('stale_state');
    const result = await this.database.query<MessageRow>(
      `UPDATE team_messages SET status='acknowledged',acknowledged_at=COALESCE(acknowledged_at,now())
        WHERE id=$1 AND kind='direct' AND recipient_member_run_id=$2 AND requires_ack=true
          AND status IN ('consumed','acknowledged') AND ${ownerSql('', 3)} RETURNING *`,
      [
        input.messageId,
        input.recipientMemberRunId,
        ...ownerValues(input.owner),
      ],
    );
    if (!result.rows?.[0]) throw new TeamExecutionError('invalid_transition');
    return mapMessage(result.rows[0]);
  }

  public async listDirectForTeamRun(teamRunId: string, owner: OwnerScope) {
    const result = await this.database.query<MessageRow>(
      `SELECT * FROM team_messages WHERE team_run_id=$1 AND kind='direct'
        AND status IN ('consumed','acknowledged') AND ${ownerSql('', 2)} ORDER BY sequence,id`,
      [teamRunId, ...ownerValues(owner)],
    );
    return (result.rows ?? []).map(mapMessage);
  }

  public async listForTeamRun(teamRunId: string, owner: OwnerScope) {
    const result = await this.database.query<MessageRow>(
      `SELECT * FROM team_messages WHERE team_run_id=$1 AND ${ownerSql('', 2)} ORDER BY sequence,id`,
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
  const p = alias ? `${alias}.` : '';
  return `${p}tenant_id=$${start} AND ${p}workspace_id=$${start + 1} AND ${p}principal_type=$${start + 2} AND ${p}principal_id=$${start + 3}`;
}
function iso(value: string | Date | null): string | null {
  return value === null
    ? null
    : value instanceof Date
      ? value.toISOString()
      : value;
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
    aboutWorkItemId: row.about_work_item_id,
    replyToMessageId: row.reply_to_message_id,
    kind: row.kind,
    dedupKey: row.dedup_key,
    body: row.body,
    priority: row.priority ?? 'normal',
    requiresAck: Boolean(row.requires_ack),
    status: row.status,
    consumedByTaskId: row.consumed_by_task_id,
    sourceTaskId: row.source_task_id,
    sourceRunId: row.source_run_id,
    createdAt: iso(row.created_at)!,
    consumedAt: iso(row.consumed_at),
    acknowledgedAt: iso(row.acknowledged_at),
    cancelledAt: iso(row.cancelled_at),
  });
}
