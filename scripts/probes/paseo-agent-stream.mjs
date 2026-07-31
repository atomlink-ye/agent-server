import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DaemonClient } from '@getpaseo/client';

import {
  getAvailablePort,
  startPaseo,
  stopProcessTree,
} from '../dev/paseo-process.mjs';

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const runRoot = join(
  repositoryRoot,
  '.local',
  'probe',
  `${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${process.pid}`,
);
const projectCwd = join(runRoot, 'project');
const marker = 'PASEO_STREAM_PROBE_MARKER_V1';
const requestedModel = process.env.PASEO_SMOKE_MODEL?.trim();
const streamRecords = [];
let paseo;
let client;
let unsubscribe;
let agentId = null;
let timeline;
let finished;
let listenerInstalled = false;
let firstMessagePending = false;
let stage = 'setup';

try {
  if (requestedModel && !isFreeModelId(requestedModel)) {
    throw new Error('invalid_free_model');
  }
  stage = 'paseo';
  await mkdir(projectCwd, { recursive: true });
  paseo = await startPaseo({
    repositoryRoot,
    runtimeRoot: runRoot,
    port: await getAvailablePort(),
  });
  client = new DaemonClient({
    url: paseo.wsUrl,
    clientId: `agent-server-stream-probe-${process.pid}`,
    clientType: 'cli',
    appVersion: 'agent-server-paseo-stream-probe/1',
    connectTimeoutMs: 10_000,
    reconnect: { enabled: false },
  });
  await client.connect();

  // Install the global listener before creating an agent.
  unsubscribe = client.on('agent_stream', (message) => {
    const payload = message.payload;
    const event = payload.event;
    streamRecords.push({
      agentId: payload.agentId,
      event: event.type,
      timestamp: payload.timestamp,
      seq: payload.seq ?? null,
      epoch: payload.epoch ?? null,
      duringFirstMessage:
        firstMessagePending &&
        listenerInstalled &&
        agentId !== null &&
        payload.agentId === agentId,
      timelineItemType: event.type === 'timeline' ? event.item.type : null,
      assistantMarker:
        event.type === 'timeline' &&
        event.item.type === 'assistant_message' &&
        event.item.text === marker,
      terminalType: terminalType(event),
    });
  });
  listenerInstalled = true;

  stage = 'workspace';
  const workspace = await client.openProject(projectCwd);
  if (!workspace.workspace?.id) throw new Error('workspace_unavailable');
  const models = await client.listProviderModels('opencode', {
    cwd: projectCwd,
  });
  const model = selectFreeModel(models.models ?? [], requestedModel);
  const systemPrompt = 'You are a probe agent. Do not use tools.';
  const prompt = `Reply with exactly this stable marker and no other text: ${marker}`;
  if (systemPrompt.includes(marker) || prompt.length === 0) {
    throw new Error('probe_prompt_invalid');
  }
  stage = 'create_without_prompt';
  const agent = await client.createAgent({
    provider: 'opencode',
    model: model.id,
    modeId: 'build',
    cwd: projectCwd,
    workspaceId: workspace.workspace.id,
    systemPrompt,
    labels: { source: 'agent-server-paseo-stream-probe' },
  });
  agentId = agent.id;
  if (!listenerInstalled || !agentId) {
    throw new Error('listener_agent_binding_unverified');
  }

  stage = 'send_first_message';
  firstMessagePending = true;
  await client.sendAgentMessage(agentId, prompt);

  stage = 'finish';
  finished = await client.waitForFinish(agentId, 150_000);
  firstMessagePending = false;
  timeline = await client.fetchAgentTimeline(agentId, {
    direction: 'tail',
    limit: 100,
    projection: 'projected',
  });

  const timelineEntries = timeline.entries ?? [];
  const timelineTypes = timelineEntries.map((entry) => entry.item.type);
  const timelineMarker = timelineEntries.some(
    (entry) =>
      entry.item.type === 'assistant_message' && entry.item.text === marker,
  );
  const firstMessageCandidates = streamRecords.filter(
    (record) =>
      record.duringFirstMessage &&
      record.agentId === agentId &&
      record.event === 'timeline' &&
      record.seq !== null &&
      record.epoch !== null,
  );
  const catchUp = firstMessageCandidates.some(
    (candidate) =>
      candidate.epoch === timeline.epoch &&
      timelineEntries.some(
        (entry) =>
          Number.isInteger(entry.seqStart) &&
          Number.isInteger(entry.seqEnd) &&
          entry.seqStart <= candidate.seq &&
          candidate.seq <= entry.seqEnd,
      ),
  );
  const firstMessageCatchUpStatus = firstMessageCandidates.length
    ? catchUp
      ? 'verified'
      : 'mismatch'
    : 'unverified_no_candidate';
  const observed = {
    turnStarted: streamRecords.some(
      (record) => record.event === 'turn_started',
    ),
    assistantStream: streamRecords.some(
      (record) =>
        record.event === 'timeline' &&
        record.timelineItemType === 'assistant_message',
    ),
    terminal: streamRecords.some((record) => record.terminalType !== null),
    timelineCatchUp: catchUp,
    listenerInstalled,
    agentKnownBeforeSend: agentId !== null,
    firstMessageEventObserved: firstMessageCandidates.length > 0,
    firstMessageCatchUpVerified: firstMessageCatchUpStatus === 'verified',
    finalMarker:
      finished.status === 'idle' && finished.lastMessage?.trim() === marker,
    timelineMarker,
    agentIdsMatch: streamRecords.every((record) => record.agentId === agentId),
    seqEpochSufficient: streamRecords
      .filter((record) => record.event === 'timeline')
      .every((record) => record.seq !== null && record.epoch !== null),
  };
  if (firstMessageCatchUpStatus === 'mismatch') {
    const reconciliationError = new Error(
      'stream_timeline_reconciliation_failed',
    );
    reconciliationError.diagnostic = {
      observed,
      stream: streamRecords.map(safeStreamRecord),
      timeline: {
        entryTypes: timelineTypes,
        epoch: timeline.epoch,
        startCursor: safeCursor(timeline.startCursor),
        endCursor: safeCursor(timeline.endCursor),
        window: safeWindow(timeline.window),
        entryCount: timelineEntries.length,
      },
      firstMessageCandidateCount: firstMessageCandidates.length,
    };
    throw reconciliationError;
  }
  if (
    Object.entries(observed).some(
      ([key, value]) =>
        ![
          'timelineCatchUp',
          'firstMessageEventObserved',
          'firstMessageCatchUpVerified',
        ].includes(key) && value !== true,
    )
  ) {
    const reconciliationError = new Error(
      'stream_timeline_reconciliation_failed',
    );
    reconciliationError.diagnostic = { observed };
    throw reconciliationError;
  }

  process.stdout.write(
    `${JSON.stringify({
      outcome:
        firstMessageCatchUpStatus === 'verified'
          ? 'DONE'
          : 'DONE_WITH_CONCERNS',
      paseoVersion: '0.1.110',
      opencodeVersion: '1.18.4',
      model: model.id,
      agentId,
      observed,
      firstMessageCatchUpStatus,
      blocksSlice1B: firstMessageCatchUpStatus !== 'verified',
      stream: streamRecords.map(safeStreamRecord),
      timeline: {
        entryTypes: timelineTypes,
        epoch: timeline.epoch,
        startCursor: safeCursor(timeline.startCursor),
        endCursor: safeCursor(timeline.endCursor),
        window: safeWindow(timeline.window),
        entryCount: timelineEntries.length,
      },
      terminalType:
        streamRecords.find((record) => record.terminalType)?.terminalType ??
        null,
    })}\n`,
  );
} catch (error) {
  if (stage === 'create_without_prompt') {
    process.stdout.write(
      `${JSON.stringify({
        outcome: 'BLOCKED',
        errorCode: 'create_without_prompt_rejected',
        schemeAConcern: true,
        observed: summarizeObserved(),
      })}\n`,
    );
    process.exitCode = 1;
  } else {
    const concern = isExternalAvailabilityError(error);
    process.stdout.write(
      `${JSON.stringify({
        outcome: concern ? 'DONE_WITH_CONCERNS' : 'BLOCKED',
        errorCode: safeErrorCode(error),
        observed: summarizeObserved(),
        ...(error?.diagnostic ? { diagnostic: error.diagnostic } : {}),
      })}\n`,
    );
    if (!concern) process.exitCode = 1;
  }
} finally {
  firstMessagePending = false;
  unsubscribe?.();
  await client?.close().catch(() => undefined);
  await stopProcessTree(paseo?.child).catch(() => undefined);
  await rm(runRoot, { recursive: true, force: true }).catch(() => undefined);
}

function selectFreeModel(models, requested) {
  const available = models.filter(
    (model) =>
      isFreeModelId(model.id) ||
      /\bfree\b/i.test(model.label ?? '') ||
      /\bfree\b/i.test(model.description ?? ''),
  );
  const selected = requested
    ? available.find((model) => model.id === requested)
    : available.toSorted((a, b) => a.id.localeCompare(b.id))[0];
  if (!selected) throw new Error('free_model_unavailable');
  return selected;
}

function isFreeModelId(id) {
  return /(?:^|[-/])free(?:$|-)/i.test(id);
}

function terminalType(event) {
  if (
    event.type === 'turn_completed' ||
    event.type === 'turn_failed' ||
    event.type === 'turn_canceled'
  )
    return event.type;
  if (event.type === 'attention_required')
    return event.reason === 'finished' ? 'attention_finished' : null;
  return null;
}

function safeStreamRecord(record) {
  return {
    agentId: record.agentId,
    event: record.event,
    timestamp: record.timestamp,
    timelineItemType: record.timelineItemType,
    seq: record.seq,
    epoch: record.epoch,
    duringFirstMessage: record.duringFirstMessage,
    terminalType: record.terminalType,
  };
}

function safeCursor(cursor) {
  return cursor ? { epoch: cursor.epoch, seq: cursor.seq } : null;
}

function safeWindow(window) {
  return window
    ? { minSeq: window.minSeq, maxSeq: window.maxSeq, nextSeq: window.nextSeq }
    : null;
}

function summarizeObserved() {
  return {
    turnStarted: streamRecords.some(
      (record) => record.event === 'turn_started',
    ),
    assistantStream: streamRecords.some(
      (record) => record.timelineItemType === 'assistant_message',
    ),
    terminal: streamRecords.some((record) => record.terminalType !== null),
    timelineFetched: timeline !== undefined,
    finalMarker: finished?.lastMessage?.trim() === marker,
    listenerInstalled,
    agentKnownBeforeSend: agentId !== null,
    firstMessageEventObserved: streamRecords.some(
      (record) => record.duringFirstMessage && record.seq !== null,
    ),
  };
}

function safeErrorCode(error) {
  return error?.code && /^[A-Za-z0-9_.-]+$/.test(error.code)
    ? error.code
    : error?.message && /^[A-Za-z0-9_.-]+$/.test(error.message)
      ? error.message
      : 'probe_failure';
}

function isExternalAvailabilityError(error) {
  return [
    'free_model_unavailable',
    'PASEO_CONNECTION_FAILED',
    'ETIMEDOUT',
    'ECONNRESET',
    'fetch failed',
  ].includes(safeErrorCode(error));
}
