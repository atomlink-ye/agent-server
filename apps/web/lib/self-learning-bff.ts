import 'server-only';

import { randomUUID } from 'node:crypto';
import {
  AgentServerError,
  getLearningProposal,
  listLearningProposals,
  getMemory,
  getSelfLearningConfig,
  getTask,
  getTaskTree,
  getTeamRunByTask,
  getTeamRunMembers,
  getTeamRunTasks,
  getRunEventsPage,
  invokeTeamVersion,
  reviewLearningProposal,
} from './agent-server-client';

export type BffErrorKind = 'not_found' | 'bad_gateway' | 'conflict';
export class BffError extends Error {
  constructor(
    readonly kind: BffErrorKind,
    readonly code?:
      'learning_proposal_not_pending' | 'memory_precondition_failed',
  ) {
    super(kind);
  }
}
export const MAX_LAUNCH_BODY_BYTES = 32;
export const MAX_REVIEW_BODY_BYTES = 16 * 1024;
export class BffRequestError extends Error {
  constructor(readonly status: 400 | 413) {
    super(status === 413 ? 'request_too_large' : 'invalid_json');
  }
}
export async function readBoundedJson(request: Request, maxBytes: number) {
  const declared = Number.parseInt(
    request.headers.get('content-length') ?? '',
    10,
  );
  if (Number.isFinite(declared) && declared > maxBytes)
    throw new BffRequestError(413);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new BffRequestError(413);
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new BffRequestError(400);
  }
}
const uuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v,
  );
const record = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v))
    throw new BffError('bad_gateway');
  return v as Record<string, unknown>;
};
const bounded = (v: unknown, max: number, nullable = false): string | null => {
  if (v === null && nullable) return null;
  if (typeof v !== 'string' || v.length > max)
    throw new BffError('bad_gateway');
  return v;
};
function truncateUtf8(v: unknown, max: number, nullable = false) {
  if (v === null && nullable) return { value: null, truncated: false };
  if (typeof v !== 'string') throw new BffError('bad_gateway');
  const bytes = new TextEncoder().encode(v);
  if (bytes.byteLength <= max) return { value: v, truncated: false };
  let end = max;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  return {
    value: new TextDecoder().decode(bytes.slice(0, end)),
    truncated: true,
  };
}
function config() {
  const c = getSelfLearningConfig();
  if (!uuid(c.workspaceId) || !uuid(c.teamVersionId) || !uuid(c.memoryStoreId))
    throw new AgentServerError(503, 'web_configuration_missing');
  return {
    workspaceId: c.workspaceId,
    teamVersionId: c.teamVersionId,
    memoryStoreId: c.memoryStoreId,
  };
}
export function validUuid(v: string) {
  return uuid(v);
}

export async function startLearning() {
  const c = config();
  const result = record(
    await invokeTeamVersion(
      c.workspaceId,
      c.teamVersionId,
      JSON.stringify({
        memory_store_id: c.memoryStoreId,
        memory_path: 'research/principles.md',
        fixture_ref: 'fixture://self-learning-market-research/acme-v1',
        symbol: 'ACME',
        data_as_of: '2026-07-31',
        synthetic: true,
      }),
      randomUUID(),
    ),
  );
  const id = result.task_id;
  if (!uuid(id)) throw new BffError('bad_gateway');
  return id;
}

export async function aggregate(rootTaskId: string) {
  const c = config();
  const root = record(await safeUpstream(() => getTask(rootTaskId)));
  if (
    root.task_id !== rootTaskId ||
    root.root_task_id !== rootTaskId ||
    !uuid(root.task_id) ||
    record(root.invokable).kind !== 'team' ||
    record(root.invokable).version_id !== c.teamVersionId
  )
    throw new BffError('not_found');
  const tree = record(await safeUpstream(() => getTaskTree(rootTaskId)));
  const rawTasks = array(tree.tasks, 32);
  const teamRunRaw = await safeUpstream(() => getTeamRunByTask(rootTaskId));
  const tasks = rawTasks.map(taskSummary);
  if (teamRunRaw === null) {
    return {
      root_task_id: rootTaskId,
      status: bounded(root.status, 64),
      tasks,
      team_run: null,
      members: [],
      work_items: [],
      report: null,
      activities: [],
      proposal: null,
      memory_receipt: null,
    };
  }
  const teamRun = record(teamRunRaw);
  if (
    teamRun.root_task_id !== rootTaskId ||
    teamRun.team_version_id !== c.teamVersionId ||
    !uuid(teamRun.id)
  )
    throw new BffError('not_found');
  const [membersRaw, workRaw] = await Promise.all([
    safeUpstream(() => getTeamRunMembers(teamRun.id as string)),
    safeUpstream(() => getTeamRunTasks(teamRun.id as string)),
  ]);
  const members = array(membersRaw, 8).map(memberSummary);
  const memberNames = new Map(
    array(membersRaw, 8).map((member) => {
      const value = record(member);
      return [mustUuid(value.id), bounded(value.name, 256) as string];
    }),
  );
  const workItems = array(workRaw, 8).map((item) =>
    workSummary(item, memberNames),
  );
  const activities = await activitiesForTasks(rawTasks);
  const proposal = await findProposal(
    c,
    teamRun.id as string,
    rootTaskId,
    rawTasks,
  );
  const publicActivities = activities.map((value) => {
    const { task_id, tool, status } = record(value);
    return { task_id, tool, status };
  });
  let memoryReceipt = null;
  if (proposal && proposal.status === 'accepted') {
    const memory = record(
      record(
        await safeUpstream(() =>
          getMemory(c.memoryStoreId, proposal.target_memory_id),
        ),
      ).memory,
    );
    if (
      memory.memory_store_id !== c.memoryStoreId ||
      memory.path !== proposal.target.path ||
      memory.memory_version_id !== proposal.accepted_memory_version_id
    )
      throw new BffError('bad_gateway');
    memoryReceipt = {
      path: bounded(memory.path, 512),
      version: positiveInt(memory.version),
      memory_version_id: mustUuid(memory.memory_version_id),
      content_sha256: sha(memory.content_sha256),
      content: truncateUtf8(memory.content, 65536).value,
    };
  }
  const publicProposal = proposal
    ? (({
        target_memory_id: _memoryId,
        target_memory_store_id: _storeId,
        ...value
      }) => value)(proposal)
    : null;
  return {
    root_task_id: rootTaskId,
    status: bounded(root.status, 64),
    tasks,
    team_run: {
      status: bounded(teamRun.status, 64),
      phase: bounded(teamRun.phase, 64),
    },
    members,
    work_items: workItems,
    report:
      teamRun.final_text !== null && teamRun.final_text !== undefined
        ? (() => {
            const report = truncateUtf8(teamRun.final_text, 8192);
            return { text: report.value, truncated: report.truncated };
          })()
        : null,
    activities: publicActivities,
    proposal: publicProposal,
    memory_receipt: memoryReceipt,
  };
}

async function findProposal(
  c: ReturnType<typeof config>,
  teamRunId: string,
  rootTaskId: string,
  rootTasks: unknown[],
) {
  const treeIds = new Set(
    rootTasks.map((task) => mustUuid(record(task).task_id)),
  );
  const listed = record(
    await safeUpstream(() => listLearningProposals(c.workspaceId)),
  );
  const proposals = array(listed.learning_proposals, 100);
  const candidates = proposals
    .map((value) => record(value))
    .filter((p) => {
      const source = record(p.source);
      return (
        p.workspace_id === c.workspaceId &&
        source.team_run_id === teamRunId &&
        c.memoryStoreId === record(p.target).memory_store_id &&
        record(p.target).path === 'research/principles.md' &&
        source.task_id !== rootTaskId &&
        treeIds.has(mustUuid(source.task_id))
      );
    });
  candidates.sort((a, b) =>
    String(a.learning_proposal_id).localeCompare(
      String(b.learning_proposal_id),
    ),
  );
  for (const p of candidates.slice(0, 32)) {
    const source = record(p.source);
    const sourceTask = record(
      await safeUpstream(() => getTask(mustUuid(source.task_id))),
    );
    const latest =
      sourceTask.latest_run === null ? null : record(sourceTask.latest_run);
    if (!latest || latest.run_id !== source.run_id) continue;
    if (sourceTask.root_task_id === rootTaskId) return proposalProjection(p);
  }
  return null;
}
function array(v: unknown, max: number) {
  if (!Array.isArray(v) || v.length > max) throw new BffError('bad_gateway');
  return v;
}
function taskSummary(v: unknown) {
  const x = record(v);
  return {
    task_id: mustUuid(x.task_id),
    parent_task_id: nullableUuid(x.parent_task_id),
    status: bounded(x.status, 64),
    latest_run_status: x.latest_run
      ? bounded(record(x.latest_run).status, 64)
      : null,
  };
}
function memberSummary(v: unknown) {
  const x = record(v);
  return {
    name: bounded(x.name, 256),
    role: bounded(x.role, 64),
    status: bounded(x.status, 64),
  };
}
function workSummary(v: unknown, memberNames: Map<string, string>) {
  const x = record(v);
  const summary = truncateUtf8(x.completion_summary, 4096, true);
  return {
    subject: bounded(x.subject, 512),
    status: bounded(x.status, 64),
    owner_name:
      x.owner_member_id === null
        ? null
        : (memberNames.get(mustUuid(x.owner_member_id)) ?? null),
    completion_summary: summary.value,
    truncated: summary.truncated,
  };
}
function projectActivities(v: unknown) {
  return array(v, 100).flatMap((e) => {
    const x = record(e);
    const p = record(x.payload ?? {});
    const tool = typeof p.tool_name === 'string' ? p.tool_name : '';
    const status =
      p.status === 'running'
        ? 'started'
        : typeof p.status === 'string'
          ? p.status
          : '';
    if (
      ![
        'synthetic_stock_snapshot',
        'synthetic_event_batch',
        'synthetic_analog_summary',
        'learning_proposal_create',
        'agent_server_memory_read',
      ].includes(tool) ||
      !['started', 'completed', 'failed'].includes(status) ||
      p.kind !== 'tool_status'
    )
      return [];
    return [
      {
        task_id: mustUuid(x.task_id),
        tool,
        status,
        ...(uuid(p.learning_proposal_id)
          ? { proposal_id: p.learning_proposal_id }
          : uuid(p.proposal_id)
            ? { proposal_id: p.proposal_id }
            : {}),
      },
    ];
  });
}
function proposalProjection(p: Record<string, unknown>) {
  const source = record(p.source),
    target = record(p.target);
  return {
    learning_proposal_id: mustUuid(p.learning_proposal_id),
    status: proposalStatus(p.status),
    source: {
      team_run_id: mustUuid(source.team_run_id),
      task_id: mustUuid(source.task_id),
      run_id: mustUuid(source.run_id),
    },
    target: {
      path: bounded(target.path, 512),
      base_content_sha256: sha(target.base_content_sha256),
    },
    proposed_content: truncateUtf8(p.proposed_content, 8192).value,
    evidence_refs: array(p.evidence_refs, 8).map((x) => bounded(x, 512)),
    accepted_memory_version_id:
      p.accepted_memory_version_id === null
        ? null
        : mustUuid(p.accepted_memory_version_id),
    target_memory_id: mustUuid(target.memory_id),
    target_memory_store_id: mustUuid(target.memory_store_id),
  };
}

async function activitiesForTasks(tasks: unknown[]) {
  const activities: unknown[] = [];
  for (const task of tasks) {
    const taskValue = record(task);
    const taskId = mustUuid(taskValue.task_id);
    const latest = taskValue.latest_run;
    if (latest === null) continue;
    const runId = mustUuid(record(latest).run_id);
    let after = 0;
    let pages = 0;
    while (activities.length < 100 && pages < 4) {
      pages++;
      const page = record(
        await safeUpstream(() => getRunEventsPage(runId, after)),
      );
      const pageEvents = array(page.events, 100);
      const projected = projectActivities(
        pageEvents.map((event) => ({ ...record(event), task_id: taskId })),
      );
      activities.push(...projected.slice(0, 100 - activities.length));
      if (page.next_cursor === null || pageEvents.length === 0) break;
      if (
        typeof page.next_cursor !== 'number' ||
        !Number.isSafeInteger(page.next_cursor) ||
        page.next_cursor <= after
      )
        throw new BffError('bad_gateway');
      after = page.next_cursor;
    }
    if (activities.length >= 100) break;
  }
  return activities;
}
function mustUuid(v: unknown): string {
  if (!uuid(v)) throw new BffError('bad_gateway');
  return v;
}
function sha(v: unknown): string {
  if (typeof v !== 'string' || !/^[0-9a-f]{64}$/.test(v))
    throw new BffError('bad_gateway');
  return v;
}
function proposalStatus(v: unknown): string {
  if (v === 'pending' || v === 'accepted' || v === 'rejected') return v;
  throw new BffError('bad_gateway');
}
function positiveInt(v: unknown): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1)
    throw new BffError('bad_gateway');
  return v;
}
function nullableUuid(v: unknown): string | null {
  return v === null ? null : mustUuid(v);
}
async function safeUpstream<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AgentServerError && e.status === 404)
      throw new BffError('not_found');
    throw new BffError('bad_gateway');
  }
}
export async function review(
  rootTaskId: string,
  proposalId: string,
  action: 'accept' | 'reject' | 'edit_and_accept',
  content?: string,
) {
  const aggregateResult = await aggregate(rootTaskId);
  if (
    !aggregateResult.proposal ||
    aggregateResult.proposal.learning_proposal_id !== proposalId
  )
    throw new BffError('not_found');
  try {
    const result = record(
      await reviewLearningProposal(proposalId, action, content),
    );
    const p = record(result.learning_proposal);
    return {
      proposal: {
        learning_proposal_id: mustUuid(p.learning_proposal_id),
        status: proposalStatus(p.status),
        accepted_memory_version_id:
          p.accepted_memory_version_id === null
            ? null
            : mustUuid(p.accepted_memory_version_id),
      },
    };
  } catch (e) {
    if (
      e instanceof AgentServerError &&
      e.status === 409 &&
      ['learning_proposal_not_pending', 'memory_precondition_failed'].includes(
        e.code,
      )
    )
      throw new BffError(
        'conflict',
        e.code as
          'learning_proposal_not_pending' | 'memory_precondition_failed',
      );
    if (e instanceof AgentServerError && e.status === 404)
      throw new BffError('not_found');
    throw new BffError('bad_gateway');
  }
}
