import { randomUUID } from 'node:crypto';

import type { CollaborationRepository } from '../../application/ports/collaboration-repository.js';
import {
  TeamExecutionError,
  type OwnerScope,
} from '../../application/ports/team-execution-repository.js';
import type {
  CollaborationCheckpoint,
  CollaborationSubmission,
} from '../../domain/collaboration/collaboration.js';
import type { TeamWorkItem } from '../../domain/teams/team-work-item.js';
import type { TeamWorkItemAttempt } from '../../domain/teams/team-work-item-attempt.js';

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
interface WorkRow {
  id: string;
  team_run_id: string;
  subject: string;
  description: string | null;
  status: TeamWorkItem['status'];
  owner_member_id: string | null;
  created_by_member_id: string;
  completion_summary: string | null;
  execution_task_id: string | null;
  tenant_id: string;
  workspace_id: string;
  principal_type: string;
  principal_id: string;
  created_at: string | Date;
  updated_at: string | Date;
  completed_at: string | Date | null;
}
interface AttemptRow {
  id: string;
  work_item_id: string;
  team_run_id: string;
  attempt_no: number;
  assignee_member_id: string;
  requested_by_lead_task_id: string;
  feedback: string | null;
  execution_task_id: string | null;
  status: TeamWorkItemAttempt['status'];
  result_summary: string | null;
  tenant_id: string;
  workspace_id: string;
  principal_type: string;
  principal_id: string;
  created_at: string | Date;
  updated_at: string | Date;
  completed_at: string | Date | null;
}
interface CheckpointRow {
  id: string;
  team_run_id: string;
  work_item_id: string;
  participant_member_run_id: string;
  summary: string;
  next_step: string | null;
  blocker: string | null;
  evidence_refs: string[];
  created_at: string | Date;
}
interface SubmissionRow {
  id: string;
  team_run_id: string;
  work_item_id: string;
  attempt_no: number;
  submitted_by_member_run_id: string;
  summary: string;
  evidence_refs: string[];
  artifact_refs: string[];
  created_at: string | Date;
}

export class PostgresCollaborationRepository implements CollaborationRepository {
  public constructor(
    private readonly database: Queryable & Partial<Pick<Connectable, 'connect'>>,
  ) {}

  public async createOpenWork(input: Parameters<CollaborationRepository['createOpenWork']>[0]) {
    return this.transaction(async (client) => {
      await this.rejectDuplicateCommand(client, input.sourceRunId, input.commandHash);
      const team = await this.lockTeam(client, input.teamRunId, input.expectedRevision, input.owner);
      await assertLiveSource(client, {
        taskId: input.sourceTaskId,
        runId: input.sourceRunId,
        rootTaskId: team.root_task_id,
        memberId: input.createdByMemberId,
        owner: input.owner,
      });
      const creator = await client.query<{ role: string; status: string }>(
        `SELECT role,status FROM team_member_runs WHERE id=$1 AND team_run_id=$2 AND ${ownerSql('', 3)} FOR SHARE`,
        [input.createdByMemberId, input.teamRunId, ...ownerValues(input.owner)],
      );
      if (!creator.rows?.[0] || creator.rows[0].role !== 'lead')
        throw new TeamExecutionError('not_allowed');
      await this.assertDependencies(client, input.teamRunId, input.dependsOnWorkItemIds, input.owner);
      const count = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM team_work_items WHERE team_run_id=$1 AND ${ownerSql('', 2)}`,
        [input.teamRunId, ...ownerValues(input.owner)],
      );
      if (Number(count.rows?.[0]?.count ?? 0) >= 4)
        throw new TeamExecutionError('limit_exceeded');
      const now = new Date().toISOString();
      const id = randomUUID();
      const inserted = await client.query<WorkRow>(
        `INSERT INTO team_work_items
          (id,team_run_id,subject,description,status,owner_member_id,created_by_member_id,
           tenant_id,workspace_id,principal_type,principal_id,created_at,updated_at)
         VALUES ($1,$2,$3,$4,'open',NULL,$5,$6,$7,$8,$9,$10,$10)
         RETURNING *`,
        [
          id,
          input.teamRunId,
          input.subject,
          input.description,
          input.createdByMemberId,
          ...ownerValues(input.owner),
          now,
        ],
      );
      if (!inserted.rows?.[0]) throw new TeamExecutionError('conflict');
      await insertDependencies(client, input.teamRunId, id, input.dependsOnWorkItemIds, input.owner);
      await client.query(
        `UPDATE team_runs SET revision=revision+1, updated_at=$2 WHERE id=$1`,
        [input.teamRunId, now],
      );
      await this.recordCommand(client, input.sourceRunId, input.commandHash, 'collaboration_board_create_open', { work_item_id: id }, now);
      return mapWork(inserted.rows[0]);
    });
  }

  public async assignOpenWork(input: Parameters<CollaborationRepository['assignOpenWork']>[0]) {
    return this.assignOrClaim({ ...input, claimant: false });
  }

  public async claimOpenWork(input: Parameters<CollaborationRepository['claimOpenWork']>[0]) {
    return this.assignOrClaim({
      teamRunId: input.teamRunId,
      workItemId: input.workItemId,
      assigneeMemberId: input.claimantMemberId,
      actorMemberId: input.claimantMemberId,
      sourceTaskId: input.sourceTaskId,
      sourceRunId: input.sourceRunId,
      commandHash: input.commandHash,
      expectedRevision: input.expectedRevision,
      owner: input.owner,
      claimant: true,
    });
  }

  public async blockCurrentAttempt(input: Parameters<CollaborationRepository['blockCurrentAttempt']>[0]) {
    return this.transaction(async (client) => {
      const team = await client.query<{ root_task_id: string }>(
        `SELECT root_task_id FROM team_runs WHERE id=$1 AND status='active' AND ${ownerSql('', 2)} FOR UPDATE`,
        [input.teamRunId, ...ownerValues(input.owner)],
      );
      if (!team.rows?.[0]) throw new TeamExecutionError('team_terminal');
      await assertLiveSource(client, {
        taskId: input.sourceTaskId,
        runId: input.sourceRunId,
        rootTaskId: team.rows[0].root_task_id,
        memberId: input.participantMemberId,
        owner: input.owner,
      });
      const attempt = await client.query<AttemptRow>(
        `UPDATE team_work_item_attempts
            SET status='blocked',result_summary=$5,completed_at=now(),updated_at=now()
          WHERE id=$1 AND team_run_id=$2 AND work_item_id=$3
            AND assignee_member_id=$4 AND execution_task_id=$6 AND status='running'
            AND ${ownerSql('', 7)}
          RETURNING *`,
        [
          input.attemptId,
          input.teamRunId,
          input.workItemId,
          input.participantMemberId,
          input.summary,
          input.sourceTaskId,
          ...ownerValues(input.owner),
        ],
      );
      if (!attempt.rows?.[0]) throw new TeamExecutionError('invalid_transition');
      const work = await client.query<WorkRow>(
        `UPDATE team_work_items SET status='blocked',updated_at=now()
          WHERE id=$1 AND team_run_id=$2 AND owner_member_id=$3 AND status='in_progress'
            AND ${ownerSql('', 4)} RETURNING *`,
        [input.workItemId, input.teamRunId, input.participantMemberId, ...ownerValues(input.owner)],
      );
      if (!work.rows?.[0]) throw new TeamExecutionError('invalid_transition');
      await client.query('UPDATE team_runs SET revision=revision+1, updated_at=now() WHERE id=$1', [input.teamRunId]);
      return { item: mapWork(work.rows[0]), attempt: mapAttempt(attempt.rows[0]) };
    });
  }

  public async resumeBlockedWork(input: Parameters<CollaborationRepository['resumeBlockedWork']>[0]) {
    return this.transaction(async (client) => {
      await this.rejectDuplicateCommand(client, input.sourceRunId, input.commandHash);
      const team = await this.lockTeam(client, input.teamRunId, input.expectedRevision, input.owner);
      await assertLiveSource(client, {
        taskId: input.sourceTaskId,
        runId: input.sourceRunId,
        rootTaskId: team.root_task_id,
        memberId: input.actorMemberId,
        owner: input.owner,
      });
      const current = await client.query<WorkRow>(
        `SELECT * FROM team_work_items WHERE id=$1 AND team_run_id=$2 AND status='blocked' AND ${ownerSql('', 3)} FOR UPDATE`,
        [input.workItemId, input.teamRunId, ...ownerValues(input.owner)],
      );
      if (!current.rows?.[0]) throw new TeamExecutionError('invalid_transition');
      await assertAvailableMember(client, input.teamRunId, input.assigneeMemberId, input.owner);
      await assertMemberHasNoPendingWork(client, input.teamRunId, input.assigneeMemberId, team.root_task_id, input.owner, input.sourceTaskId);
      const latest = await client.query<AttemptRow>(
        `SELECT * FROM team_work_item_attempts WHERE team_run_id=$1 AND work_item_id=$2 AND ${ownerSql('', 3)} ORDER BY attempt_no DESC LIMIT 1 FOR UPDATE`,
        [input.teamRunId, input.workItemId, ...ownerValues(input.owner)],
      );
      if (!latest.rows?.[0] || latest.rows[0].status !== 'blocked')
        throw new TeamExecutionError('invalid_transition');
      const attemptNo = latest.rows[0].attempt_no + 1;
      if (attemptNo > 2) throw new TeamExecutionError('limit_exceeded');
      const now = new Date().toISOString();
      const attemptId = randomUUID();
      const attempt = await client.query<AttemptRow>(
        `INSERT INTO team_work_item_attempts
          (id,work_item_id,team_run_id,attempt_no,assignee_member_id,requested_by_lead_task_id,
           feedback,status,tenant_id,workspace_id,principal_type,principal_id,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'queued',$8,$9,$10,$11,$12,$12) RETURNING *`,
        [attemptId, input.workItemId, input.teamRunId, attemptNo, input.assigneeMemberId, input.sourceTaskId, input.feedback, ...ownerValues(input.owner), now],
      );
      const work = await client.query<WorkRow>(
        `UPDATE team_work_items SET status='pending',owner_member_id=$3,updated_at=$4
          WHERE id=$1 AND team_run_id=$2 AND status='blocked' AND ${ownerSql('', 5)} RETURNING *`,
        [input.workItemId, input.teamRunId, input.assigneeMemberId, now, ...ownerValues(input.owner)],
      );
      if (!attempt.rows?.[0] || !work.rows?.[0])
        throw new TeamExecutionError('stale_state');
      await insertWakeMessage(client, {
        teamRunId: input.teamRunId,
        senderMemberId: input.actorMemberId,
        recipientMemberId: input.assigneeMemberId,
        workItemId: input.workItemId,
        attemptId,
        sourceTaskId: input.sourceTaskId,
        sourceRunId: input.sourceRunId,
        body: 'feedback_ready',
        dedupKey: `collaboration:${input.assigneeMemberId}:feedback:${attemptId}`,
        owner: input.owner,
        now,
      });
      await client.query("UPDATE team_runs SET revision=revision+1, control_state='member_work_running', updated_at=$2 WHERE id=$1", [input.teamRunId, now]);
      await this.recordCommand(client, input.sourceRunId, input.commandHash, 'collaboration_board_resume', { work_item_id: input.workItemId, attempt_id: attemptId }, now);
      return { item: mapWork(work.rows[0]), attempt: mapAttempt(attempt.rows[0]) };
    });
  }

  public async recordCheckpoint(input: Parameters<CollaborationRepository['recordCheckpoint']>[0]) {
    return this.transaction(async (client) => {
      const team = await client.query<{ root_task_id: string }>(
        `SELECT root_task_id FROM team_runs WHERE id=$1 AND status='active' AND ${ownerSql('', 2)} FOR SHARE`,
        [input.teamRunId, ...ownerValues(input.owner)],
      );
      if (!team.rows?.[0]) throw new TeamExecutionError('team_terminal');
      await assertLiveSource(client, {
        taskId: input.sourceTaskId,
        runId: input.sourceRunId,
        rootTaskId: team.rows[0].root_task_id,
        memberId: input.participantMemberId,
        owner: input.owner,
      });
      const work = await client.query<{ id: string }>(
        `SELECT id FROM team_work_items WHERE id=$1 AND team_run_id=$2 AND owner_member_id=$3
          AND status IN ('in_progress','blocked') AND ${ownerSql('', 4)} FOR SHARE`,
        [input.workItemId, input.teamRunId, input.participantMemberId, ...ownerValues(input.owner)],
      );
      if (!work.rows?.[0]) throw new TeamExecutionError('invalid_transition');
      if (input.attemptId) {
        const attempt = await client.query<{ id: string }>(
          `SELECT id FROM team_work_item_attempts WHERE id=$1 AND work_item_id=$2 AND team_run_id=$3
            AND assignee_member_id=$4 AND status IN ('running','blocked') AND ${ownerSql('', 5)} FOR SHARE`,
          [input.attemptId, input.workItemId, input.teamRunId, input.participantMemberId, ...ownerValues(input.owner)],
        );
        if (!attempt.rows?.[0]) throw new TeamExecutionError('invalid_transition');
      }
      const row = await client.query<CheckpointRow>(
        `INSERT INTO collaboration_checkpoints
          (id,team_run_id,work_item_id,attempt_id,participant_member_run_id,source_task_id,source_run_id,
           summary,next_step,blocker,evidence_refs,tenant_id,workspace_id,principal_type,principal_id,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::text[],$12,$13,$14,$15,$16) RETURNING *`,
        [randomUUID(), input.teamRunId, input.workItemId, input.attemptId, input.participantMemberId, input.sourceTaskId, input.sourceRunId, input.summary, input.nextStep, input.blocker, input.evidenceRefs, ...ownerValues(input.owner), new Date().toISOString()],
      );
      if (!row.rows?.[0]) throw new TeamExecutionError('conflict');
      return mapCheckpoint(row.rows[0]);
    });
  }

  public async submitCurrentAttempt(input: Parameters<CollaborationRepository['submitCurrentAttempt']>[0]) {
    return this.transaction(async (client) => {
      const team = await client.query<{ root_task_id: string }>(
        `SELECT root_task_id FROM team_runs WHERE id=$1 AND status='active' AND ${ownerSql('', 2)} FOR UPDATE`,
        [input.teamRunId, ...ownerValues(input.owner)],
      );
      if (!team.rows?.[0]) throw new TeamExecutionError('team_terminal');
      await assertLiveSource(client, {
        taskId: input.sourceTaskId,
        runId: input.sourceRunId,
        rootTaskId: team.rows[0].root_task_id,
        memberId: input.participantMemberId,
        owner: input.owner,
      });
      const attempt = await client.query<AttemptRow>(
        `UPDATE team_work_item_attempts SET status='completed',result_summary=$7,completed_at=now(),updated_at=now()
          WHERE id=$1 AND team_run_id=$2 AND work_item_id=$3 AND assignee_member_id=$4
            AND execution_task_id=$5 AND status='running' AND ${ownerSql('', 8)} RETURNING *`,
        [input.attemptId, input.teamRunId, input.workItemId, input.participantMemberId, input.sourceTaskId, input.sourceRunId, input.summary, ...ownerValues(input.owner)],
      );
      if (!attempt.rows?.[0]) throw new TeamExecutionError('invalid_transition');
      const submission = await client.query<SubmissionRow>(
        `INSERT INTO collaboration_submissions
          (id,team_run_id,work_item_id,attempt_id,submitted_by_member_run_id,source_task_id,source_run_id,
           summary,evidence_refs,artifact_refs,tenant_id,workspace_id,principal_type,principal_id,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::text[],$10::text[],$11,$12,$13,$14,$15)
         ON CONFLICT (attempt_id) DO UPDATE SET attempt_id=EXCLUDED.attempt_id
         RETURNING id,team_run_id,work_item_id,
           (SELECT attempt_no FROM team_work_item_attempts WHERE id=collaboration_submissions.attempt_id) AS attempt_no,
           submitted_by_member_run_id,summary,evidence_refs,artifact_refs,created_at`,
        [randomUUID(), input.teamRunId, input.workItemId, input.attemptId, input.participantMemberId, input.sourceTaskId, input.sourceRunId, input.summary, input.evidenceRefs, input.artifactRefs, ...ownerValues(input.owner), new Date().toISOString()],
      );
      if (!submission.rows?.[0]) throw new TeamExecutionError('conflict');
      return { attempt: mapAttempt(attempt.rows[0]), submission: mapSubmission(submission.rows[0]) };
    });
  }

  public async listCheckpoints(teamRunId: string, owner: OwnerScope) {
    const result = await this.database.query<CheckpointRow>(
      `SELECT id,team_run_id,work_item_id,participant_member_run_id,summary,next_step,blocker,evidence_refs,created_at
         FROM collaboration_checkpoints WHERE team_run_id=$1 AND ${ownerSql('', 2)} ORDER BY created_at,id`,
      [teamRunId, ...ownerValues(owner)],
    );
    return (result.rows ?? []).map(mapCheckpoint);
  }

  public async listSubmissions(teamRunId: string, owner: OwnerScope) {
    const result = await this.database.query<SubmissionRow>(
      `SELECT s.id,s.team_run_id,s.work_item_id,a.attempt_no,s.submitted_by_member_run_id,
              s.summary,s.evidence_refs,s.artifact_refs,s.created_at
         FROM collaboration_submissions s
         JOIN team_work_item_attempts a ON a.id=s.attempt_id
        WHERE s.team_run_id=$1 AND ${ownerSql('s', 2)} ORDER BY s.created_at,s.id`,
      [teamRunId, ...ownerValues(owner)],
    );
    return (result.rows ?? []).map(mapSubmission);
  }

  private async assignOrClaim(input: {
    readonly teamRunId: string;
    readonly workItemId: string;
    readonly assigneeMemberId: string;
    readonly actorMemberId: string;
    readonly sourceTaskId: string;
    readonly sourceRunId: string;
    readonly commandHash: string;
    readonly expectedRevision: number;
    readonly owner: OwnerScope;
    readonly claimant: boolean;
  }) {
    return this.transaction(async (client) => {
      await this.rejectDuplicateCommand(client, input.sourceRunId, input.commandHash);
      const team = await this.lockTeam(client, input.teamRunId, input.expectedRevision, input.owner);
      await assertLiveSource(client, {
        taskId: input.sourceTaskId,
        runId: input.sourceRunId,
        rootTaskId: team.root_task_id,
        memberId: input.actorMemberId,
        owner: input.owner,
      });
      await assertAvailableMember(client, input.teamRunId, input.assigneeMemberId, input.owner);
      await assertMemberHasNoPendingWork(client, input.teamRunId, input.assigneeMemberId, team.root_task_id, input.owner, input.sourceTaskId);
      const work = await client.query<WorkRow>(
        `SELECT * FROM team_work_items WHERE id=$1 AND team_run_id=$2 AND status='open' AND owner_member_id IS NULL
          AND ${ownerSql('', 3)} FOR UPDATE`,
        [input.workItemId, input.teamRunId, ...ownerValues(input.owner)],
      );
      if (!work.rows?.[0]) throw new TeamExecutionError('invalid_transition');
      if (input.claimant) {
        const blockedDependency = await client.query(
          `SELECT 1 FROM team_work_item_dependencies d
            JOIN team_work_items dep ON dep.id=d.depends_on_work_item_id AND dep.team_run_id=d.team_run_id
           WHERE d.team_run_id=$1 AND d.work_item_id=$2 AND ${ownerSql('d', 3)} AND dep.status<>'accepted' LIMIT 1`,
          [input.teamRunId, input.workItemId, ...ownerValues(input.owner)],
        );
        if (blockedDependency.rows?.[0]) throw new TeamExecutionError('invalid_transition');
      }
      const now = new Date().toISOString();
      const attemptId = randomUUID();
      const attempt = await client.query<AttemptRow>(
        `INSERT INTO team_work_item_attempts
          (id,work_item_id,team_run_id,attempt_no,assignee_member_id,requested_by_lead_task_id,status,
           tenant_id,workspace_id,principal_type,principal_id,created_at,updated_at)
         VALUES ($1,$2,$3,1,$4,$5,'queued',$6,$7,$8,$9,$10,$10) RETURNING *`,
        [attemptId, input.workItemId, input.teamRunId, input.assigneeMemberId, input.sourceTaskId, ...ownerValues(input.owner), now],
      );
      const updated = await client.query<WorkRow>(
        `UPDATE team_work_items SET status='pending',owner_member_id=$3,updated_at=$4
          WHERE id=$1 AND team_run_id=$2 AND status='open' AND owner_member_id IS NULL AND ${ownerSql('', 5)} RETURNING *`,
        [input.workItemId, input.teamRunId, input.assigneeMemberId, now, ...ownerValues(input.owner)],
      );
      if (!attempt.rows?.[0] || !updated.rows?.[0]) throw new TeamExecutionError('stale_state');
      await insertWakeMessage(client, {
        teamRunId: input.teamRunId,
        senderMemberId: input.claimant ? null : input.actorMemberId,
        recipientMemberId: input.assigneeMemberId,
        workItemId: input.workItemId,
        attemptId,
        sourceTaskId: input.sourceTaskId,
        sourceRunId: input.sourceRunId,
        body: input.claimant ? 'claimed_work' : 'assigned_work',
        dedupKey: `collaboration:${input.assigneeMemberId}:${input.claimant ? 'claim' : 'assignment'}:${attemptId}`,
        owner: input.owner,
        now,
      });
      await client.query("UPDATE team_runs SET revision=revision+1, control_state='member_work_running', updated_at=$2 WHERE id=$1", [input.teamRunId, now]);
      await this.recordCommand(client, input.sourceRunId, input.commandHash, input.claimant ? 'collaboration_board_claim' : 'collaboration_board_assign', { work_item_id: input.workItemId, attempt_id: attemptId }, now);
      return { item: mapWork(updated.rows[0]), attempt: mapAttempt(attempt.rows[0]) };
    });
  }

  private async lockTeam(client: Queryable, teamRunId: string, expectedRevision: number, owner: OwnerScope) {
    const team = await client.query<{ root_task_id: string }>(
      `SELECT root_task_id FROM team_runs WHERE id=$1 AND revision=$2 AND status='active' AND ${ownerSql('', 3)} FOR UPDATE`,
      [teamRunId, expectedRevision, ...ownerValues(owner)],
    );
    if (!team.rows?.[0]) throw new TeamExecutionError('stale_state');
    return team.rows[0];
  }

  private async rejectDuplicateCommand(client: Queryable, sourceRunId: string, commandHash: string) {
    const existing = await client.query(
      'SELECT 1 FROM team_command_receipts WHERE source_run_id=$1 AND command_hash=$2',
      [sourceRunId, commandHash],
    );
    if (existing.rows?.[0]) throw new TeamExecutionError('conflict');
  }

  private async recordCommand(client: Queryable, sourceRunId: string, commandHash: string, commandName: string, result: unknown, now: string) {
    await client.query(
      `INSERT INTO team_command_receipts(source_run_id,command_hash,command_name,result_json,created_at) VALUES ($1,$2,$3,$4::jsonb,$5)`,
      [sourceRunId, commandHash, commandName, JSON.stringify(result), now],
    );
  }

  private async assertDependencies(client: Queryable, teamRunId: string, dependencyIds: readonly string[], owner: OwnerScope) {
    const unique = [...new Set(dependencyIds)];
    if (unique.length !== dependencyIds.length)
      throw new TeamExecutionError('invalid_transition');
    if (!unique.length) return;
    const existing = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM team_work_items WHERE team_run_id=$1 AND id=ANY($2::uuid[]) AND ${ownerSql('', 3)}`,
      [teamRunId, unique, ...ownerValues(owner)],
    );
    if (Number(existing.rows?.[0]?.count ?? 0) !== unique.length)
      throw new TeamExecutionError('not_found');
  }

  private async transaction<T>(work: (client: Queryable) => Promise<T>): Promise<T> {
    const client = this.database.connect ? await this.database.connect() : this.database;
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      if ('release' in client && typeof client.release === 'function') client.release();
    }
  }
}

async function assertLiveSource(client: Queryable, input: {
  taskId: string;
  runId: string;
  rootTaskId: string;
  memberId: string;
  owner: OwnerScope;
}) {
  const source = await client.query(
    `SELECT 1 FROM tasks t JOIN runs r ON r.id=$2
      WHERE t.id=$1 AND t.root_task_id=$3 AND t.team_member_run_id=$4
        AND t.team_task_kind IN ('lead_turn','work_attempt','direct_message')
        AND t.status NOT IN ('completed','failed','cancelled')
        AND r.task_id=t.id AND r.status NOT IN ('succeeded','failed','timed_out','cancelled')
        AND ${ownerSql('t', 5)} FOR SHARE`,
    [input.taskId, input.runId, input.rootTaskId, input.memberId, ...ownerValues(input.owner)],
  );
  if (!source.rows?.[0]) throw new TeamExecutionError('stale_state');
}

async function assertAvailableMember(client: Queryable, teamRunId: string, memberId: string, owner: OwnerScope) {
  const result = await client.query<{ status: string }>(
    `SELECT status FROM team_member_runs WHERE id=$1 AND team_run_id=$2 AND role='member' AND ${ownerSql('', 3)} FOR SHARE`,
    [memberId, teamRunId, ...ownerValues(owner)],
  );
  if (!result.rows?.[0]) throw new TeamExecutionError('not_found');
  if (['stopped', 'failed'].includes(result.rows[0].status))
    throw new TeamExecutionError('not_allowed');
}

async function assertMemberHasNoPendingWork(client: Queryable, teamRunId: string, memberId: string, rootTaskId: string, owner: OwnerScope, currentTaskId: string) {
  const attempt = await client.query(
    `SELECT 1 FROM team_work_item_attempts WHERE team_run_id=$1 AND assignee_member_id=$2
      AND status IN ('queued','running') AND ${ownerSql('', 3)} LIMIT 1`,
    [teamRunId, memberId, ...ownerValues(owner)],
  );
  const task = await client.query(
    `SELECT 1 FROM tasks WHERE root_task_id=$1 AND team_member_run_id=$2 AND id<>$3
      AND status NOT IN ('completed','failed','cancelled') AND ${ownerSql('', 4)} LIMIT 1`,
    [rootTaskId, memberId, currentTaskId, ...ownerValues(owner)],
  );
  if (attempt.rows?.[0] || task.rows?.[0]) throw new TeamExecutionError('conflict');
}

async function insertDependencies(client: Queryable, teamRunId: string, workItemId: string, dependencies: readonly string[], owner: OwnerScope) {
  if (!dependencies.length) return;
  await client.query(
    `INSERT INTO team_work_item_dependencies
      (team_run_id,work_item_id,depends_on_work_item_id,tenant_id,workspace_id,principal_type,principal_id)
     SELECT $1,$2,dependency_id,$3,$4,$5,$6 FROM unnest($7::uuid[]) AS dependency_id`,
    [teamRunId, workItemId, ...ownerValues(owner), dependencies],
  );
}

async function insertWakeMessage(client: Queryable, input: {
  teamRunId: string;
  senderMemberId: string | null;
  recipientMemberId: string;
  workItemId: string;
  attemptId: string;
  sourceTaskId: string;
  sourceRunId: string;
  body: string;
  dedupKey: string;
  owner: OwnerScope;
  now: string;
}) {
  await client.query(
    `INSERT INTO team_messages
      (id,team_run_id,tenant_id,workspace_id,principal_type,principal_id,sequence,
       sender_member_run_id,recipient_member_run_id,work_item_id,attempt_id,about_work_item_id,
       kind,dedup_key,body,status,source_task_id,source_run_id,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,
       (SELECT COALESCE(MAX(sequence),0)+1 FROM team_messages WHERE team_run_id=$2),
       $7,$8,$9,$10,$9,'wake',$11,$12,'queued',$13,$14,$15)
     ON CONFLICT (team_run_id,dedup_key) DO NOTHING`,
    [randomUUID(), input.teamRunId, ...ownerValues(input.owner), input.senderMemberId, input.recipientMemberId, input.workItemId, input.attemptId, input.dedupKey, input.body, input.sourceTaskId, input.sourceRunId, input.now],
  );
}

function ownerValues(owner: OwnerScope): readonly string[] {
  return [owner.tenantId, owner.workspaceId, owner.principalType, owner.principalId];
}
function ownerSql(alias: string, start: number): string {
  const prefix = alias ? `${alias}.` : '';
  return `${prefix}tenant_id=$${start} AND ${prefix}workspace_id=$${start + 1} AND ${prefix}principal_type=$${start + 2} AND ${prefix}principal_id=$${start + 3}`;
}
function iso(value: string | Date | null): string | null {
  return value === null ? null : value instanceof Date ? value.toISOString() : value;
}
function mapWork(row: WorkRow): TeamWorkItem {
  return Object.freeze({
    id: row.id,
    teamRunId: row.team_run_id,
    subject: row.subject,
    description: row.description,
    status: row.status,
    ownerMemberId: row.owner_member_id,
    createdByMemberId: row.created_by_member_id,
    completionSummary: row.completion_summary,
    executionTaskId: row.execution_task_id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    principalType: row.principal_type,
    principalId: row.principal_id,
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
    completedAt: iso(row.completed_at),
  });
}
function mapAttempt(row: AttemptRow): TeamWorkItemAttempt {
  return Object.freeze({
    id: row.id,
    workItemId: row.work_item_id,
    teamRunId: row.team_run_id,
    attemptNo: Number(row.attempt_no),
    assigneeMemberId: row.assignee_member_id,
    requestedByLeadTaskId: row.requested_by_lead_task_id,
    feedback: row.feedback,
    executionTaskId: row.execution_task_id,
    status: row.status,
    resultSummary: row.result_summary,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    principalType: row.principal_type,
    principalId: row.principal_id,
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
    completedAt: iso(row.completed_at),
  });
}
function mapCheckpoint(row: CheckpointRow): CollaborationCheckpoint {
  return Object.freeze({
    id: row.id,
    collaborationRunId: row.team_run_id,
    workItemId: row.work_item_id,
    participantId: row.participant_member_run_id,
    summary: row.summary,
    nextStep: row.next_step,
    blocker: row.blocker,
    evidenceRefs: Object.freeze([...(row.evidence_refs ?? [])]),
    createdAt: iso(row.created_at)!,
  });
}
function mapSubmission(row: SubmissionRow): CollaborationSubmission {
  return Object.freeze({
    id: row.id,
    collaborationRunId: row.team_run_id,
    workItemId: row.work_item_id,
    attemptNo: Number(row.attempt_no),
    submittedByParticipantId: row.submitted_by_member_run_id,
    summary: row.summary,
    evidenceRefs: Object.freeze([...(row.evidence_refs ?? [])]),
    artifactRefs: Object.freeze([...(row.artifact_refs ?? [])]),
    createdAt: iso(row.created_at)!,
  });
}
