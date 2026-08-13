#!/usr/bin/env node

// S2 canonical identity smoke.  S4 does not expose an accepted Product Work
// route yet, so this verifier builds the identity-only response shape from the
// immutable S0 recording rows.  It deliberately never writes to the
// recording (or to a fixture directory).
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { register as registerTsx, tsImport } from 'tsx/esm/api';

// The smoke is still a plain `.mjs` entry point, but the application mapper
// and contract are TypeScript modules.  Registering tsx here keeps this exact
// `node scripts/...mjs` command while exercising the real application code.
registerTsx();

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const REQUIRED = Object.freeze([
  'manifest.json',
  'api/trace.json',
  'db/team_runs.json',
  'db/team_work_items.json',
  'db/team_work_item_attempts.json',
  'db/team_messages.json',
  'db/run_events.json',
]);

const state = {
  recording: null,
  root_task_id: null,
  team_run_ids: [],
  run_ids: [],
  counts: {
    team_runs: 0,
    work_items: 0,
    attempts: 0,
    messages: 0,
    direct_messages: 0,
    actors: 0,
  },
};

function fail(code, detail = '') {
  const error = detail ? `${code}:${detail}` : code;
  const payload = {
    phase: 'canonical-ids',
    valid: false,
    error,
    recording: state.recording,
    root_task_id: state.root_task_id,
    team_run_ids: state.team_run_ids,
    run_ids: state.run_ids,
    counts: state.counts,
  };
  process.stderr.write(`${JSON.stringify(payload)}\n`);
  process.exitCode = 1;
  throw new Error(error);
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function assert(condition, code, detail = '') {
  if (!condition) fail(code, detail);
}

function parseJson(text, file) {
  try {
    return JSON.parse(text);
  } catch {
    fail('invalid_json', file);
  }
}

function rows(value, file) {
  assert(Array.isArray(value), 'rows_must_be_array', file);
  return value;
}

function uuid(value, label) {
  assert(typeof value === 'string' && UUID.test(value), 'invalid_uuid', label);
  return value;
}

function unique(values, label) {
  assert(new Set(values).size === values.length, 'duplicate_id', label);
}

async function readRecording(directory) {
  const root = resolve(directory);
  state.recording = root;
  try {
    await access(root);
  } catch {
    fail('recording_not_found', root);
  }
  const output = {};
  for (const file of REQUIRED) {
    try {
      output[file] = parseJson(await readFile(`${root}/${file}`, 'utf8'), file);
    } catch (error) {
      if (error?.code === 'ENOENT') fail('recording_file_missing', file);
      throw error;
    }
  }
  return output;
}

function traceProject(trace) {
  return trace?.project?.project ?? trace?.project ?? null;
}

function traceSessions(trace) {
  const project = traceProject(trace);
  return Array.isArray(project?.sessions)
    ? project.sessions
    : Array.isArray(trace?.project?.sessions)
      ? trace.project.sessions
      : [];
}

function traceRunIds(trace, events) {
  const ids = new Set();
  for (const row of events) if (row?.run_id) ids.add(row.run_id);
  for (const session of traceSessions(trace)) {
    for (const turn of Array.isArray(session?.turns) ? session.turns : []) {
      if (turn?.run_id) ids.add(turn.run_id);
    }
  }
  for (const id of ids) uuid(id, 'run_id');
  return [...ids].sort();
}

function sourceRefs(rootTaskId, teamRunId, extra = {}) {
  const refs = { rootTaskId, teamRunId };
  if (extra.teamMemberRunId) refs.teamMemberRunId = extra.teamMemberRunId;
  if (extra.taskId) refs.taskId = extra.taskId;
  if (extra.runId) refs.runId = extra.runId;
  if (extra.teamMessageId) refs.teamMessageId = extra.teamMessageId;
  return refs;
}

async function buildIdentity({
  manifest,
  trace,
  teamRuns,
  workRows,
  attemptRows,
  messageRows,
  mapper,
}) {
  const teamIds = new Set(teamRuns.map((row) => row.id));
  const workById = new Map(workRows.map((row) => [row.id, row]));
  const attemptsByWork = new Map();
  for (const attempt of attemptRows) {
    const bucket = attemptsByWork.get(attempt.work_item_id) ?? [];
    bucket.push(attempt);
    attemptsByWork.set(attempt.work_item_id, bucket);
  }
  const dependencyIds = new Map();
  // S0 captures no dependency table.  Keep the product field explicit and
  // empty; the identity check must not invent relationships.
  const facts = {
    rootTaskId: manifest.root_task_id,
    workItems: workRows.map((item) => ({
      id: uuid(item.id, 'work_item.id'),
      subject: typeof item.subject === 'string' ? item.subject : '',
      description: item.description ?? null,
      status: item.status,
      actorId: item.owner_member_id
        ? uuid(item.owner_member_id, 'work_item.owner_member_id')
        : null,
      attempts: (attemptsByWork.get(item.id) ?? []).map((attempt) => ({
        id: uuid(attempt.id, 'attempt.id'),
        workItemId: item.id,
        attemptNo: Number(attempt.attempt_no),
        status: attempt.status,
        feedbackCapture: attempt.feedback ? 'present' : 'absent',
        resultCapture: attempt.result_summary ? 'present' : 'absent',
        sourceRefs: sourceRefs(
          manifest.root_task_id,
          item.team_run_id,
          attempt.execution_task_id
            ? {
                taskId: uuid(
                  attempt.execution_task_id,
                  'attempt.execution_task_id',
                ),
              }
            : {},
        ),
      })),
      sourceRefs: sourceRefs(manifest.root_task_id, item.team_run_id),
    })),
    dependencies: [],
    actors: [],
    messages: [],
  };

  const memberNames = new Map();
  for (const session of traceSessions(trace)) {
    if (session?.team_member_run_id)
      memberNames.set(session.team_member_run_id, session.name ?? null);
  }
  const memberIds = new Set();
  for (const item of workRows) {
    for (const key of ['owner_member_id', 'created_by_member_id'])
      if (item[key]) memberIds.add(item[key]);
  }
  for (const attempt of attemptRows)
    if (attempt.assignee_member_id) memberIds.add(attempt.assignee_member_id);
  for (const message of messageRows) {
    if (message.sender_member_run_id)
      memberIds.add(message.sender_member_run_id);
    if (message.recipient_member_run_id)
      memberIds.add(message.recipient_member_run_id);
  }
  for (const session of traceSessions(trace))
    if (session?.team_member_run_id) memberIds.add(session.team_member_run_id);
  facts.actors = [...memberIds].sort().map((id) => ({
    id: uuid(id, 'actor.id'),
    name: memberNames.get(id) ?? null,
    sourceRefs: sourceRefs(manifest.root_task_id, teamRuns[0].id, {
      teamMemberRunId: id,
    }),
  }));

  const directRows = messageRows.filter(
    (row) =>
      row.kind === 'direct' && ['delivered', 'read'].includes(row.status),
  );
  facts.messages = directRows.map((message) => ({
    id: uuid(message.id, 'message.id'),
    senderId: message.sender_member_run_id
      ? uuid(message.sender_member_run_id, 'message.sender_member_run_id')
      : null,
    recipientId: uuid(
      message.recipient_member_run_id,
      'message.recipient_member_run_id',
    ),
    senderName: memberNames.get(message.sender_member_run_id) ?? null,
    recipientName: memberNames.get(message.recipient_member_run_id) ?? null,
    bodyCapture: message.body ? 'present' : 'absent',
    sourceRefs: sourceRefs(manifest.root_task_id, message.team_run_id, {
      teamMessageId: message.id,
    }),
  }));
  const product = await mapper(facts);
  return { ...product, workById, attemptsByWork, memberIds, directRows };
}

async function verify(
  manifest,
  trace,
  teamRuns,
  workRows,
  attemptRows,
  messageRows,
  eventRows,
  mapper,
  schema,
) {
  assert(
    manifest?.format_version === 'product-projection-recording/v1',
    'manifest_format_invalid',
  );
  assert(manifest?.mode === 'pre-identity', 'manifest_mode_invalid');
  assert(manifest?.provider_run === 'real', 'provider_run_not_real');
  assert(manifest?.scenario_definition === true, 'scenario_definition_invalid');
  assert(
    manifest?.work_id?.capture_status === 'not_applicable',
    'work_id_capture_status_invalid',
  );
  assert(
    manifest?.work_run_id?.capture_status === 'not_applicable',
    'work_run_id_capture_status_invalid',
  );
  uuid(manifest.root_task_id, 'manifest.root_task_id');
  state.root_task_id = manifest.root_task_id;

  assert(teamRuns.length > 0, 'team_runs_missing');
  for (const row of teamRuns) {
    uuid(row.id, 'team_runs.id');
    assert(
      row.root_task_id === manifest.root_task_id,
      'team_run_root_task_mismatch',
    );
  }
  state.team_run_ids = teamRuns.map((row) => row.id);
  unique(state.team_run_ids, 'team_run.id');
  for (const row of workRows) {
    uuid(row.id, 'team_work_items.id');
    assert(
      teamRuns.some((team) => team.id === row.team_run_id),
      'work_item_team_run_missing',
    );
  }
  unique(
    workRows.map((row) => row.id),
    'work_item.id',
  );
  for (const row of attemptRows) {
    uuid(row.id, 'team_work_item_attempts.id');
    assert(
      workRows.some((work) => work.id === row.work_item_id),
      'attempt_work_item_missing',
    );
  }
  unique(
    attemptRows.map((row) => row.id),
    'attempt.id',
  );
  for (const row of messageRows) {
    uuid(row.id, 'team_messages.id');
    assert(
      teamRuns.some((team) => team.id === row.team_run_id),
      'message_team_run_missing',
    );
  }
  unique(
    messageRows.map((row) => row.id),
    'message.id',
  );

  const project = traceProject(trace);
  assert(trace && typeof trace === 'object', 'api_trace_invalid');
  if (trace.task?.root_task_id !== undefined)
    assert(
      trace.task.root_task_id === manifest.root_task_id,
      'trace_task_root_task_mismatch',
    );
  if (trace.tree?.root_task_id !== undefined)
    assert(
      trace.tree.root_task_id === manifest.root_task_id,
      'trace_tree_root_task_mismatch',
    );
  if (project) {
    assert(
      project.root_task_id === undefined ||
        project.root_task_id === manifest.root_task_id,
      'trace_root_task_mismatch',
    );
    assert(
      project.team_run_id === undefined ||
        state.team_run_ids.includes(project.team_run_id),
      'trace_team_run_mismatch',
    );
  }
  state.run_ids = traceRunIds(trace, eventRows);
  const identity = await buildIdentity({
    manifest,
    trace,
    teamRuns,
    workRows,
    attemptRows,
    messageRows,
    mapper,
  });
  const parsedIdentity = schema.parse({
    work_items: identity.work_items,
    actors: identity.actors,
    messages: identity.messages,
  });
  for (const item of identity.work_items) {
    assert(typeof item.subject === 'string', 'work_item_subject_invalid');
    assert(
      item.description === null || typeof item.description === 'string',
      'work_item_description_invalid',
    );
    assert(
      [
        'pending',
        'in_progress',
        'completed',
        'blocked',
        'cancelled',
        'open',
        'accepted',
      ].includes(item.status),
      'work_item_status_invalid',
    );
    for (const attempt of item.attempts) {
      assert(
        Number.isInteger(attempt.attempt_no) && attempt.attempt_no > 0,
        'attempt_no_invalid',
      );
      assert(
        ['queued', 'running', 'completed', 'failed'].includes(attempt.status),
        'attempt_status_invalid',
      );
    }
  }
  // Every product id is reverse-checkable against its captured DB table.
  assert(
    identity.work_items.every((item) => identity.workById.has(item.id)),
    'work_item_reverse_lookup_failed',
  );
  assert(
    identity.work_items.every((item) =>
      item.attempts.every((attempt) =>
        (identity.attemptsByWork.get(item.id) ?? []).some(
          (row) => row.id === attempt.id,
        ),
      ),
    ),
    'attempt_reverse_lookup_failed',
  );
  assert(
    identity.actors.every((actor) => identity.memberIds.has(actor.id)),
    'actor_reverse_lookup_failed',
  );
  assert(
    identity.messages.every((message) =>
      identity.directRows.some((row) => row.id === message.id),
    ),
    'message_reverse_lookup_failed',
  );
  assert(
    identity.messages.length === identity.directRows.length,
    'direct_message_count_mismatch',
  );
  const nullAttempts = attemptRows.filter(
    (row) =>
      row.execution_task_id === null || row.execution_task_id === undefined,
  );
  assert(nullAttempts.length > 0, 'null_execution_task_attempt_missing');
  for (const item of identity.work_items)
    for (const attempt of item.attempts) {
      const row = attemptRows.find((candidate) => candidate.id === attempt.id);
      if (row.execution_task_id === null || row.execution_task_id === undefined)
        assert(
          !('task_id' in attempt.source_refs),
          'null_attempt_task_ref_present',
        );
    }
  state.counts = {
    team_runs: teamRuns.length,
    work_items: workRows.length,
    attempts: attemptRows.length,
    messages: messageRows.length,
    direct_messages: identity.directRows.length,
    actors: identity.actors.length,
  };
  state.run_ids = traceRunIds(trace, eventRows);
  return { ...identity, ...parsedIdentity };
}

async function main() {
  assert(
    option('--phase') === 'canonical-ids',
    'phase_required',
    'canonical-ids',
  );
  const recording =
    option('--recording') ?? process.env.PRODUCT_PROJECTION_RECORDING;
  assert(
    recording,
    'recording_required',
    'use --recording <dir> or PRODUCT_PROJECTION_RECORDING',
  );
  const values = await readRecording(recording);
  const teamRuns = rows(values['db/team_runs.json'], 'db/team_runs.json');
  const workRows = rows(
    values['db/team_work_items.json'],
    'db/team_work_items.json',
  );
  const attemptRows = rows(
    values['db/team_work_item_attempts.json'],
    'db/team_work_item_attempts.json',
  );
  const messageRows = rows(
    values['db/team_messages.json'],
    'db/team_messages.json',
  );
  const eventRows = rows(values['db/run_events.json'], 'db/run_events.json');
  state.counts = {
    ...state.counts,
    team_runs: teamRuns.length,
    work_items: workRows.length,
    attempts: attemptRows.length,
    messages: messageRows.length,
  };
  const applicationModule = await tsImport(
    resolve(
      'src/application/product-projection/work-projection-facts-source.ts',
    ),
    import.meta.url,
  );
  const contractModule = await tsImport(
    resolve('src/contracts/product-projection/identity.ts'),
    import.meta.url,
  );
  const mapper = async (facts) => {
    return applicationModule.mapWorkProjectionFacts(facts);
  };
  const identity = await verify(
    values.manifest,
    values['api/trace.json'],
    teamRuns,
    workRows,
    attemptRows,
    messageRows,
    eventRows,
    mapper,
    contractModule.ProductProjectionIdentitySchema,
  );
  process.stdout.write(
    `${JSON.stringify({
      phase: 'canonical-ids',
      valid: true,
      projection_source: 'application-mapper+zod-schema',
      recording: state.recording,
      root_task_id: state.root_task_id,
      team_run_ids: state.team_run_ids,
      run_ids: state.run_ids,
      counts: state.counts,
      projection: {
        work_items: identity.work_items.length,
        attempts: identity.work_items.reduce(
          (count, item) => count + item.attempts.length,
          0,
        ),
        actors: identity.actors.length,
        messages: identity.messages.length,
      },
    })}\n`,
  );
}

main().catch(() => {
  if (process.exitCode !== 1) process.exitCode = 1;
});
