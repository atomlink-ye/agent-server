import { randomUUID } from 'node:crypto';
import type {
  TeamExecutionRepository,
  OwnerScope,
} from '../../application/ports/team-execution-repository.js';
import {
  normalizeTeamRunFinalText,
  type TeamRun,
} from '../../domain/teams/team-run.js';
import type { TeamMemberRun } from '../../domain/teams/team-member-run.js';
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

type TeamRunRow = Omit<TeamRun, never> & {
  tenant_id: string;
  workspace_id: string;
  principal_type: string;
  principal_id: string;
  root_task_id: string;
  root_run_id: string;
  team_version_id: string;
  environment_version_id: string;
  execution_mode: TeamRun['executionMode'];
  control_state: TeamRun['controlState'];
  revision: number;
  lead_turn_count: number;
  stop_reason: string | null;
  completion_requested_by_run_id: string | null;
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

export class PostgresTeamExecutionRepository implements TeamExecutionRepository {
  public constructor(
    private readonly database: Queryable &
      Partial<Pick<Connectable, 'connect'>>,
  ) {}
  public async createTeamRun(run: TeamRun): Promise<void> {
    await this.database.query(
      `INSERT INTO team_runs (id,tenant_id,workspace_id,principal_type,principal_id,root_task_id,root_run_id,team_version_id,environment_version_id,status,phase,final_text,execution_mode,control_state,revision,lead_turn_count,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
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
        run.executionMode,
        run.controlState,
        run.revision,
        run.leadTurnCount,
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
  public async updateTeamRunPhase(
    id: string,
    phase: TeamRun['phase'],
    owner: OwnerScope,
    expectedPhase?: TeamRun['phase'],
  ): Promise<TeamRun> {
    return this.updateRun(
      'phase = $1',
      [phase, id, ...ownerValues(owner), expectedPhase],
      expectedPhase ? ' AND phase=$7' : undefined,
    );
  }
  public async updateTeamRunPhaseIfCurrent(
    id: string,
    phase: TeamRun['phase'],
    owner: OwnerScope,
    expectedPhase: TeamRun['phase'],
  ): Promise<TeamRun | null> {
    const r = await this.database.query<TeamRunRow>(
      `UPDATE team_runs SET phase=$1, updated_at=now() WHERE id=$2 AND ${ownerSql('', 3)} AND phase=$7 RETURNING *`,
      [phase, id, ...ownerValues(owner), expectedPhase],
    );
    return r.rows?.[0] ? mapRun(r.rows[0]) : null;
  }
  public async updateTeamRunStatus(
    id: string,
    status: TeamRun['status'],
    finalText: string | null,
    owner: OwnerScope,
  ): Promise<TeamRun> {
    return this.updateRun(
      "status = $1, phase = 'done', final_text = $2",
      [status, finalText, id, ...ownerValues(owner), 'lead_finalize'],
      ' AND phase=$7',
    );
  }
  public async completeTeamRunAtomically(input: {
    readonly teamRunId: string;
    readonly rootRunId: string;
    readonly rootTaskId: string;
    readonly finalText: string;
    readonly owner: OwnerScope;
    readonly updatedAt: string;
    readonly completionIntent?: 'legacy_lead_finalize' | 'agentic';
    readonly executionMode?: TeamRun['executionMode'];
    readonly leadRunId?: string;
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
      if (team.status === 'succeeded' && team.phase === 'done') {
        normalizeTeamRunFinalText(team.final_text ?? '');
        await client.query('COMMIT');
        return mapRun(team);
      }
      if (team.execution_mode === 'agentic_mve') {
        if (
          input.completionIntent !== 'agentic' ||
          input.executionMode !== 'agentic_mve' ||
          !input.leadRunId ||
          !team.completion_requested_by_run_id
        )
          throw new Error(
            'Agentic Team completion intent or fence is invalid.',
          );
        const lead = await client.query(
          `SELECT 1 FROM runs WHERE id=$1 AND status='succeeded'`,
          [input.leadRunId],
        );
        if (!lead.rows?.[0])
          throw new Error('Agentic Lead Run was not succeeded.');
        const unsettled = await client.query(
          `SELECT 1 FROM team_work_item_attempts WHERE team_run_id=$1 AND (status <> 'completed' OR result_summary IS NULL) LIMIT 1`,
          [input.teamRunId],
        );
        if (unsettled.rows?.[0])
          throw new Error('Agentic Team has unsettled work attempts.');
        const unaccepted = await client.query(
          `SELECT 1 FROM team_work_items WHERE team_run_id=$1 AND status <> 'accepted' LIMIT 1`,
          [input.teamRunId],
        );
        if (unaccepted.rows?.[0])
          throw new Error('Agentic Team has unaccepted work.');
      } else {
        if (
          input.completionIntent !== 'legacy_lead_finalize' ||
          input.executionMode === 'agentic_mve' ||
          team.phase !== 'lead_finalize'
        )
          throw new Error('Team can only be completed during lead_finalize.');
        const unfinished = await client.query(
          `SELECT 1 FROM team_work_items WHERE team_run_id=$1 AND status NOT IN ('completed','accepted') LIMIT 1`,
          [input.teamRunId],
        );
        if (unfinished.rows?.[0])
          throw new Error('Team has unfinished work items.');
      }
      const updated = await client.query<TeamRunRow>(
        `UPDATE team_runs SET status='succeeded', phase='done', final_text=$2, updated_at=$3 WHERE id=$1 RETURNING *`,
        [input.teamRunId, normalizedFinalText, input.updatedAt],
      );
      const run = await client.query(
        `UPDATE runs SET status='succeeded', result=$2::jsonb, error=NULL, updated_at=$3 WHERE id=$1 AND status='waiting_children' RETURNING id`,
        [
          input.rootRunId,
          JSON.stringify({ text: normalizedFinalText }),
          input.updatedAt,
        ],
      );
      if (!run.rows?.[0]) throw new Error('Root run was not waiting.');
      const task = await client.query(
        `UPDATE tasks SET status='completed', updated_at=$2 WHERE id=$1 AND status <> 'completed' RETURNING id`,
        [input.rootTaskId, input.updatedAt],
      );
      if (!task.rows?.[0]) {
        const exists = await client.query('SELECT 1 FROM tasks WHERE id=$1', [
          input.rootTaskId,
        ]);
        if (!exists.rows?.[0]) throw new Error('Team root task not found.');
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
  ): Promise<TeamMemberRun> {
    return this.updateMember(id, status, runtimeSessionId, owner);
  }
  public async updateMemberRuntimeSession(
    id: string,
    runtimeSessionId: string,
    owner: OwnerScope,
  ): Promise<TeamMemberRun> {
    return this.updateMember(id, undefined, runtimeSessionId, owner);
  }
  public async createWorkItem(item: TeamWorkItem): Promise<void> {
    await this.database.query(
      `INSERT INTO team_work_items (id,team_run_id,subject,description,status,owner_member_id,created_by_member_id,completion_summary,execution_task_id,tenant_id,workspace_id,principal_type,principal_id,created_at,updated_at,completed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        item.id,
        item.teamRunId,
        item.subject,
        item.description,
        item.status,
        item.ownerMemberId,
        item.createdByMemberId,
        item.completionSummary,
        item.executionTaskId,
        item.tenantId,
        item.workspaceId,
        item.principalType,
        item.principalId,
        item.createdAt,
        item.updatedAt,
        item.completedAt,
      ],
    );
  }
  public async findWorkItemsByTeamRunId(
    id: string,
    owner: OwnerScope,
  ): Promise<TeamWorkItem[]> {
    const r = await this.database.query<WorkRow>(
      `SELECT * FROM team_work_items WHERE team_run_id=$1 AND ${ownerSql('', 2)} ORDER BY created_at`,
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
  public async atomicClaimWorkItem(
    id: string,
    ownerMemberId: string,
    teamRunId: string,
    owner: OwnerScope,
  ): Promise<TeamWorkItem> {
    let r;
    try {
      r = await this.database.query<WorkRow>(
        `UPDATE team_work_items SET status='in_progress', owner_member_id=$2, updated_at=now() WHERE id=$1 AND team_run_id=$3 AND status='pending' AND ${ownerSql('', 4)} AND NOT EXISTS (SELECT 1 FROM team_work_items active WHERE active.team_run_id=$3 AND active.owner_member_id=$2 AND active.status='in_progress') RETURNING *`,
        [id, ownerMemberId, teamRunId, ...ownerValues(owner)],
      );
    } catch (error) {
      if ((error as { code?: string }).code === '23505')
        throw new Error('Member already has an in-progress work item.');
      throw error;
    }
    if (!r.rows?.[0])
      throw new Error('Work item was not found or already claimed.');
    return mapWork(r.rows[0]);
  }
  public async updateWorkItemStatus(
    id: string,
    status: TeamWorkItem['status'],
    completionSummary: string | null,
    owner: OwnerScope & {
      readonly memberId?: string;
      readonly role?: 'lead' | 'member';
    },
  ): Promise<TeamWorkItem> {
    const r = await this.database.query<WorkRow>(
      `UPDATE team_work_items SET status=$2, completion_summary=$3, completed_at=CASE WHEN $2='completed' THEN now() ELSE completed_at END, updated_at=now() WHERE id=$1 AND ${ownerSql('', 4)} AND ($9='lead' OR owner_member_id=$8) RETURNING *`,
      [
        id,
        status,
        completionSummary,
        ...ownerValues(owner),
        owner.memberId ?? null,
        owner.role ?? 'member',
      ],
    );
    if (!r.rows?.[0]) throw new Error('Work item was not found.');
    return mapWork(r.rows[0]);
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
  public async bindAttemptExecution(
    attemptId: string,
    executionTaskId: string,
    owner: OwnerScope,
  ): Promise<TeamWorkItemAttempt> {
    const r = await this.database.query<AttemptRow>(
      `UPDATE team_work_item_attempts SET execution_task_id=$2 WHERE id=$1 AND ${ownerSql('', 3)} AND execution_task_id IS NULL RETURNING *`,
      [attemptId, executionTaskId, ...ownerValues(owner)],
    );
    if (r.rows?.[0]) return mapAttempt(r.rows[0]);
    const existing = await this.database.query<AttemptRow>(
      `SELECT * FROM team_work_item_attempts WHERE id=$1 AND ${ownerSql('', 2)}`,
      [attemptId, ...ownerValues(owner)],
    );
    if (!existing.rows?.[0]) throw new Error('Work attempt was not found.');
    return mapAttempt(existing.rows[0]);
  }
  public async updateAttemptStatus(
    attemptId: string,
    status: TeamWorkItemAttempt['status'],
    resultSummary: string | null,
    owner: OwnerScope,
  ): Promise<TeamWorkItemAttempt> {
    const r = await this.database.query<AttemptRow>(
      `UPDATE team_work_item_attempts SET status=$2,result_summary=$3,completed_at=CASE WHEN $2 IN ('completed','failed') THEN now() ELSE completed_at END,updated_at=now() WHERE id=$1 AND ${ownerSql('', 4)} RETURNING *`,
      [attemptId, status, resultSummary, ...ownerValues(owner)],
    );
    if (!r.rows?.[0]) throw new Error('Work attempt was not found.');
    return mapAttempt(r.rows[0]);
  }

  public async createAssignedWork(input: {
    teamRunId: string;
    sourceRunId: string;
    leadTaskId: string;
    assigneeMemberId: string;
    subject: string;
    description: string | null;
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
        throw new Error(
          'Idempotent command replay must be handled by the caller.',
        );
      }
      const team = await client.query<TeamRunRow>(
        `SELECT * FROM team_runs WHERE id=$1 AND revision=$2 AND execution_mode='agentic_mve' AND ${ownerSql('', 3)} FOR UPDATE`,
        [input.teamRunId, input.expectedRevision, ...ownerValues(input.owner)],
      );
      if (!team.rows?.[0])
        throw new Error('Agentic Team run fence or revision is stale.');
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
        'INSERT INTO team_command_receipts(source_run_id,command_hash,command_name,result_json,created_at) VALUES ($1,$2,$3,$4::jsonb,$5)',
        [
          input.sourceRunId,
          input.commandHash,
          'team_work_create_and_assign',
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
          'SELECT * FROM team_work_items WHERE id=$1',
          [receipt.rows[0].result_json.work_item_id],
        );
        if (!replay.rows?.[0])
          throw new Error('Accepted work receipt target is missing.');
        await client.query('COMMIT');
        return mapWork(replay.rows[0]);
      }
      const team = await client.query<TeamRunRow>(
        `SELECT * FROM team_runs WHERE id=$1 AND revision=$2 AND execution_mode='agentic_mve' AND ${ownerSql('', 3)} FOR UPDATE`,
        [input.teamRunId, input.expectedRevision, ...ownerValues(input.owner)],
      );
      if (!team.rows?.[0])
        throw new Error('Agentic Team run fence or revision is stale.');
      const item = await client.query<WorkRow>(
        `SELECT * FROM team_work_items WHERE id=$1 AND team_run_id=$2 AND ${ownerSql('', 3)} FOR UPDATE`,
        [input.workItemId, input.teamRunId, ...ownerValues(input.owner)],
      );
      if (!item.rows?.[0]) throw new Error('Work item was not found.');
      const latest = await client.query<AttemptRow>(
        `SELECT * FROM team_work_item_attempts WHERE work_item_id=$1 ORDER BY attempt_no DESC LIMIT 1`,
        [input.workItemId],
      );
      const attempt = latest.rows?.[0];
      if (!attempt || attempt.status !== 'completed' || !attempt.result_summary)
        throw new Error(
          'Work can only be accepted after its latest attempt completed with a result.',
        );
      const now = new Date().toISOString();
      const updated = await client.query<WorkRow>(
        `UPDATE team_work_items SET status='accepted',updated_at=$2 WHERE id=$1 RETURNING *`,
        [input.workItemId, now],
      );
      await client.query(
        `UPDATE team_runs SET revision=revision+1,updated_at=$2 WHERE id=$1`,
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
          'SELECT * FROM team_work_item_attempts WHERE id=$1',
          [receipt.rows[0].result_json.attempt_id],
        );
        if (!replay.rows?.[0])
          throw new Error('Rework receipt target is missing.');
        await client.query('COMMIT');
        return mapAttempt(replay.rows[0]);
      }
      const team = await client.query<TeamRunRow>(
        `SELECT * FROM team_runs WHERE id=$1 AND revision=$2 AND execution_mode='agentic_mve' AND ${ownerSql('', 3)} FOR UPDATE`,
        [input.teamRunId, input.expectedRevision, ...ownerValues(input.owner)],
      );
      if (!team.rows?.[0])
        throw new Error('Agentic Team run fence or revision is stale.');
      const rows = await client.query<AttemptRow>(
        'SELECT * FROM team_work_item_attempts WHERE work_item_id=$1 ORDER BY attempt_no DESC LIMIT 1 FOR UPDATE',
        [input.workItemId],
      );
      const previous = rows.rows?.[0];
      if (
        !previous ||
        previous.attempt_no >= 2 ||
        previous.status !== 'completed' ||
        !previous.result_summary
      )
        throw new Error('Rework requires a completed attempt with a result.');
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
        'UPDATE team_runs SET revision=revision+1,updated_at=$2 WHERE id=$1',
        [input.teamRunId, now],
      );
      await client.query(
        `INSERT INTO team_command_receipts(source_run_id,command_hash,command_name,result_json,created_at) VALUES ($1,$2,'team_work_request_rework',$3::jsonb,$4)`,
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
    commandHash: string;
    expectedRevision: number;
    owner: OwnerScope;
  }): Promise<{ requested: true }> {
    const client = this.database.connect
      ? await this.database.connect()
      : this.database;
    try {
      await client.query('BEGIN');
      const receipt = await client.query<{ result_json: unknown }>(
        'SELECT result_json FROM team_command_receipts WHERE source_run_id=$1 AND command_hash=$2',
        [input.sourceRunId, input.commandHash],
      );
      if (receipt.rows?.[0]) {
        await client.query('COMMIT');
        return { requested: true };
      }
      const r = await client.query(
        "UPDATE team_runs SET completion_requested_by_run_id=$2, revision=revision+1, updated_at=now() WHERE id=$1 AND revision=$3 AND execution_mode='agentic_mve' AND " +
          ownerSql('', 4) +
          ' RETURNING id',
        [
          input.teamRunId,
          input.sourceRunId,
          input.expectedRevision,
          ...ownerValues(input.owner),
        ],
      );
      if (!r.rows?.[0])
        throw new Error('Agentic Team run fence or revision is stale.');
      await client.query(
        `INSERT INTO team_command_receipts(source_run_id,command_hash,command_name,result_json,created_at) VALUES ($1,$2,'team_completion_request','{"requested":true}'::jsonb,now())`,
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
  public async advanceAgenticLead(input: {
    teamRunId: string;
    expectedRevision: number;
    owner: OwnerScope;
  }): Promise<TeamRun> {
    const r = await this.database.query<TeamRunRow>(
      `UPDATE team_runs SET control_state='lead_running',lead_turn_count=lead_turn_count+1,revision=revision+1,updated_at=now() WHERE id=$1 AND revision=$2 AND execution_mode='agentic_mve' AND lead_turn_count < 4 AND ${ownerSql('', 3)} RETURNING *`,
      [input.teamRunId, input.expectedRevision, ...ownerValues(input.owner)],
    );
    if (!r.rows?.[0])
      throw new Error(
        'Agentic Team lead turn limit or revision fence exceeded.',
      );
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
  private async updateRun(
    set: string,
    values: readonly unknown[],
    suffix = '',
  ): Promise<TeamRun> {
    const r = await this.database.query<TeamRunRow>(
      `UPDATE team_runs SET ${set}, updated_at=now() WHERE id=$${set.startsWith('status') ? '3' : '2'} AND ${ownerSql('', set.startsWith('status') ? 4 : 3)}${suffix} RETURNING *`,
      values,
    );
    if (!r.rows?.[0]) throw new Error('Team run was not found.');
    return mapRun(r.rows[0]);
  }
  private async updateMember(
    id: string,
    status: TeamMemberRun['status'] | undefined,
    session: string | null | undefined,
    owner?: OwnerScope,
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
    const r = await this.database.query<MemberRow>(
      `UPDATE team_member_runs SET ${sets.join(',')}, updated_at=now() WHERE id=$${sets.length + 1} AND ${ownerSql('', sets.length + 2)} RETURNING *`,
      vals,
    );
    if (!r.rows?.[0]) throw new Error('Member run was not found.');
    return mapMember(r.rows[0]);
  }
}
function ownerValues(o: OwnerScope): string[] {
  return [o.tenantId, o.workspaceId, o.principalType, o.principalId];
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
    executionMode: r.execution_mode,
    controlState: r.control_state,
    revision: r.revision,
    leadTurnCount: r.lead_turn_count,
    stopReason: r.stop_reason,
    completionRequestedByRunId: r.completion_requested_by_run_id,
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
