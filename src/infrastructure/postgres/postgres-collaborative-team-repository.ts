import { randomUUID } from 'node:crypto';
import type {
  FailTeamRunInput,
  TeamExecutionRepository,
  OwnerScope,
  TeamWorkDependency,
} from '../../application/ports/team-execution-repository.js';
import { TeamExecutionError } from '../../application/ports/team-execution-repository.js';
import {
  normalizeTeamRunFinalText,
  type TeamRun,
} from '../../domain/teams/team-run.js';
import {
  normalizeDecisionFeedback,
  rehydrateTeamCompletionDecision,
  type TeamCompletionDecision,
} from '../../domain/teams/team-completion-decision.js';
import type { TeamMemberRun } from '../../domain/teams/team-member-run.js';
import {
  cancelWorkItem,
  type TeamWorkItem,
} from '../../domain/teams/team-work-item.js';
import type { TeamWorkItemAttempt } from '../../domain/teams/team-work-item-attempt.js';
import { COLLABORATION_LIMITS } from '../../domain/collaboration/collaboration-policy-definition.js';

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

type TeamRunRow = Omit<TeamRun, never> & {
  tenant_id: string;
  workspace_id: string;
  principal_type: string;
  principal_id: string;
  root_task_id: string;
  root_run_id: string;
  team_version_id: string;
  environment_version_id: string;
  control_state: TeamRun['controlState'];
  revision: number;
  lead_turn_count: number;
  stop_reason: string | null;
  completion_requested_by_run_id: string | null;
  completion_approval_required: boolean;
  final_text: string | null;
  created_at: string | Date;
  updated_at: string | Date;
};
type MemberRow = Omit<TeamMemberRun, never> & {
  team_run_id: string;
  agent_version_id: string;
  runtime_session_id: string | null;
  current_work_item_id: string | null;
  tenant_id: string;
  workspace_id: string;
  principal_type: string;
  principal_id: string;
  created_at: string | Date;
  updated_at: string | Date;
};
type WorkRow = Omit<TeamWorkItem, never> & {
  team_run_id: string;
  description: string | null;
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
};
type AttemptRow = TeamWorkItemAttempt & {
  work_item_id: string;
  team_run_id: string;
  attempt_no: number;
  assignee_member_id: string;
  requested_by_lead_task_id: string;
  execution_task_id: string | null;
  result_summary: string | null;
  created_at: string | Date;
  updated_at: string | Date;
  completed_at: string | Date | null;
  tenant_id: string;
  workspace_id: string;
  principal_type: string;
  principal_id: string;
};
type CompletionDecisionRow = {
  id: string;
  team_run_id: string;
  completion_requested_by_run_id: string;
  decision: 'approve' | 'reject';
  feedback: string | null;
  decided_by: string;
  decided_at: string | Date;
  team_revision_at_decision: number;
  lead_turn_count_at_decision: number;
  tenant_id: string;
  workspace_id: string;
  principal_type: string;
  principal_id: string;
};
type CompletionDecisionTargetRow = {
  decision_id: string;
  team_run_id: string;
  work_item_id: string;
  attempt_no_at_decision: number;
  ordinal: number;
  tenant_id: string;
  workspace_id: string;
  principal_type: string;
  principal_id: string;
};
type CompletionRejectionInput = Readonly<{
  teamRunId: string;
  completionRequestedByRunId: string;
  feedback: string;
  workItemIds: readonly string[];
  decidedBy: string;
  decidedAt: string;
  expectedRevision: number;
  owner: OwnerScope;
}>;
type CompletionRejectionResult = {
  decision: TeamCompletionDecision;
  team: TeamRun;
  recorded: boolean;
};

export class PostgresTeamExecutionRepository implements TeamExecutionRepository {
  public constructor(
    private readonly database: Queryable &
      Partial<Pick<Connectable, 'connect'>>,
  ) {}
  public async createTeamRun(run: TeamRun): Promise<void> {
    await this.database.query(
      `INSERT INTO team_runs (id,tenant_id,workspace_id,principal_type,principal_id,root_task_id,root_run_id,team_version_id,environment_version_id,status,phase,final_text,control_state,revision,lead_turn_count,completion_approval_required,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
        run.id,
        run.tenantId,
        run.workspaceId,
        run.principalType,
        run.principalId,
        run.rootTaskId,
        run.rootRunId,
        run.teamVersionId,
        run.environmentVersionId,
        run.status,
        run.phase,
        run.finalText,
        run.controlState,
        run.revision,
        run.leadTurnCount,
        run.completionApprovalRequired,
        run.createdAt,
        run.updatedAt,
      ],
    );
  }
  public async findTeamRunById(
    id: string,
    owner: OwnerScope,
  ): Promise<TeamRun | null> {
    return this.findRun('id = $1', [id, ...ownerValues(owner)]);
  }
  public async findTeamRunByRootTaskId(
    id: string,
    owner: OwnerScope,
  ): Promise<TeamRun | null> {
    return this.findRun('root_task_id = $1', [id, ...ownerValues(owner)]);
  }
  public async findLatestAgenticTeamRun(
    owner: OwnerScope,
    rootTaskId?: string,
  ): Promise<TeamRun | null> {
    const predicate = rootTaskId ? 'root_task_id = $1' : 'TRUE';
    const values = rootTaskId
      ? [rootTaskId, ...ownerValues(owner)]
      : ownerValues(owner);
    const ownerStart = rootTaskId ? 2 : 1;
    const r = await this.database.query<TeamRunRow>(
      `SELECT * FROM team_runs WHERE ${predicate} AND ${ownerSql('', ownerStart)} ORDER BY created_at DESC, id DESC LIMIT 1`,
      values,
    );
    return r.rows?.[0] ? mapRun(r.rows[0]) : null;
  }
  public async listActiveTeamRunRoots() {
    const result = await this.database.query<{
      root_task_id: string;
      tenant_id: string;
      workspace_id: string;
      principal_type: string;
      principal_id: string;
    }>(
      `SELECT root_task_id,tenant_id,workspace_id,principal_type,principal_id
         FROM team_runs WHERE status='active' ORDER BY created_at,id`,
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

  public async completeTeamRunAtomically(input: {
    readonly teamRunId: string;
    readonly rootRunId: string;
    readonly rootTaskId: string;
    readonly finalText: string;
    readonly owner: OwnerScope;
    readonly updatedAt: string;
    readonly leadRunId?: string;
    readonly approvalDecision?: {
      readonly expectedRevision: number;
      readonly decidedBy: string;
      readonly decidedAt: string;
    };
  }): Promise<TeamRun> {
    const normalizedFinalText = normalizeTeamRunFinalText(input.finalText);
    const client = this.database.connect
      ? await this.database.connect()
      : this.database;
    try {
      await client.query('BEGIN');
      const locked = await client.query<TeamRunRow>(
        `SELECT * FROM team_runs WHERE id=$1 AND ${ownerSql('', 2)} FOR UPDATE`,
        [input.teamRunId, ...ownerValues(input.owner)],
      );
      const team = locked.rows?.[0];
      if (!team) throw new Error('Team run was not found.');
      await assertTeamRootFence(
        client,
        team,
        input.rootRunId,
        input.rootTaskId,
        input.owner,
      );
      if (team.status === 'succeeded' && team.phase === 'done') {
        normalizeTeamRunFinalText(team.final_text ?? '');
        if (team.completion_approval_required) {
          const approval = input.approvalDecision;
          if (!approval || !team.completion_requested_by_run_id)
            throw new TeamExecutionError('conflict');
          const existing = await client.query<CompletionDecisionRow>(
            `SELECT * FROM team_completion_decisions
             WHERE team_run_id=$1 AND completion_requested_by_run_id=$2
               AND ${ownerSql('', 3)} LIMIT 1`,
            [
              input.teamRunId,
              team.completion_requested_by_run_id,
              ...ownerValues(input.owner),
            ],
          );
          if (!existing.rows?.[0]) throw new TeamExecutionError('conflict');
          const decision = await this.loadCompletionDecision(
            existing.rows[0],
            client,
          );
          if (
            decision.decision !== 'approve' ||
            decision.decidedBy !== approval.decidedBy
          )
            throw new TeamExecutionError('conflict');
          if (approval.expectedRevision !== decision.teamRevisionAtDecision)
            throw new TeamExecutionError('stale_state');
        }
        await client.query('COMMIT');
        return mapRun(team);
      }
      if (team.status !== 'active' && team.status !== 'waiting') {
        await client.query('COMMIT');
        return mapRun(team);
      }
      if (!input.leadRunId || !team.completion_requested_by_run_id)
        throw new TeamExecutionError('invalid_transition');
      const lead = await client.query(
        `SELECT 1 FROM runs WHERE id=$1 AND status='succeeded'`,
        [input.leadRunId],
      );
      if (!lead.rows?.[0]) throw new TeamExecutionError('invalid_transition');
      const unsettled = await client.query(
        `SELECT 1 FROM team_work_item_attempts WHERE team_run_id=$1 AND (status NOT IN ('completed','failed') OR (status='completed' AND result_summary IS NULL)) LIMIT 1`,
        [input.teamRunId],
      );
      if (unsettled.rows?.[0])
        throw new TeamExecutionError('invalid_transition');
      const unaccepted = await client.query(
        `SELECT 1 FROM team_work_items WHERE team_run_id=$1 AND status NOT IN ('accepted','cancelled') LIMIT 1`,
        [input.teamRunId],
      );
      if (unaccepted.rows?.[0])
        throw new TeamExecutionError('invalid_transition');
      const gatedApproval = team.completion_approval_required;
      if (gatedApproval) {
        const approval = input.approvalDecision;
        if (
          !approval ||
          approval.expectedRevision !== team.revision ||
          !team.completion_requested_by_run_id
        )
          throw new TeamExecutionError('stale_state');
        const existing = await client.query<CompletionDecisionRow>(
          `SELECT * FROM team_completion_decisions
           WHERE team_run_id=$1 AND completion_requested_by_run_id=$2
             AND ${ownerSql('', 3)} LIMIT 1`,
          [
            input.teamRunId,
            team.completion_requested_by_run_id,
            ...ownerValues(input.owner),
          ],
        );
        if (existing.rows?.[0]) {
          const decision = await this.loadCompletionDecision(
            existing.rows[0],
            client,
          );
          if (
            decision.decision !== 'approve' ||
            decision.feedback !== null ||
            decision.targets.length > 0 ||
            decision.decidedBy !== approval.decidedBy
          )
            throw new TeamExecutionError('conflict');
        } else {
          await client.query(
            `INSERT INTO team_completion_decisions
              (id,team_run_id,completion_requested_by_run_id,decision,feedback,
               decided_by,decided_at,team_revision_at_decision,
               lead_turn_count_at_decision,tenant_id,workspace_id,principal_type,
               principal_id)
             VALUES ($1,$2,$3,'approve',NULL,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [
              randomUUID(),
              input.teamRunId,
              team.completion_requested_by_run_id,
              approval.decidedBy,
              approval.decidedAt,
              team.revision,
              team.lead_turn_count,
              ...ownerValues(input.owner),
            ],
          );
        }
      }
      const updated = await client.query<TeamRunRow>(
        `UPDATE team_runs SET status='succeeded', phase='done', control_state='terminal', final_text=$2, stop_reason=CASE WHEN EXISTS (SELECT 1 FROM team_work_items WHERE team_run_id=$1 AND status='cancelled') THEN 'work_abandoned' ELSE NULL END, revision=revision+1, updated_at=$3 WHERE id=$1 RETURNING *`,
        [input.teamRunId, normalizedFinalText, input.updatedAt],
      );
      const run = await client.query(
        `UPDATE runs SET status='succeeded', result=$3::jsonb, error=NULL, updated_at=$4 WHERE id=$1 AND task_id=$2 AND status='waiting_children' RETURNING id`,
        [
          input.rootRunId,
          input.rootTaskId,
          JSON.stringify({ text: normalizedFinalText }),
          input.updatedAt,
        ],
      );
      if (!run.rows?.[0]) throw new Error('Root run was not waiting.');
      const task = await client.query(
        `UPDATE tasks SET status='completed', updated_at=$2 WHERE id=$1
           AND root_task_id=id AND parent_task_id IS NULL AND parent_run_id IS NULL
           AND invokable_kind='team' AND status NOT IN ('completed','failed','cancelled')
           AND ${ownerSql('', 3)} RETURNING id`,
        [input.rootTaskId, input.updatedAt, ...ownerValues(input.owner)],
      );
      if (!task.rows?.[0]) {
        const existing = await client.query<{ status: string }>(
          `SELECT status FROM tasks WHERE id=$1 AND root_task_id=$1
             AND parent_task_id IS NULL AND parent_run_id IS NULL
             AND invokable_kind='team' AND ${ownerSql('', 2)}`,
          [input.rootTaskId, ...ownerValues(input.owner)],
        );
        if (!existing.rows?.[0] || existing.rows[0].status !== 'completed')
          throw new TeamExecutionError('stale_state');
      }
      for (const [type, payload] of [
        ['output', { text: normalizedFinalText }],
        ['succeeded', {}],
      ] as const) {
        await client.query(
          `INSERT INTO run_events(id,run_id,sequence,type,payload,created_at) SELECT $1,$2,COALESCE(MAX(sequence),0)+1,$3,$4::jsonb,$5 FROM run_events WHERE run_id=$2`,
          [
            randomUUID(),
            input.rootRunId,
            type,
            JSON.stringify(payload),
            input.updatedAt,
          ],
        );
      }
      await client.query('COMMIT');
      return mapRun(updated.rows![0]!);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      'release' in client &&
        typeof client.release === 'function' &&
        client.release();
    }
  }
  public async failTeamRunAtomically(
    input: FailTeamRunInput,
  ): Promise<TeamRun> {
    const client = this.database.connect
      ? await this.database.connect()
      : this.database;
    try {
      await client.query('BEGIN');
      const locked = await client.query<TeamRunRow>(
        `SELECT * FROM team_runs WHERE id=$1 AND ${ownerSql('', 2)} FOR UPDATE`,
        [input.teamRunId, ...ownerValues(input.owner)],
      );
      const team = locked.rows?.[0];
      if (!team) throw new Error('Team run was not found.');
      if (
        input.stopReason === 'lead_no_progress' &&
        (team.revision !== input.expectedRevision ||
          team.control_state !== 'lead_running' ||
          team.completion_requested_by_run_id !== null)
      )
        throw new TeamExecutionError('stale_state');
      await assertTeamRootFence(
        client,
        team,
        input.rootRunId,
        input.rootTaskId,
        input.owner,
      );
      if (team.status === 'succeeded') {
        await client.query('COMMIT');
        return mapRun(team);
      }
      if (team.status === 'failed') {
        await client.query('COMMIT');
        return mapRun(team);
      }
      if (input.stopReason === 'succeeded_without_submit') {
        const attempt = await client.query<AttemptRow>(
          `SELECT a.*
             FROM team_work_item_attempts a
             JOIN team_work_items w
               ON w.id=a.work_item_id AND w.team_run_id=a.team_run_id
            WHERE a.id=$1 AND a.team_run_id=$2
              AND ${ownerSql('a', 3)} AND ${ownerSql('w', 3)}
            FOR UPDATE OF a,w`,
          [input.attemptId, input.teamRunId, ...ownerValues(input.owner)],
        );
        if (!attempt.rows?.[0]) throw new TeamExecutionError('not_found');
        // A canonical submit may win the race with the provider terminal
        // callback. Preserve that completed attempt and leave the Team active.
        if (attempt.rows[0].status === 'completed') {
          await client.query('COMMIT');
          return mapRun(team);
        }
        if (attempt.rows[0].status !== 'running')
          throw new TeamExecutionError('invalid_transition');
        if (attempt.rows[0].execution_task_id !== input.childTaskId)
          throw new TeamExecutionError('invalid_transition');
        const linkage = await client.query<{
          task_id: string;
          task_root_task_id: string;
          task_team_task_kind: string | null;
          task_team_member_run_id: string | null;
          run_id: string;
          run_status: string;
        }>(
          `SELECT task.id AS task_id, task.root_task_id AS task_root_task_id,
                  task.team_task_kind AS task_team_task_kind,
                  task.team_member_run_id AS task_team_member_run_id,
                  child_run.id AS run_id, child_run.status AS run_status
             FROM tasks task
             JOIN runs child_run ON child_run.task_id=task.id
             JOIN team_member_runs member
               ON member.id=task.team_member_run_id
              AND member.team_run_id=$5
              AND member.role='member'
              AND ${ownerSql('member', 6)}
            WHERE task.id=$1 AND child_run.id=$2
              AND task.root_task_id=$3
              AND task.parent_run_id=$4
              AND task.team_task_kind='work_attempt'
              AND ${ownerSql('task', 10)}
              AND NOT EXISTS (
                SELECT 1 FROM runs newer
                 WHERE newer.task_id=task.id
                   AND newer.attempt > child_run.attempt
              )
            FOR UPDATE OF task,child_run,member`,
          [
            input.childTaskId,
            input.childRunId,
            team.root_task_id,
            team.root_run_id,
            input.teamRunId,
            ...ownerValues(input.owner),
            ...ownerValues(input.owner),
          ],
        );
        const child = linkage.rows?.[0];
        if (
          !child ||
          child.run_status !== 'succeeded' ||
          child.task_root_task_id !== team.root_task_id ||
          child.task_team_task_kind !== 'work_attempt' ||
          child.task_team_member_run_id !== attempt.rows[0].assignee_member_id
        )
          throw new TeamExecutionError('invalid_transition');
        const failedAttempt = await client.query(
          `UPDATE team_work_item_attempts
              SET status='failed', result_summary=NULL,
                  completed_at=$2, updated_at=$2
            WHERE id=$1 AND status='running'
            RETURNING id`,
          [input.attemptId, input.updatedAt],
        );
        if (!failedAttempt.rows?.[0]) {
          await client.query('COMMIT');
          return mapRun(team);
        }
      }
      await client.query(
        `UPDATE team_runs SET status='failed', phase='done', control_state='terminal', stop_reason=$2, updated_at=$3 WHERE id=$1`,
        [input.teamRunId, input.stopReason, input.updatedAt],
      );
      const error = JSON.stringify(input.failure);
      const run = await client.query(
        `UPDATE runs SET status='failed', error=$3::jsonb, result=NULL, updated_at=$4 WHERE id=$1 AND task_id=$2 AND status='waiting_children' RETURNING id`,
        [input.rootRunId, input.rootTaskId, error, input.updatedAt],
      );
      if (!run.rows?.[0]) {
        const existing = await client.query<{ status: string }>(
          'SELECT status FROM runs WHERE id=$1',
          [input.rootRunId],
        );
        if (!existing.rows?.[0] || existing.rows[0].status !== 'failed')
          throw new Error('Root run was not waiting or already failed.');
      }
      const task = await client.query(
        `UPDATE tasks SET status='failed', updated_at=$2 WHERE id=$1 AND status NOT IN ('completed','failed','cancelled') RETURNING id`,
        [input.rootTaskId, input.updatedAt],
      );
      if (!task.rows?.[0]) {
        const existing = await client.query<{ status: string }>(
          'SELECT status FROM tasks WHERE id=$1',
          [input.rootTaskId],
        );
        if (!existing.rows?.[0] || existing.rows[0].status !== 'failed')
          throw new Error('Team root task was not active or already failed.');
      }
      await client.query(
        `INSERT INTO run_events(id,run_id,sequence,type,payload,created_at) SELECT $1,$2,COALESCE(MAX(sequence),0)+1,'failed',$3::jsonb,$4 FROM run_events WHERE run_id=$2`,
        [randomUUID(), input.rootRunId, error, input.updatedAt],
      );
      const updatedTeam = await client.query<TeamRunRow>(
        `SELECT * FROM team_runs WHERE id=$1 AND ${ownerSql('', 2)}`,
        [input.teamRunId, ...ownerValues(input.owner)],
      );
      if (!updatedTeam.rows?.[0]) throw new Error('Team run was not found.');
      await client.query('COMMIT');
      return mapRun(updatedTeam.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      if ('release' in client && typeof client.release === 'function')
        client.release();
    }
  }
  public async recoverExpiredTeamRuns(now: string): Promise<
    readonly {
      readonly teamRunId: string;
      readonly childRunId: string;
      readonly teamTaskKind: 'lead_turn' | 'work_attempt';
      readonly affectedChildRunCount: number;
    }[]
  > {
    const candidates = await this.database.query<{
      team_run_id: string;
      child_run_id: string;
      team_task_kind: 'lead_turn' | 'work_attempt';
      tenant_id: string;
      workspace_id: string;
      principal_type: string;
      principal_id: string;
    }>(
      `SELECT team.id AS team_run_id, r.id AS child_run_id, t.team_task_kind,
              team.tenant_id,team.workspace_id,team.principal_type,team.principal_id
         FROM runs r
         JOIN tasks t ON t.id=r.task_id
         JOIN team_runs team ON team.root_task_id=t.root_task_id
        WHERE team.status='active'
          AND t.team_task_kind IN ('lead_turn','work_attempt')
          AND r.status='running'
          AND r.lease_expires_at <= $1::timestamptz
        ORDER BY r.lease_expires_at ASC, r.id ASC
        LIMIT 32`,
      [now],
    );
    const recovered: {
      teamRunId: string;
      childRunId: string;
      teamTaskKind: 'lead_turn' | 'work_attempt';
      affectedChildRunCount: number;
    }[] = [];
    for (const candidate of candidates.rows ?? []) {
      const owner: OwnerScope = {
        tenantId: candidate.tenant_id,
        workspaceId: candidate.workspace_id,
        principalType: candidate.principal_type,
        principalId: candidate.principal_id,
      };
      const client = this.database.connect
        ? await this.database.connect()
        : this.database;
      try {
        await client.query('BEGIN');
        const locked = await client.query<{
          id: string;
          status: TeamRun['status'];
          root_run_id: string;
          root_task_id: string;
        }>(
          `SELECT id,status,root_run_id,root_task_id
             FROM team_runs WHERE id=$1 AND ${ownerSql('', 2)} FOR UPDATE`,
          [candidate.team_run_id, ...ownerValues(owner)],
        );
        const team = locked.rows?.[0];
        if (!team || team.status !== 'active') {
          await client.query('COMMIT');
          continue;
        }
        const child = await client.query(
          `UPDATE runs
              SET status='timed_out', lease_owner=NULL, activation_id=NULL,
                  lease_expires_at=NULL,
                  error='{"code":"runtime_timed_out","message":"The runtime exceeded the configured timeout."}'::jsonb,
                  result=NULL, updated_at=$2
            WHERE id=$1 AND status='running' AND lease_expires_at <= $2::timestamptz
              AND EXISTS (
                SELECT 1 FROM tasks scoped_task
                 WHERE scoped_task.id=runs.task_id
                   AND ${ownerSql('scoped_task', 3)}
              )
            RETURNING id,task_id`,
          [candidate.child_run_id, now, ...ownerValues(owner)],
        );
        if (!child.rows?.[0]) {
          await client.query('COMMIT');
          continue;
        }
        const siblingRuns = await client.query<{ id: string; task_id: string }>(
          `UPDATE runs
              SET status='failed', lease_owner=NULL, activation_id=NULL,
                  lease_expires_at=NULL, result=NULL,
                  fencing_token=GREATEST(fencing_token,1),
                  error='{"code":"runtime_execution_failed","message":"The Team could not recover an expired turn."}'::jsonb,
                  updated_at=$2
            WHERE task_id IN (
              SELECT scoped_task.id FROM tasks scoped_task
               WHERE scoped_task.root_task_id=$3
                 AND scoped_task.team_task_kind IN ('lead_turn','work_attempt','direct_message')
                 AND ${ownerSql('scoped_task', 4)}
            )
              AND id <> $1
              AND EXISTS (
                SELECT 1 FROM team_runs scoped_team
                 WHERE scoped_team.id=$8 AND ${ownerSql('scoped_team', 9)}
              )
              AND status NOT IN ('succeeded','failed','timed_out','cancelled')
            RETURNING id,task_id`,
          [
            candidate.child_run_id,
            now,
            team.root_task_id,
            ...ownerValues(owner),
            team.id,
            ...ownerValues(owner),
          ],
        );
        await client.query(
          `UPDATE tasks SET status='failed', updated_at=$2
             WHERE root_task_id=$1
               AND team_task_kind IN ('lead_turn','work_attempt','direct_message')
               AND ${ownerSql('', 3)}
               AND EXISTS (
                 SELECT 1 FROM team_runs scoped_team
                  WHERE scoped_team.id=$7 AND ${ownerSql('scoped_team', 8)}
               )
               AND status NOT IN ('completed','failed','cancelled')`,
          [
            team.root_task_id,
            now,
            ...ownerValues(owner),
            team.id,
            ...ownerValues(owner),
          ],
        );
        await client.query(
          `UPDATE team_work_item_attempts
              SET status='failed', result_summary=NULL, completed_at=$2, updated_at=$2
            WHERE team_run_id=$1 AND ${ownerSql('', 3)} AND status IN ('queued','running')`,
          [team.id, now, ...ownerValues(owner)],
        );
        await client.query(
          `UPDATE team_work_items
              SET status='cancelled', updated_at=$2, completed_at=NULL
            WHERE team_run_id=$1 AND ${ownerSql('', 3)} AND status NOT IN ('accepted','cancelled')`,
          [team.id, now, ...ownerValues(owner)],
        );
        await client.query(
          `UPDATE team_member_runs
              SET status='failed', current_work_item_id=NULL, updated_at=$2
            WHERE team_run_id=$1 AND ${ownerSql('', 3)} AND status IN ('starting','active')`,
          [team.id, now, ...ownerValues(owner)],
        );
        for (const childRun of [
          { id: candidate.child_run_id, status: 'timed_out' },
          ...(siblingRuns.rows ?? []).map((row) => ({
            id: row.id,
            status: 'failed',
          })),
        ]) {
          await client.query(
            `INSERT INTO run_events(id,run_id,sequence,type,payload,created_at)
               SELECT $1,$2,COALESCE(MAX(sequence),0)+1,'failed',$3::jsonb,$4
                 FROM run_events
                 JOIN runs scoped_run ON scoped_run.id=run_events.run_id
                 JOIN tasks scoped_task ON scoped_task.id=scoped_run.task_id
                WHERE run_events.run_id=$2 AND ${ownerSql('scoped_task', 5)}`,
            [
              randomUUID(),
              childRun.id,
              JSON.stringify({
                code:
                  childRun.status === 'timed_out'
                    ? 'runtime_timed_out'
                    : 'runtime_execution_failed',
                message:
                  childRun.status === 'timed_out'
                    ? 'The runtime exceeded the configured timeout.'
                    : 'The Team could not recover an expired turn.',
              }),
              now,
              ...ownerValues(owner),
            ],
          );
        }
        const rootError = JSON.stringify({
          code: 'runtime_execution_failed',
          message: 'The Team could not recover an expired turn.',
        });
        await client.query(
          `UPDATE team_runs
              SET status='failed', phase='done', control_state='terminal',
                  stop_reason='turn_lease_expired', updated_at=$2
            WHERE id=$1 AND status='active' AND ${ownerSql('', 3)}`,
          [team.id, now, ...ownerValues(owner)],
        );
        const rootRun = await client.query(
          `UPDATE runs SET status='failed', lease_owner=NULL, activation_id=NULL,
                  lease_expires_at=NULL, result=NULL, error=$3::jsonb, updated_at=$4
            WHERE id=$1 AND task_id=$2 AND status='waiting_children'
              AND EXISTS (
                SELECT 1 FROM tasks scoped_task
                 WHERE scoped_task.id=$2 AND ${ownerSql('scoped_task', 5)}
              )
            RETURNING id`,
          [
            team.root_run_id,
            team.root_task_id,
            rootError,
            now,
            ...ownerValues(owner),
          ],
        );
        if (!rootRun.rows?.[0]) {
          const existingRootRun = await client.query<{ status: string }>(
            `SELECT r.status FROM runs r
               JOIN tasks scoped_task ON scoped_task.id=r.task_id
              WHERE r.id=$1 AND r.task_id=$2 AND ${ownerSql('scoped_task', 3)}`,
            [team.root_run_id, team.root_task_id, ...ownerValues(owner)],
          );
          if (existingRootRun.rows?.[0]?.status !== 'failed')
            throw new Error('Team root run was not waiting or already failed.');
        }
        const rootTask = await client.query(
          `UPDATE tasks SET status='failed', updated_at=$2
             WHERE id=$1 AND ${ownerSql('', 3)}
               AND status NOT IN ('completed','failed','cancelled')
             RETURNING id`,
          [team.root_task_id, now, ...ownerValues(owner)],
        );
        if (!rootTask.rows?.[0]) {
          const existingRootTask = await client.query<{ status: string }>(
            `SELECT status FROM tasks
              WHERE id=$1 AND ${ownerSql('', 2)}`,
            [team.root_task_id, ...ownerValues(owner)],
          );
          if (existingRootTask.rows?.[0]?.status !== 'failed')
            throw new Error('Team root task was not active or already failed.');
        }
        if (rootRun.rows?.[0]) {
          await client.query(
            `INSERT INTO run_events(id,run_id,sequence,type,payload,created_at)
               SELECT $1,$2,COALESCE(MAX(sequence),0)+1,'failed',$3::jsonb,$4
                 FROM run_events
                 JOIN runs scoped_run ON scoped_run.id=run_events.run_id
                 JOIN tasks scoped_task ON scoped_task.id=scoped_run.task_id
                WHERE run_events.run_id=$2 AND ${ownerSql('scoped_task', 5)}`,
            [
              randomUUID(),
              team.root_run_id,
              rootError,
              now,
              ...ownerValues(owner),
            ],
          );
        }
        await client.query('COMMIT');
        recovered.push({
          teamRunId: team.id,
          childRunId: candidate.child_run_id,
          teamTaskKind: candidate.team_task_kind,
          affectedChildRunCount:
            1 + (siblingRuns.rowCount ?? siblingRuns.rows?.length ?? 0),
        });
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        if ('release' in client && typeof client.release === 'function')
          client.release();
      }
    }
    return recovered;
  }
  public async createMemberRun(member: TeamMemberRun): Promise<void> {
    await this.database.query(
      `INSERT INTO team_member_runs (id,team_run_id,name,role,agent_version_id,runtime_session_id,status,current_work_item_id,tenant_id,workspace_id,principal_type,principal_id,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        member.id,
        member.teamRunId,
        member.name,
        member.role,
        member.agentVersionId,
        member.runtimeSessionId,
        member.status,
        member.currentWorkItemId,
        member.tenantId,
        member.workspaceId,
        member.principalType,
        member.principalId,
        member.createdAt,
        member.updatedAt,
      ],
    );
  }
  public async findMembersByTeamRunId(
    id: string,
    owner: OwnerScope,
  ): Promise<TeamMemberRun[]> {
    const r = await this.database.query<MemberRow>(
      `SELECT m.* FROM team_member_runs m JOIN team_runs t ON t.id=m.team_run_id WHERE m.team_run_id=$1 AND ${ownerSql('t', 2)}`,
      [id, ...ownerValues(owner)],
    );
    return (r.rows ?? []).map(mapMember);
  }
  public async findMemberRunById(
    id: string,
    owner: OwnerScope,
  ): Promise<TeamMemberRun | null> {
    const r = await this.database.query<MemberRow>(
      `SELECT m.* FROM team_member_runs m JOIN team_runs t ON t.id=m.team_run_id WHERE m.id=$1 AND ${ownerSql('t', 2)}`,
      [id, ...ownerValues(owner)],
    );
    return r.rows?.[0] ? mapMember(r.rows[0]) : null;
  }
  public async updateMemberRunStatus(
    id: string,
    status: TeamMemberRun['status'],
    runtimeSessionId?: string | null,
    owner?: OwnerScope,
    expectedCurrentStatus?: TeamMemberRun['status'],
  ): Promise<TeamMemberRun> {
    return this.updateMember(id, status, runtimeSessionId, owner, expectedCurrentStatus);
  }
  public async updateMemberRuntimeSession(
    id: string,
    runtimeSessionId: string,
    owner: OwnerScope,
  ): Promise<TeamMemberRun> {
    return this.updateMember(id, undefined, runtimeSessionId, owner);
  }
  public async findWorkItemsByTeamRunId(
    id: string,
    owner: OwnerScope,
  ): Promise<TeamWorkItem[]> {
    const r = await this.database.query<WorkRow>(
      `SELECT * FROM team_work_items WHERE team_run_id=$1 AND ${ownerSql('', 2)} ORDER BY created_at,id`,
      [id, ...ownerValues(owner)],
    );
    return (r.rows ?? []).map(mapWork);
  }
  public async findWorkItemById(
    id: string,
    owner: OwnerScope,
  ): Promise<TeamWorkItem | null> {
    const r = await this.database.query<WorkRow>(
      `SELECT * FROM team_work_items WHERE id=$1 AND ${ownerSql('', 2)}`,
      [id, ...ownerValues(owner)],
    );
    return r.rows?.[0] ? mapWork(r.rows[0]) : null;
  }
  public async findWorkDependenciesByTeamRunId(
    teamRunId: string,
    owner: OwnerScope,
  ): Promise<readonly TeamWorkDependency[]> {
    const result = await this.database.query<{
      work_item_id: string;
      depends_on_work_item_id: string;
    }>(
      `SELECT work_item_id,depends_on_work_item_id
         FROM team_work_item_dependencies
        WHERE team_run_id=$1 AND ${ownerSql('', 2)}
        ORDER BY work_item_id,depends_on_work_item_id`,
      [teamRunId, ...ownerValues(owner)],
    );
    return (result.rows ?? []).map((row) =>
      Object.freeze({
        workItemId: row.work_item_id,
        dependsOnWorkItemId: row.depends_on_work_item_id,
      }),
    );
  }
  public async findAttemptsByTeamRunId(
    teamRunId: string,
    owner: OwnerScope,
  ): Promise<TeamWorkItemAttempt[]> {
    const r = await this.database.query<AttemptRow>(
      `SELECT * FROM team_work_item_attempts WHERE team_run_id=$1 AND ${ownerSql('', 2)} ORDER BY created_at, attempt_no`,
      [teamRunId, ...ownerValues(owner)],
    );
    return (r.rows ?? []).map(mapAttempt);
  }
  public async materializeAttempt(input: {
    attemptId: string;
    executionTaskId: string;
    teamRunId: string;
    assigneeMemberId: string;
    expectedRevision: number;
    owner: OwnerScope;
  }): Promise<TeamWorkItemAttempt> {
    // The reconciler invokes this through AdmissionRepository.withTransaction.
    // Do not create a nested transaction here: the Task, Run, Attempt, Message,
    // and dispatch must either all commit or all remain queued together.
    const team = await this.database.query<TeamRunRow>(
      `SELECT * FROM team_runs WHERE id=$1 AND revision=$2
         AND status IN ('active','waiting') AND ${ownerSql('', 3)} FOR UPDATE`,
      [input.teamRunId, input.expectedRevision, ...ownerValues(input.owner)],
    );
    if (team.rowCount !== 1 || !team.rows?.[0])
      throw new TeamExecutionError('stale_state');
    const claimed = await this.database.query<AttemptRow>(
      `WITH attempt_claim AS (
           UPDATE team_work_item_attempts a
              SET execution_task_id=$2,status='running',updated_at=now()
             FROM team_work_items w, team_member_runs m
            WHERE a.id=$1 AND a.team_run_id=$3 AND a.work_item_id=w.id
              AND a.assignee_member_id=$4
              AND m.id=$4 AND m.team_run_id=$3 AND m.role='member'
              AND m.status NOT IN ('stopped','failed')
              AND a.status='queued' AND a.execution_task_id IS NULL
              AND w.team_run_id=$3 AND w.status='pending'
              AND ${ownerSql('a', 5)} AND ${ownerSql('w', 5)} AND ${ownerSql('m', 5)}
              AND NOT EXISTS (
                SELECT 1 FROM team_work_item_attempts active_attempt
                 WHERE active_attempt.team_run_id=$3
                   AND active_attempt.assignee_member_id=$4
                   AND active_attempt.id<>a.id
                   AND active_attempt.status IN ('queued','running')
                   AND ${ownerSql('active_attempt', 5)}
              )
              AND NOT EXISTS (
                SELECT 1 FROM tasks active_task
                 WHERE active_task.root_task_id=$9
                   AND active_task.team_member_run_id=$4
                   AND active_task.id<>$2
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
              AND NOT EXISTS (
                SELECT 1
                  FROM team_work_item_dependencies d
                  JOIN team_work_items dependency
                    ON dependency.id=d.depends_on_work_item_id
                   AND dependency.team_run_id=d.team_run_id
                 WHERE d.team_run_id=$3 AND d.work_item_id=a.work_item_id
                   AND ${ownerSql('d', 5)} AND ${ownerSql('dependency', 5)}
                   AND dependency.status<>'accepted'
              )
           RETURNING a.*
         ), work_claim AS (
           UPDATE team_work_items w
              SET status='in_progress',updated_at=now()
             FROM attempt_claim a
            WHERE w.id=a.work_item_id AND w.team_run_id=$3 AND w.status='pending'
              AND ${ownerSql('w', 5)}
           RETURNING w.id
         )
         SELECT a.* FROM attempt_claim a JOIN work_claim w ON w.id=a.work_item_id`,
      [
        input.attemptId,
        input.executionTaskId,
        input.teamRunId,
        input.assigneeMemberId,
        ...ownerValues(input.owner),
        team.rows[0].root_task_id,
      ],
    );
    if (claimed.rowCount !== 1 || !claimed.rows?.[0])
      throw new TeamExecutionError('invalid_transition');
    return mapAttempt(claimed.rows[0]);
  }
  public async updateAttemptStatus(
    attemptId: string,
    status: TeamWorkItemAttempt['status'],
    resultSummary: string | null,
    owner: OwnerScope,
  ): Promise<TeamWorkItemAttempt> {
    const r = await this.database.query<AttemptRow>(
      `UPDATE team_work_item_attempts
          SET status=$2,result_summary=$3,
              completed_at=CASE WHEN $2 IN ('completed','failed') THEN now() ELSE completed_at END,
              updated_at=now()
        WHERE id=$1 AND status='running' AND $2 IN ('completed','failed')
          AND ${ownerSql('', 4)} RETURNING *`,
      [attemptId, status, resultSummary, ...ownerValues(owner)],
    );
    if (!r.rows?.[0]) throw new Error('Work attempt was not found.');
    return mapAttempt(r.rows[0]);
  }
  public async submitCurrentAttempt(input: {
    teamRunId: string;
    executionTaskId: string;
    currentRunId: string;
    memberId: string;
    resultSummary: string;
    owner: OwnerScope;
  }): Promise<TeamWorkItemAttempt> {
    const client = this.database.connect
      ? await this.database.connect()
      : this.database;
    try {
      await client.query('BEGIN');
      // Keep the Team-first lock order shared with failTeamRunAtomically so a
      // terminal callback cannot deadlock a concurrent canonical submit.
      await client.query(
        `SELECT id FROM team_runs WHERE id=$1 AND ${ownerSql('', 2)} FOR UPDATE`,
        [input.teamRunId, ...ownerValues(input.owner)],
      );
      const eligible = await client.query<{ id: string }>(
        `SELECT a.id
           FROM team_work_item_attempts a
           JOIN team_work_items w ON w.id=a.work_item_id
           JOIN team_runs t ON t.id=a.team_run_id
           JOIN tasks task ON task.id=a.execution_task_id
           JOIN team_member_runs m ON m.id=task.team_member_run_id
           JOIN runs r ON r.task_id=task.id
          WHERE a.team_run_id=$1 AND a.execution_task_id=$2
            AND a.assignee_member_id=$3 AND r.id=$4 AND a.status='running'
            AND w.team_run_id=t.id AND w.status='in_progress'
            AND t.status IN ('active','waiting')
            AND m.team_run_id=t.id AND m.id=$3 AND m.role='member'
            AND m.status NOT IN ('stopped','failed')
            AND task.root_task_id=t.root_task_id
            AND task.status NOT IN ('completed','failed','cancelled')
            AND r.status NOT IN ('succeeded','failed','timed_out','cancelled')
            AND NOT EXISTS (
              SELECT 1 FROM runs newer
               WHERE newer.task_id=task.id AND newer.attempt > r.attempt
            )
            AND ${ownerSql('a', 5)} AND ${ownerSql('w', 5)}
            AND ${ownerSql('t', 5)} AND ${ownerSql('task', 5)}
            AND ${ownerSql('m', 5)}
          FOR UPDATE OF a,w,t,task,m,r`,
        [
          input.teamRunId,
          input.executionTaskId,
          input.memberId,
          input.currentRunId,
          ...ownerValues(input.owner),
        ],
      );
      if (!eligible.rows?.[0])
        throw new TeamExecutionError('invalid_transition');
      const updated = await client.query<AttemptRow>(
        `UPDATE team_work_item_attempts SET status='completed', result_summary=$2, completed_at=now(), updated_at=now() WHERE id=$1 AND status='running' RETURNING *`,
        [eligible.rows[0].id, input.resultSummary],
      );
      if (!updated.rows?.[0]) throw new TeamExecutionError('stale_state');
      await client.query('COMMIT');
      return mapAttempt(updated.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      if ('release' in client && typeof client.release === 'function')
        client.release();
    }
  }

  public async createAssignedWork(input: {
    teamRunId: string;
    sourceRunId: string;
    leadTaskId: string;
    assigneeMemberId: string;
    subject: string;
    description: string | null;
    dependsOnWorkItemIds?: readonly string[];
    commandHash: string;
    expectedRevision: number;
    owner: OwnerScope;
  }): Promise<{ item: TeamWorkItem; attempt: TeamWorkItemAttempt }> {
    const client = this.database.connect
      ? await this.database.connect()
      : this.database;
    try {
      await client.query('BEGIN');
      const existing = await client.query<{ result_json: unknown }>(
        'SELECT result_json FROM team_command_receipts WHERE source_run_id=$1 AND command_hash=$2',
        [input.sourceRunId, input.commandHash],
      );
      if (existing.rows?.[0]) {
        await client.query('COMMIT');
        throw new TeamExecutionError('conflict');
      }
      const team = await client.query<TeamRunRow>(
        `SELECT * FROM team_runs WHERE id=$1 AND revision=$2 AND status NOT IN ('succeeded','failed','cancelled') AND ${ownerSql('', 3)} FOR UPDATE`,
        [input.teamRunId, input.expectedRevision, ...ownerValues(input.owner)],
      );
      if (!team.rows?.[0]) throw new TeamExecutionError('stale_state');
      if (!input.leadTaskId) throw new TeamExecutionError('stale_state');
      await assertV2Source(
        client,
        input.sourceRunId,
        input.teamRunId,
        input.leadTaskId,
        team.rows[0].root_task_id,
        input.owner,
      );
      {
        const assignee = await client.query<{
          status: TeamMemberRun['status'];
        }>(
          `SELECT status FROM team_member_runs WHERE id=$1 AND team_run_id=$2 AND role='member' AND ${ownerSql('', 3)} FOR SHARE`,
          [
            input.assigneeMemberId,
            input.teamRunId,
            ...ownerValues(input.owner),
          ],
        );
        if (!assignee.rows?.[0]) throw new TeamExecutionError('not_found');
        if (
          assignee.rows[0].status === 'failed' ||
          assignee.rows[0].status === 'stopped'
        )
          throw new TeamExecutionError('not_allowed');
        const count = await client.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM team_work_items WHERE team_run_id=$1 AND ${ownerSql('', 2)}`,
          [input.teamRunId, ...ownerValues(input.owner)],
        );
        if (
          Number(count.rows?.[0]?.count ?? 0) >=
          COLLABORATION_LIMITS.maxWorkItems
        )
          throw new TeamExecutionError('limit_exceeded');
        const activeAttempt = await client.query(
          `SELECT 1 FROM team_work_item_attempts a
             WHERE a.team_run_id=$1 AND a.assignee_member_id=$2
               AND a.status IN ('queued','running')
               AND ${ownerSql('a', 3)} LIMIT 1`,
          [
            input.teamRunId,
            input.assigneeMemberId,
            ...ownerValues(input.owner),
          ],
        );
        const activeTask = await client.query(
          `SELECT 1 FROM tasks t
             WHERE t.root_task_id=$1 AND t.team_member_run_id=$2
               AND t.status NOT IN ('completed','failed','cancelled')
               AND ${ownerSql('t', 3)} LIMIT 1`,
          [
            team.rows[0].root_task_id,
            input.assigneeMemberId,
            ...ownerValues(input.owner),
          ],
        );
        if (activeAttempt.rows?.[0] || activeTask.rows?.[0])
          throw new TeamExecutionError('conflict');
      }
      const dependencies = [...new Set(input.dependsOnWorkItemIds ?? [])];
      if (dependencies.length !== (input.dependsOnWorkItemIds ?? []).length)
        throw new TeamExecutionError('invalid_transition');
      if (dependencies.length > 0) {
        const existingDependencies = await client.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM team_work_items
            WHERE team_run_id=$1 AND id=ANY($2::uuid[]) AND ${ownerSql('', 3)}`,
          [input.teamRunId, dependencies, ...ownerValues(input.owner)],
        );
        if (
          Number(existingDependencies.rows?.[0]?.count ?? 0) !==
          dependencies.length
        )
          throw new TeamExecutionError('not_found');
      }
      const now = new Date().toISOString();
      const itemId = randomUUID();
      const attemptId = randomUUID();
      await client.query(
        `INSERT INTO team_work_items (id,team_run_id,subject,description,status,owner_member_id,created_by_member_id,tenant_id,workspace_id,principal_type,principal_id,created_at,updated_at) VALUES ($1,$2,$3,$4,'pending',$5,(SELECT id FROM team_member_runs WHERE team_run_id=$2 AND role='lead' LIMIT 1),$6,$7,$8,$9,$10,$10)`,
        [
          itemId,
          input.teamRunId,
          input.subject,
          input.description,
          input.assigneeMemberId,
          ...ownerValues(input.owner),
          now,
        ],
      );
      if (dependencies.length > 0)
        await client.query(
          `INSERT INTO team_work_item_dependencies
            (team_run_id,work_item_id,depends_on_work_item_id,tenant_id,workspace_id,principal_type,principal_id)
           SELECT $1,$2,dependency_id,$3,$4,$5,$6
             FROM unnest($7::uuid[]) AS dependency_id`,
          [input.teamRunId, itemId, ...ownerValues(input.owner), dependencies],
        );
      await client.query(
        `INSERT INTO team_work_item_attempts (id,work_item_id,team_run_id,attempt_no,assignee_member_id,requested_by_lead_task_id,status,tenant_id,workspace_id,principal_type,principal_id,created_at,updated_at) VALUES ($1,$2,$3,1,$4,$5,'queued',$6,$7,$8,$9,$10,$10)`,
        [
          attemptId,
          itemId,
          input.teamRunId,
          input.assigneeMemberId,
          input.leadTaskId,
          ...ownerValues(input.owner),
          now,
        ],
      );
      await client.query(
        "UPDATE team_runs SET revision=revision+1, control_state='member_work_running', updated_at=$2 WHERE id=$1",
        [input.teamRunId, now],
      );
      const item = await client.query<WorkRow>(
        'SELECT * FROM team_work_items WHERE id=$1',
        [itemId],
      );
      const attempt = await client.query<AttemptRow>(
        'SELECT * FROM team_work_item_attempts WHERE id=$1',
        [attemptId],
      );
      await client.query(
        `INSERT INTO team_messages
           (id,team_run_id,tenant_id,workspace_id,principal_type,principal_id,sequence,
            sender_member_run_id,recipient_member_run_id,work_item_id,attempt_id,kind,
            dedup_key,body,status,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,
           (SELECT COALESCE(MAX(sequence),0)+1 FROM team_messages WHERE team_run_id=$2),
           (SELECT id FROM team_member_runs WHERE team_run_id=$2 AND role='lead' LIMIT 1),
           $7,$8,$9,'wake',$10,$11,'queued',$12)
         ON CONFLICT (team_run_id,dedup_key) DO NOTHING`,
        [
          randomUUID(),
          input.teamRunId,
          ...ownerValues(input.owner),
          input.assigneeMemberId,
          itemId,
          attemptId,
          `member:${input.assigneeMemberId}:wake:work:${attemptId}`,
          'assigned_work',
          now,
        ],
      );
      await client.query(
        `INSERT INTO team_command_receipts(source_run_id,command_hash,command_name,result_json,created_at) VALUES ($1,$2,'team_work_create',$3::jsonb,$4)`,
        [
          input.sourceRunId,
          input.commandHash,
          JSON.stringify({ item_id: itemId, attempt_id: attemptId }),
          now,
        ],
      );
      await client.query('COMMIT');
      return {
        item: mapWork(item.rows![0]!),
        attempt: mapAttempt(attempt.rows![0]!),
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      if ('release' in client && typeof client.release === 'function')
        client.release();
    }
  }
  public async acceptWork(input: {
    teamRunId: string;
    workItemId: string;
    sourceRunId: string;
    leadTaskId?: string;
    commandHash: string;
    expectedRevision: number;
    owner: OwnerScope;
  }): Promise<TeamWorkItem> {
    const client = this.database.connect
      ? await this.database.connect()
      : this.database;
    try {
      await client.query('BEGIN');
      const receipt = await client.query<{
        result_json: { work_item_id?: string };
      }>(
        'SELECT result_json FROM team_command_receipts WHERE source_run_id=$1 AND command_hash=$2',
        [input.sourceRunId, input.commandHash],
      );
      if (receipt.rows?.[0]?.result_json?.work_item_id) {
        const replay = await client.query<WorkRow>(
          `SELECT * FROM team_work_items WHERE id=$1 AND team_run_id=$2 AND ${ownerSql('', 3)}`,
          [
            receipt.rows[0].result_json.work_item_id,
            input.teamRunId,
            ...ownerValues(input.owner),
          ],
        );
        if (!replay.rows?.[0]) throw new TeamExecutionError('not_found');
        await client.query('COMMIT');
        return mapWork(replay.rows[0]);
      }
      const team = await client.query<TeamRunRow>(
        `SELECT * FROM team_runs WHERE id=$1 AND revision=$2 AND status NOT IN ('succeeded','failed','cancelled') AND ${ownerSql('', 3)} FOR UPDATE`,
        [input.teamRunId, input.expectedRevision, ...ownerValues(input.owner)],
      );
      if (!team.rows?.[0]) throw new TeamExecutionError('stale_state');
      if (!input.leadTaskId) throw new TeamExecutionError('stale_state');
      await assertV2Source(
        client,
        input.sourceRunId,
        input.teamRunId,
        input.leadTaskId,
        team.rows[0].root_task_id,
        input.owner,
      );
      const item = await client.query<WorkRow>(
        `SELECT * FROM team_work_items WHERE id=$1 AND team_run_id=$2 AND ${ownerSql('', 3)} FOR UPDATE`,
        [input.workItemId, input.teamRunId, ...ownerValues(input.owner)],
      );
      if (!item.rows?.[0]) throw new TeamExecutionError('not_found');
      const latest = await client.query<AttemptRow>(
        `SELECT a.* FROM team_work_item_attempts a JOIN team_work_items w ON w.id=a.work_item_id WHERE a.work_item_id=$1 AND a.team_run_id=$2 AND w.team_run_id=$2 AND ${ownerSql('a', 3)} AND ${ownerSql('w', 3)} ORDER BY a.attempt_no DESC LIMIT 1 FOR UPDATE`,
        [input.workItemId, input.teamRunId, ...ownerValues(input.owner)],
      );
      const attempt = latest.rows?.[0];
      if (!attempt || attempt.status !== 'completed' || !attempt.result_summary)
        throw new TeamExecutionError('invalid_transition');
      const now = new Date().toISOString();
      const updated = await client.query<WorkRow>(
        `UPDATE team_work_items SET status='accepted',updated_at=$3 WHERE id=$1 AND team_run_id=$2 AND status='in_progress' AND ${ownerSql('', 4)} RETURNING *`,
        [input.workItemId, input.teamRunId, now, ...ownerValues(input.owner)],
      );
      if (!updated.rows?.[0])
        throw new TeamExecutionError('invalid_transition');
      await client.query(
        `UPDATE team_runs SET revision=revision+1,control_state='lead_ready',updated_at=$2 WHERE id=$1`,
        [input.teamRunId, now],
      );
      await client.query(
        `INSERT INTO team_command_receipts(source_run_id,command_hash,command_name,result_json,created_at) VALUES ($1,$2,'team_work_accept',$3::jsonb,$4)`,
        [
          input.sourceRunId,
          input.commandHash,
          JSON.stringify({ work_item_id: input.workItemId }),
          now,
        ],
      );
      await client.query('COMMIT');
      return mapWork(updated.rows![0]!);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      if ('release' in client && typeof client.release === 'function')
        client.release();
    }
  }
  public async cancelWork(input: {
    teamRunId: string;
    workItemId: string;
    sourceRunId: string;
    leadTaskId?: string;
    commandHash: string;
    expectedRevision: number;
    owner: OwnerScope;
  }): Promise<TeamWorkItem> {
    const client = this.database.connect
      ? await this.database.connect()
      : this.database;
    try {
      await client.query('BEGIN');
      const receipt = await client.query<{
        result_json: { work_item_id?: string };
      }>(
        'SELECT result_json FROM team_command_receipts WHERE source_run_id=$1 AND command_hash=$2',
        [input.sourceRunId, input.commandHash],
      );
      if (receipt.rows?.[0]?.result_json?.work_item_id) {
        const replay = await client.query<WorkRow>(
          `SELECT * FROM team_work_items WHERE id=$1 AND team_run_id=$2 AND ${ownerSql('', 3)}`,
          [
            receipt.rows[0].result_json.work_item_id,
            input.teamRunId,
            ...ownerValues(input.owner),
          ],
        );
        if (!replay.rows?.[0]) throw new TeamExecutionError('not_found');
        await client.query('COMMIT');
        return mapWork(replay.rows[0]);
      }
      const team = await client.query<TeamRunRow>(
        `SELECT * FROM team_runs WHERE id=$1 AND revision=$2 AND status NOT IN ('succeeded','failed','cancelled') AND ${ownerSql('', 3)} FOR UPDATE`,
        [input.teamRunId, input.expectedRevision, ...ownerValues(input.owner)],
      );
      if (!team.rows?.[0]) throw new TeamExecutionError('stale_state');
      if (!input.leadTaskId) throw new TeamExecutionError('stale_state');
      await assertV2Source(
        client,
        input.sourceRunId,
        input.teamRunId,
        input.leadTaskId,
        team.rows[0].root_task_id,
        input.owner,
      );
      const item = await client.query<WorkRow>(
        `SELECT * FROM team_work_items WHERE id=$1 AND team_run_id=$2 AND ${ownerSql('', 3)} FOR UPDATE`,
        [input.workItemId, input.teamRunId, ...ownerValues(input.owner)],
      );
      if (!item.rows?.[0]) throw new TeamExecutionError('not_found');
      const now = new Date().toISOString();
      let cancelled: TeamWorkItem;
      try {
        cancelled = cancelWorkItem(mapWork(item.rows[0]), () => new Date(now));
      } catch {
        throw new TeamExecutionError('invalid_transition');
      }
      const latest = await client.query<
        AttemptRow & { failure_code: string | null }
      >(
        `SELECT a.*,r.error->>'code' AS failure_code
           FROM team_work_item_attempts a
           JOIN tasks t ON t.id=a.execution_task_id
           JOIN runs r ON r.task_id=t.id
          WHERE a.work_item_id=$1 AND a.team_run_id=$2
            AND ${ownerSql('a', 3)} ORDER BY a.attempt_no DESC LIMIT 1 FOR UPDATE`,
        [input.workItemId, input.teamRunId, ...ownerValues(input.owner)],
      );
      const attempt = latest.rows?.[0];
      if (
        !attempt ||
        attempt.status !== 'failed' ||
        !['runtime_timed_out', 'runtime_execution_failed'].includes(
          attempt.failure_code ?? '',
        )
      )
        throw new TeamExecutionError('invalid_transition');
      const updated = await client.query<WorkRow>(
        `UPDATE team_work_items SET status=$3,updated_at=$4
          WHERE id=$1 AND team_run_id=$2 AND status='in_progress' AND ${ownerSql('', 5)} RETURNING *`,
        [
          input.workItemId,
          input.teamRunId,
          cancelled.status,
          cancelled.updatedAt,
          ...ownerValues(input.owner),
        ],
      );
      if (!updated.rows?.[0])
        throw new TeamExecutionError('invalid_transition');
      await client.query(
        `UPDATE team_runs SET revision=revision+1,control_state='lead_ready',updated_at=$2 WHERE id=$1`,
        [input.teamRunId, now],
      );
      await client.query(
        `INSERT INTO team_command_receipts(source_run_id,command_hash,command_name,result_json,created_at) VALUES ($1,$2,'team_work_cancel',$3::jsonb,$4)`,
        [
          input.sourceRunId,
          input.commandHash,
          JSON.stringify({ work_item_id: input.workItemId }),
          now,
        ],
      );
      await client.query('COMMIT');
      return mapWork(updated.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      if ('release' in client && typeof client.release === 'function')
        client.release();
    }
  }

  public async requestRework(input: {
    teamRunId: string;
    workItemId: string;
    assigneeMemberId: string;
    feedback: string;
    sourceRunId: string;
    leadTaskId: string;
    commandHash: string;
    expectedRevision: number;
    owner: OwnerScope;
  }): Promise<TeamWorkItemAttempt> {
    const client = this.database.connect
      ? await this.database.connect()
      : this.database;
    try {
      await client.query('BEGIN');
      const receipt = await client.query<{
        result_json: { attempt_id?: string };
      }>(
        'SELECT result_json FROM team_command_receipts WHERE source_run_id=$1 AND command_hash=$2',
        [input.sourceRunId, input.commandHash],
      );
      if (receipt.rows?.[0]?.result_json?.attempt_id) {
        const replay = await client.query<AttemptRow>(
          `SELECT a.* FROM team_work_item_attempts a JOIN team_work_items w ON w.id=a.work_item_id WHERE a.id=$1 AND a.team_run_id=$2 AND w.team_run_id=$2 AND ${ownerSql('a', 3)} AND ${ownerSql('w', 3)}`,
          [
            receipt.rows[0].result_json.attempt_id,
            input.teamRunId,
            ...ownerValues(input.owner),
          ],
        );
        if (!replay.rows?.[0]) throw new TeamExecutionError('not_found');
        await client.query('COMMIT');
        return mapAttempt(replay.rows[0]);
      }
      const team = await client.query<TeamRunRow>(
        `SELECT * FROM team_runs WHERE id=$1 AND revision=$2 AND status NOT IN ('succeeded','failed','cancelled') AND ${ownerSql('', 3)} FOR UPDATE`,
        [input.teamRunId, input.expectedRevision, ...ownerValues(input.owner)],
      );
      if (!team.rows?.[0]) throw new TeamExecutionError('stale_state');
      await assertV2Source(
        client,
        input.sourceRunId,
        input.teamRunId,
        input.leadTaskId,
        team.rows[0].root_task_id,
        input.owner,
      );
      const work = await client.query<WorkRow>(
        `SELECT * FROM team_work_items WHERE id=$1 AND team_run_id=$2 AND ${ownerSql('', 3)} FOR UPDATE`,
        [input.workItemId, input.teamRunId, ...ownerValues(input.owner)],
      );
      if (!work.rows?.[0]) throw new TeamExecutionError('not_found');
      {
        if (input.assigneeMemberId !== work.rows[0].owner_member_id)
          throw new TeamExecutionError('invalid_transition');
        const assignee = await client.query<{
          status: TeamMemberRun['status'];
        }>(
          `SELECT status FROM team_member_runs WHERE id=$1 AND team_run_id=$2 AND role='member' AND ${ownerSql('', 3)} FOR SHARE`,
          [
            input.assigneeMemberId,
            input.teamRunId,
            ...ownerValues(input.owner),
          ],
        );
        if (!assignee.rows?.[0]) throw new TeamExecutionError('not_found');
        if (
          assignee.rows[0].status === 'failed' ||
          assignee.rows[0].status === 'stopped'
        )
          throw new TeamExecutionError('not_allowed');
        const activeAttempt = await client.query(
          `SELECT 1 FROM team_work_item_attempts a
             WHERE a.team_run_id=$1 AND a.assignee_member_id=$2
               AND a.status IN ('queued','running')
               AND ${ownerSql('a', 3)} LIMIT 1`,
          [
            input.teamRunId,
            input.assigneeMemberId,
            ...ownerValues(input.owner),
          ],
        );
        const activeTask = await client.query(
          `SELECT 1 FROM tasks t
             WHERE t.root_task_id=$1 AND t.team_member_run_id=$2
               AND t.status NOT IN ('completed','failed','cancelled')
               AND ${ownerSql('t', 3)} LIMIT 1`,
          [
            team.rows[0].root_task_id,
            input.assigneeMemberId,
            ...ownerValues(input.owner),
          ],
        );
        if (activeAttempt.rows?.[0] || activeTask.rows?.[0])
          throw new TeamExecutionError('conflict');
      }
      const rows = await client.query<AttemptRow>(
        `SELECT a.* FROM team_work_item_attempts a JOIN team_work_items w ON w.id=a.work_item_id WHERE a.work_item_id=$1 AND a.team_run_id=$2 AND w.team_run_id=$2 AND ${ownerSql('a', 3)} AND ${ownerSql('w', 3)} ORDER BY a.attempt_no DESC LIMIT 1 FOR UPDATE`,
        [input.workItemId, input.teamRunId, ...ownerValues(input.owner)],
      );
      const previous = rows.rows?.[0];
      if (
        !previous ||
        previous.status !== 'completed' ||
        !previous.result_summary
      )
        throw new TeamExecutionError('invalid_transition');
      const rejection = await client.query(
        `SELECT 1
           FROM team_completion_decisions d
           JOIN team_completion_decision_targets target
             ON target.decision_id=d.id AND target.work_item_id=$2
           JOIN team_runs team ON team.id=d.team_run_id
          WHERE d.team_run_id=$1 AND d.decision='reject'
            AND d.completion_requested_by_run_id=team.completion_requested_by_run_id
            AND target.attempt_no_at_decision=$3
            AND ${ownerSql('d', 4)}
            AND team.completion_requested_by_run_id IS NOT NULL
          LIMIT 1`,
        [
          input.teamRunId,
          input.workItemId,
          previous.attempt_no,
          ...ownerValues(input.owner),
        ],
      );
      const rejectionBypass = Boolean(rejection.rows?.[0]);
      if (
        previous.attempt_no >= COLLABORATION_LIMITS.maxAttemptsPerItem &&
        !rejectionBypass
      )
        throw new TeamExecutionError('invalid_transition');
      if (work.rows[0].status === 'accepted' && !rejectionBypass)
        throw new TeamExecutionError('invalid_transition');
      const now = new Date().toISOString();
      const id = randomUUID();
      await client.query(
        `INSERT INTO team_work_item_attempts (id,work_item_id,team_run_id,attempt_no,assignee_member_id,requested_by_lead_task_id,feedback,status,tenant_id,workspace_id,principal_type,principal_id,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,'queued',$8,$9,$10,$11,$12,$12)`,
        [
          id,
          input.workItemId,
          input.teamRunId,
          previous.attempt_no + 1,
          input.assigneeMemberId,
          input.leadTaskId,
          input.feedback,
          ...ownerValues(input.owner),
          now,
        ],
      );
      await client.query(
        `UPDATE team_work_items SET status='pending', updated_at=$2
          WHERE id=$1 AND team_run_id=$3
            AND status IN ('in_progress','accepted') AND ${ownerSql('', 4)}`,
        [input.workItemId, now, input.teamRunId, ...ownerValues(input.owner)],
      );
      await client.query(
        "UPDATE team_runs SET revision=revision+1,control_state='member_work_running',updated_at=$2 WHERE id=$1",
        [input.teamRunId, now],
      );
      await client.query(
        `INSERT INTO team_messages
           (id,team_run_id,tenant_id,workspace_id,principal_type,principal_id,sequence,
            sender_member_run_id,recipient_member_run_id,work_item_id,attempt_id,kind,
            dedup_key,body,status,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,
           (SELECT COALESCE(MAX(sequence),0)+1 FROM team_messages WHERE team_run_id=$2),
           (SELECT id FROM team_member_runs WHERE team_run_id=$2 AND role='lead' LIMIT 1),
           $7,$8,$9,'wake',$10,$11,'queued',$12)
         ON CONFLICT (team_run_id,dedup_key) DO NOTHING`,
        [
          randomUUID(),
          input.teamRunId,
          ...ownerValues(input.owner),
          input.assigneeMemberId,
          input.workItemId,
          id,
          `member:${input.assigneeMemberId}:wake:rework:${id}`,
          input.feedback,
          now,
        ],
      );

      await client.query(
        `INSERT INTO team_command_receipts(source_run_id,command_hash,command_name,result_json,created_at) VALUES ($1,$2,'team_work_request_changes',$3::jsonb,$4)`,
        [
          input.sourceRunId,
          input.commandHash,
          JSON.stringify({ attempt_id: id }),
          now,
        ],
      );

      const result = await client.query<AttemptRow>(
        'SELECT * FROM team_work_item_attempts WHERE id=$1',
        [id],
      );
      await client.query('COMMIT');
      return mapAttempt(result.rows![0]!);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      if ('release' in client && typeof client.release === 'function')
        client.release();
    }
  }
  public async requestCompletion(input: {
    teamRunId: string;
    sourceRunId: string;
    leadTaskId?: string;
    commandHash: string;
    expectedRevision: number;
    owner: OwnerScope;
  }): Promise<{ requested: true }> {
    const client = this.database.connect
      ? await this.database.connect()
      : this.database;
    try {
      await client.query('BEGIN');
      {
        const team = await client.query<TeamRunRow>(
          `SELECT * FROM team_runs WHERE id=$1 AND ${ownerSql('', 2)} FOR UPDATE`,
          [input.teamRunId, ...ownerValues(input.owner)],
        );
        if (!team.rows?.[0] || !input.leadTaskId)
          throw new TeamExecutionError('stale_state');
        await assertV2ReplaySource(
          client,
          input.sourceRunId,
          input.teamRunId,
          input.leadTaskId,
          team.rows[0].root_task_id,
          input.owner,
        );
        const receipt = await client.query<{ result_json: unknown }>(
          'SELECT result_json FROM team_command_receipts WHERE source_run_id=$1 AND command_hash=$2',
          [input.sourceRunId, input.commandHash],
        );
        if (receipt.rows?.[0]) {
          await client.query('COMMIT');
          return { requested: true };
        }
        await assertV2Source(
          client,
          input.sourceRunId,
          input.teamRunId,
          input.leadTaskId,
          team.rows[0].root_task_id,
          input.owner,
        );
        const unfinished = await client.query(
          `SELECT 1 FROM team_work_items WHERE team_run_id=$1 AND status NOT IN ('accepted','cancelled') AND ${ownerSql('', 2)} LIMIT 1`,
          [input.teamRunId, ...ownerValues(input.owner)],
        );
        const activeAttempt = await client.query(
          `SELECT 1 FROM team_work_item_attempts WHERE team_run_id=$1 AND status IN ('queued','running') AND ${ownerSql('', 2)} LIMIT 1`,
          [input.teamRunId, ...ownerValues(input.owner)],
        );
        if (unfinished.rows?.[0] || activeAttempt.rows?.[0])
          throw new TeamExecutionError('invalid_transition');
        const nonterminalMemberChild = await client.query(
          `SELECT 1
             FROM tasks task
             JOIN team_member_runs member
               ON member.id=task.team_member_run_id
              AND member.team_run_id=$1 AND member.role='member'
             LEFT JOIN runs run ON run.task_id=task.id
            WHERE task.root_task_id=$2
              AND ${ownerSql('task', 3)}
              AND ${ownerSql('member', 3)}
              AND (
                task.status NOT IN ('completed','failed','cancelled')
                OR (run.id IS NOT NULL AND run.status NOT IN ('succeeded','failed','timed_out','cancelled'))
              )
            LIMIT 1`,
          [
            input.teamRunId,
            team.rows[0].root_task_id,
            ...ownerValues(input.owner),
          ],
        );
        if (nonterminalMemberChild.rows?.[0])
          throw new TeamExecutionError('invalid_transition');
      }
      const abandoned = await client.query(
        `SELECT 1 FROM team_work_items WHERE team_run_id=$1 AND status='cancelled' AND ${ownerSql('', 2)} LIMIT 1`,
        [input.teamRunId, ...ownerValues(input.owner)],
      );
      const r = await client.query(
        `UPDATE team_runs SET completion_requested_by_run_id=$2,
          stop_reason=CASE WHEN $4::boolean THEN 'work_abandoned' ELSE stop_reason END,
          revision=revision+1, updated_at=now()
          WHERE id=$1 AND revision=$3
            AND status NOT IN ('succeeded','failed','cancelled')
            AND ${ownerSql('', 5)} RETURNING id`,
        [
          input.teamRunId,
          input.sourceRunId,
          input.expectedRevision,
          Boolean(abandoned.rows?.[0]),
          ...ownerValues(input.owner),
        ],
      );
      if (!r.rows?.[0]) throw new TeamExecutionError('stale_state');
      await client.query(
        `INSERT INTO team_command_receipts(source_run_id,command_hash,command_name,result_json,created_at) VALUES ($1,$2,'team_finish','{"requested":true}'::jsonb,now())`,
        [input.sourceRunId, input.commandHash],
      );
      await client.query('COMMIT');
      return { requested: true };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      if ('release' in client && typeof client.release === 'function')
        client.release();
    }
  }
  public async findCompletionDecisionsByTeamRunId(
    teamRunId: string,
    owner: OwnerScope,
  ): Promise<readonly TeamCompletionDecision[]> {
    const rows = await this.database.query<CompletionDecisionRow>(
      `SELECT * FROM team_completion_decisions d
       WHERE d.team_run_id=$1 AND ${ownerSql('d', 2)}
       ORDER BY d.team_revision_at_decision ASC`,
      [teamRunId, ...ownerValues(owner)],
    );
    return Object.freeze(
      await Promise.all(
        (rows.rows ?? []).map((row) => this.loadCompletionDecision(row)),
      ),
    );
  }

  public async findLatestCompletionDecision(
    teamRunId: string,
    owner: OwnerScope,
  ): Promise<TeamCompletionDecision | null> {
    const rows = await this.database.query<CompletionDecisionRow>(
      `SELECT * FROM team_completion_decisions d
       WHERE d.team_run_id=$1 AND ${ownerSql('d', 2)}
       ORDER BY d.team_revision_at_decision DESC LIMIT 1`,
      [teamRunId, ...ownerValues(owner)],
    );
    return rows.rows?.[0] ? this.loadCompletionDecision(rows.rows[0]) : null;
  }

  public async findCompletionDecisionForRequest(
    teamRunId: string,
    completionRequestedByRunId: string,
    owner: OwnerScope,
  ): Promise<TeamCompletionDecision | null> {
    const rows = await this.database.query<CompletionDecisionRow>(
      `SELECT * FROM team_completion_decisions d
       WHERE d.team_run_id=$1 AND d.completion_requested_by_run_id=$2
         AND ${ownerSql('d', 3)} LIMIT 1`,
      [teamRunId, completionRequestedByRunId, ...ownerValues(owner)],
    );
    return rows.rows?.[0] ? this.loadCompletionDecision(rows.rows[0]) : null;
  }

  public async recordCompletionRejectionInTransaction(
    input: CompletionRejectionInput,
  ): Promise<CompletionRejectionResult> {
    return this.recordCompletionRejectionCore(input, this.database);
  }

  private async recordCompletionRejectionCore(
    input: CompletionRejectionInput,
    client: Queryable,
  ): Promise<CompletionRejectionResult> {
    const existing = await client.query<CompletionDecisionRow>(
      `SELECT * FROM team_completion_decisions d
         WHERE d.team_run_id=$1 AND d.completion_requested_by_run_id=$2
           AND ${ownerSql('d', 3)} LIMIT 1`,
      [
        input.teamRunId,
        input.completionRequestedByRunId,
        ...ownerValues(input.owner),
      ],
    );
    if (existing.rows?.[0]) {
      const team = await client.query<TeamRunRow>(
        `SELECT * FROM team_runs WHERE id=$1 AND ${ownerSql('', 2)}`,
        [input.teamRunId, ...ownerValues(input.owner)],
      );
      if (!team.rows?.[0]) throw new TeamExecutionError('not_found');
      const decision = await this.loadCompletionDecision(
        existing.rows[0],
        client,
      );
      if (input.expectedRevision !== decision.teamRevisionAtDecision)
        throw new TeamExecutionError('stale_state');
      const normalizedFeedback = normalizeDecisionFeedback(input.feedback);
      const sameTargets =
        decision.targets.length === input.workItemIds.length &&
        decision.targets.every(
          (target, index) => target.workItemId === input.workItemIds[index],
        );
      if (
        decision.feedback !== normalizedFeedback ||
        decision.decidedBy !== input.decidedBy ||
        !sameTargets
      )
        throw new TeamExecutionError('conflict');
      return { decision, team: mapRun(team.rows[0]), recorded: false };
    }

    const locked = await client.query<TeamRunRow>(
      `SELECT * FROM team_runs
         WHERE id=$1 AND revision=$2 AND ${ownerSql('', 3)} FOR UPDATE`,
      [input.teamRunId, input.expectedRevision, ...ownerValues(input.owner)],
    );
    const team = locked.rows?.[0];
    if (!team) throw new TeamExecutionError('stale_state');
    if (
      team.status !== 'active' ||
      !team.completion_approval_required ||
      team.completion_requested_by_run_id !== input.completionRequestedByRunId
    )
      throw new TeamExecutionError('invalid_transition');

    const feedback = normalizeDecisionFeedback(input.feedback);
    if (!feedback) throw new TeamExecutionError('invalid_transition');
    const uniqueWorkItemIds = new Set(input.workItemIds);
    if (
      input.workItemIds.length === 0 ||
      uniqueWorkItemIds.size !== input.workItemIds.length
    )
      throw new TeamExecutionError('invalid_target');

    const targetRows = await client.query<{
      id: string;
      status: TeamWorkItem['status'];
      attempt_no: number | null;
      attempt_status: TeamWorkItemAttempt['status'] | null;
      result_summary: string | null;
    }>(
      `SELECT w.id,w.status,a.attempt_no,a.status AS attempt_status,a.result_summary
         FROM team_work_items w
         LEFT JOIN LATERAL (
           SELECT a.attempt_no,a.status,a.result_summary
           FROM team_work_item_attempts a
           WHERE a.work_item_id=w.id AND a.team_run_id=w.team_run_id
             AND ${ownerSql('a', 2)}
           ORDER BY a.attempt_no DESC LIMIT 1
         ) a ON true
         WHERE w.team_run_id=$1 AND ${ownerSql('w', 2)}
           AND w.id = ANY($6::uuid[])`,
      [input.teamRunId, ...ownerValues(input.owner), input.workItemIds],
    );
    const byId = new Map((targetRows.rows ?? []).map((row) => [row.id, row]));
    const targets = input.workItemIds.map((workItemId, index) => {
      const target = byId.get(workItemId);
      if (
        !target ||
        target.status !== 'accepted' ||
        target.attempt_no === null ||
        target.attempt_status !== 'completed' ||
        !target.result_summary?.trim()
      )
        throw new TeamExecutionError('invalid_target');
      return {
        workItemId,
        attemptNoAtDecision: target.attempt_no,
        ordinal: index + 1,
      };
    });

    const decisionId = randomUUID();
    await client.query(
      `INSERT INTO team_completion_decisions
          (id,team_run_id,completion_requested_by_run_id,decision,feedback,
           decided_by,decided_at,team_revision_at_decision,
           lead_turn_count_at_decision,tenant_id,workspace_id,principal_type,
           principal_id)
         VALUES ($1,$2,$3,'reject',$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        decisionId,
        input.teamRunId,
        input.completionRequestedByRunId,
        feedback,
        input.decidedBy,
        input.decidedAt,
        team.revision,
        team.lead_turn_count,
        ...ownerValues(input.owner),
      ],
    );
    for (const target of targets) {
      await client.query(
        `INSERT INTO team_completion_decision_targets
            (decision_id,team_run_id,work_item_id,attempt_no_at_decision,
             ordinal,tenant_id,workspace_id,principal_type,principal_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          decisionId,
          input.teamRunId,
          target.workItemId,
          target.attemptNoAtDecision,
          target.ordinal,
          ...ownerValues(input.owner),
        ],
      );
    }
    const updated = await client.query<TeamRunRow>(
      `UPDATE team_runs SET revision=revision+1,updated_at=$2
         WHERE id=$1 AND revision=$3 AND ${ownerSql('', 4)} RETURNING *`,
      [
        input.teamRunId,
        input.decidedAt,
        input.expectedRevision,
        ...ownerValues(input.owner),
      ],
    );
    if (!updated.rows?.[0]) throw new TeamExecutionError('stale_state');
    const decision = rehydrateTeamCompletionDecision({
      id: decisionId,
      tenantId: input.owner.tenantId,
      workspaceId: input.owner.workspaceId,
      principalType: input.owner.principalType,
      principalId: input.owner.principalId,
      teamRunId: input.teamRunId,
      completionRequestedByRunId: input.completionRequestedByRunId,
      decision: 'reject',
      feedback,
      decidedBy: input.decidedBy,
      decidedAt: input.decidedAt,
      teamRevisionAtDecision: team.revision,
      leadTurnCountAtDecision: team.lead_turn_count,
      targets: targets.map(({ ordinal: _ordinal, ...target }) => target),
    });
    return { decision, team: mapRun(updated.rows[0]), recorded: true };
  }

  public async advanceAgenticLead(input: {
    teamRunId: string;
    expectedRevision: number;
    owner: OwnerScope;
  }): Promise<TeamRun> {
    const r = await this.database.query<TeamRunRow>(
      `UPDATE team_runs SET control_state='lead_running',lead_turn_count=lead_turn_count+1,revision=revision+1,updated_at=now()
       WHERE id=$1 AND revision=$2 AND status NOT IN ('succeeded','failed','cancelled')
         AND (
           lead_turn_count < $7
           OR lead_turn_count - COALESCE((
             SELECT d.lead_turn_count_at_decision
             FROM team_completion_decisions d
             WHERE d.team_run_id=team_runs.id
               AND d.decision='reject'
               AND d.completion_requested_by_run_id=team_runs.completion_requested_by_run_id
               AND d.completion_requested_by_run_id IS NOT NULL
               AND d.lead_turn_count_at_decision <= team_runs.lead_turn_count
               AND ${ownerSql('d', 3)}
             ORDER BY d.team_revision_at_decision DESC LIMIT 1
           ), 0) < $7
         )
         AND ${ownerSql('', 3)} RETURNING *`,
      [
        input.teamRunId,
        input.expectedRevision,
        ...ownerValues(input.owner),
        COLLABORATION_LIMITS.maxLeadTurns,
      ],
    );
    if (!r.rows?.[0]) {
      const current = await this.database.query<{
        lead_turn_count: number;
        revision: number;
        rejection_baseline: number | null;
      }>(
        `SELECT team.lead_turn_count, team.revision,
                (
                  SELECT d.lead_turn_count_at_decision
                  FROM team_completion_decisions d
                  WHERE d.team_run_id=team.id AND d.decision='reject'
                    AND d.completion_requested_by_run_id=team.completion_requested_by_run_id
                    AND d.completion_requested_by_run_id IS NOT NULL
                    AND d.lead_turn_count_at_decision <= team.lead_turn_count
                    AND ${ownerSql('d', 2)}
                  ORDER BY d.team_revision_at_decision DESC LIMIT 1
                ) AS rejection_baseline
           FROM team_runs team WHERE team.id=$1 AND ${ownerSql('team', 2)}`,
        [input.teamRunId, ...ownerValues(input.owner)],
      );
      if (
        (current.rows?.[0]?.revision ?? input.expectedRevision) >
        input.expectedRevision
      )
        throw new TeamExecutionError('stale_state');
      const currentLeadTurnCount = current.rows?.[0]?.lead_turn_count ?? 0;
      const rejectionBaseline = current.rows?.[0]?.rejection_baseline;
      if (
        currentLeadTurnCount >= COLLABORATION_LIMITS.maxLeadTurns &&
        (rejectionBaseline === null ||
          rejectionBaseline === undefined ||
          currentLeadTurnCount - rejectionBaseline >=
            COLLABORATION_LIMITS.maxLeadTurns)
      )
        throw new TeamExecutionError('limit_exceeded');
      throw new TeamExecutionError('stale_state');
    }
    return mapRun(r.rows[0]);
  }
  private async findRun(
    predicate: string,
    values: readonly unknown[],
  ): Promise<TeamRun | null> {
    const r = await this.database.query<TeamRunRow>(
      `SELECT * FROM team_runs WHERE ${predicate} AND ${ownerSql('', 2)}`,
      values,
    );
    return r.rows?.[0] ? mapRun(r.rows[0]) : null;
  }
  private async loadCompletionDecision(
    row: CompletionDecisionRow,
    database: Queryable = this.database,
  ): Promise<TeamCompletionDecision> {
    const targets = await database.query<CompletionDecisionTargetRow>(
      `SELECT * FROM team_completion_decision_targets
       WHERE decision_id=$1 AND ${ownerSql('', 2)}
       ORDER BY ordinal ASC`,
      [
        row.id,
        ...ownerValues({
          tenantId: row.tenant_id,
          workspaceId: row.workspace_id,
          principalType: row.principal_type,
          principalId: row.principal_id,
        }),
      ],
    );
    return rehydrateTeamCompletionDecision({
      id: row.id,
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      principalType: row.principal_type,
      principalId: row.principal_id,
      teamRunId: row.team_run_id,
      completionRequestedByRunId: row.completion_requested_by_run_id,
      decision: row.decision,
      feedback: row.feedback,
      decidedBy: row.decided_by,
      decidedAt: iso(row.decided_at)!,
      teamRevisionAtDecision: row.team_revision_at_decision,
      leadTurnCountAtDecision: row.lead_turn_count_at_decision,
      targets: (targets.rows ?? []).map((target) => ({
        workItemId: target.work_item_id,
        attemptNoAtDecision: target.attempt_no_at_decision,
      })),
    });
  }
  private async updateMember(
    id: string,
    status: TeamMemberRun['status'] | undefined,
    session: string | null | undefined,
    owner?: OwnerScope,
    expectedCurrentStatus?: TeamMemberRun['status'],
  ): Promise<TeamMemberRun> {
    const vals: any[] = [];
    const sets: string[] = [];
    if (status !== undefined) {
      sets.push(`status=$${vals.length + 1}`);
      vals.push(status);
    }
    if (session !== undefined) {
      sets.push(`runtime_session_id=$${vals.length + 1}`);
      vals.push(session);
    }
    vals.push(id, ...ownerValues(owner!));
    const whereConditions: string[] = [`id=$${sets.length + 1}`, `${ownerSql('', sets.length + 2)}`];
    if (expectedCurrentStatus !== undefined) {
      whereConditions.push(`status=$${sets.length + 3}`);
      vals.push(expectedCurrentStatus);
    }
    const r = await this.database.query<MemberRow>(
      `UPDATE team_member_runs SET ${sets.join(',')}, updated_at=now() WHERE ${whereConditions.join(' AND ')} RETURNING *`,
      vals,
    );
    if (!r.rows?.[0]) {
      if (expectedCurrentStatus !== undefined) {
        throw new TeamExecutionError('conflict');
      }
      throw new Error('Member run was not found.');
    }
    return mapMember(r.rows[0]);
  }
}
async function assertV2Source(
  client: Queryable,
  sourceRunId: string,
  teamRunId: string,
  sourceTaskId: string | undefined,
  rootTaskId: string,
  owner: OwnerScope,
): Promise<void> {
  const result = await client.query(
    `SELECT 1 FROM runs r
       JOIN tasks t ON t.id=r.task_id
       JOIN team_member_runs m ON m.id=t.team_member_run_id
      WHERE r.id=$1 AND m.team_run_id=$2 AND m.role='lead'
        AND t.root_task_id=$3
        AND ($4::uuid IS NULL OR t.id=$4)
        AND r.status NOT IN ('succeeded','failed','timed_out','cancelled')
        AND t.status NOT IN ('completed','failed','cancelled')
        AND ${ownerSql('t', 5)}`,
    [
      sourceRunId,
      teamRunId,
      rootTaskId,
      sourceTaskId ?? null,
      ...ownerValues(owner),
    ],
  );
  if (!result.rows?.[0]) throw new TeamExecutionError('stale_state');
}

/** A finish receipt is replayable only by the original owner-scoped Lead source. */
async function assertV2ReplaySource(
  client: Queryable,
  sourceRunId: string,
  teamRunId: string,
  sourceTaskId: string | undefined,
  rootTaskId: string,
  owner: OwnerScope,
): Promise<void> {
  const result = await client.query(
    `SELECT 1 FROM runs r
       JOIN tasks t ON t.id=r.task_id
       JOIN team_member_runs m ON m.id=t.team_member_run_id
      WHERE r.id=$1 AND m.team_run_id=$2 AND m.role='lead'
        AND t.root_task_id=$3 AND ($4::uuid IS NULL OR t.id=$4)
        AND ${ownerSql('t', 5)}`,
    [
      sourceRunId,
      teamRunId,
      rootTaskId,
      sourceTaskId ?? null,
      ...ownerValues(owner),
    ],
  );
  if (!result.rows?.[0]) throw new TeamExecutionError('stale_state');
}

function ownerValues(o: OwnerScope): string[] {
  return [o.tenantId, o.workspaceId, o.principalType, o.principalId];
}

async function assertTeamRootFence(
  database: Queryable,
  team: TeamRunRow,
  rootRunId: string,
  rootTaskId: string,
  owner: OwnerScope,
): Promise<void> {
  if (team.root_run_id !== rootRunId || team.root_task_id !== rootTaskId)
    throw new TeamExecutionError('stale_state');
  const root = await database.query(
    `SELECT r.id FROM runs r
       JOIN tasks t ON t.id=r.task_id
      WHERE r.id=$1 AND r.task_id=$2
        AND t.id=$2 AND t.root_task_id=t.id
        AND t.parent_task_id IS NULL AND t.parent_run_id IS NULL
        AND t.invokable_kind='team' AND ${ownerSql('t', 3)}`,
    [rootRunId, rootTaskId, ...ownerValues(owner)],
  );
  if (!root.rows?.[0]) throw new TeamExecutionError('stale_state');
}

function ownerSql(alias: string, start: number): string {
  const p = alias ? `${alias}.` : '';
  return `${p}tenant_id=$${start} AND ${p}workspace_id=$${start + 1} AND ${p}principal_type=$${start + 2} AND ${p}principal_id=$${start + 3}`;
}
function iso(v: string | Date | null): string | null {
  return v === null ? null : v instanceof Date ? v.toISOString() : v;
}
function mapRun(r: TeamRunRow): TeamRun {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    workspaceId: r.workspace_id,
    principalType: r.principal_type,
    principalId: r.principal_id,
    rootTaskId: r.root_task_id,
    rootRunId: r.root_run_id,
    teamVersionId: r.team_version_id,
    environmentVersionId: r.environment_version_id,
    finalText: r.final_text,
    controlState: r.control_state,
    revision: r.revision,
    leadTurnCount: r.lead_turn_count,
    stopReason: r.stop_reason,
    completionRequestedByRunId: r.completion_requested_by_run_id,
    completionApprovalRequired: r.completion_approval_required,
    status: r.status,
    phase: r.phase,
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
  };
}
function mapMember(r: MemberRow): TeamMemberRun {
  return {
    ...r,
    teamRunId: r.team_run_id,
    agentVersionId: r.agent_version_id,
    runtimeSessionId: r.runtime_session_id,
    currentWorkItemId: r.current_work_item_id,
    tenantId: r.tenant_id,
    workspaceId: r.workspace_id,
    principalType: r.principal_type,
    principalId: r.principal_id,
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
  };
}
function mapWork(r: WorkRow): TeamWorkItem {
  return {
    ...r,
    teamRunId: r.team_run_id,
    description: r.description,
    ownerMemberId: r.owner_member_id,
    createdByMemberId: r.created_by_member_id,
    completionSummary: r.completion_summary,
    executionTaskId: r.execution_task_id,
    tenantId: r.tenant_id,
    workspaceId: r.workspace_id,
    principalType: r.principal_type,
    principalId: r.principal_id,
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
    completedAt: iso(r.completed_at),
  };
}
function mapAttempt(r: AttemptRow): TeamWorkItemAttempt {
  return {
    id: r.id,
    workItemId: r.work_item_id,
    teamRunId: r.team_run_id,
    attemptNo: r.attempt_no,
    assigneeMemberId: r.assignee_member_id,
    requestedByLeadTaskId: r.requested_by_lead_task_id,
    feedback: r.feedback,
    executionTaskId: r.execution_task_id,
    status: r.status,
    resultSummary: r.result_summary,
    tenantId: r.tenant_id,
    workspaceId: r.workspace_id,
    principalType: r.principal_type,
    principalId: r.principal_id,
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
    completedAt: iso(r.completed_at),
  };
}
