#!/usr/bin/env node

import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const KINDS = [
  'observed_message',
  'declared_dependency',
  'assignment',
  'feedback',
];

function tuple(...parts) {
  if (parts.some((part) => part === undefined || part === null || part === ''))
    throw new Error('recording_key_field_missing');
  return JSON.stringify(parts);
}

function exactSet(sourceKeys, responseKeys) {
  const source = frequencies(sourceKeys);
  const response = frequencies(responseKeys);
  return {
    missing: countDifference(source, response),
    extra: countDifference(response, source),
  };
}

function frequencies(keys) {
  const counts = new Map();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  return counts;
}

function countDifference(left, right) {
  return [...left]
    .flatMap(([key, count]) =>
      Array(Math.max(0, count - (right.get(key) ?? 0))).fill(key),
    )
    .sort();
}

function eventKey(row) {
  return tuple(row.run_id ?? row.source_refs?.run_id, row.sequence);
}

function messageKey(row) {
  return tuple(
    row.team_message_id ?? row.id ?? row.source_refs?.team_message_id,
    row.sequence,
  );
}

function dependencyKey(row) {
  return tuple(
    row.team_run_id ?? row.source_refs?.team_run_id,
    row.work_item_id ?? row.dependent_work_item_id,
    row.depends_on_work_item_id ?? row.prerequisite_work_item_id,
  );
}

function attemptKey(row) {
  return tuple(
    row.team_run_id ?? row.source_refs?.team_run_id,
    row.requested_by_lead_task_id ?? row.source_refs?.task_id,
    row.id ?? row.attempt_id,
  );
}

function hasFeedback(row) {
  if ('feedback_present' in row) return row.feedback_present === true;
  return row.feedback !== null && row.feedback !== undefined;
}

/**
 * Compare a normalized recording without trusting response-derived source data.
 * A future loader must independently populate `sources` from sanitized SQL rows.
 */
export function compareTraceEdgeEvidence(recording) {
  const trace = recording?.response?.trace;
  const sources = recording?.sources;
  if (!trace || !Array.isArray(trace.events) || !Array.isArray(trace.edges))
    throw new Error('recording_trace_missing');
  if (
    !sources ||
    !Array.isArray(sources.run_events) ||
    !Array.isArray(sources.team_messages) ||
    !Array.isArray(sources.dependencies) ||
    !Array.isArray(sources.attempts)
  )
    throw new Error('recording_independent_sources_missing');

  const edges = Object.fromEntries(
    KINDS.map((kind) => [
      kind,
      trace.edges.filter((edge) => edge.kind === kind),
    ]),
  );
  const diffs = {
    events: exactSet(
      sources.run_events.map(eventKey),
      trace.events.map(eventKey),
    ),
    observed_message: exactSet(
      sources.team_messages.map(messageKey),
      edges.observed_message.map(messageKey),
    ),
    declared_dependency: exactSet(
      sources.dependencies.map(dependencyKey),
      edges.declared_dependency.map(dependencyKey),
    ),
    assignment: exactSet(
      sources.attempts.map(attemptKey),
      edges.assignment.map(attemptKey),
    ),
    feedback: exactSet(
      sources.attempts.filter(hasFeedback).map(attemptKey),
      edges.feedback.map(attemptKey),
    ),
  };

  const sequenceWithoutSourceOrder = trace.edges.filter(
    (edge) =>
      (edge.kind === 'observed_message' &&
        (!Number.isInteger(edge.sequence) || !edge.source_refs?.team_run_id)) ||
      (edge.kind !== 'observed_message' && 'sequence' in edge),
  ).length;
  const hashes = recording.projection_hashes;
  const stableProjectionHash =
    Array.isArray(hashes) &&
    hashes.length >= 2 &&
    hashes.every((hash) => hash === hashes[0]);
  const eventPagesWithoutGapOrDuplicate = validateEventPages(
    recording.event_pages,
  );

  return {
    diffs,
    sequenceWithoutSourceOrder,
    stableProjectionHash,
    eventPagesWithoutGapOrDuplicate,
  };
}

function validateEventPages(pages) {
  if (!Array.isArray(pages) || pages.length === 0) return false;
  const lastByRun = new Map();
  const pageCountByRun = new Map();
  for (const page of pages) {
    const runId = page.run_id;
    const after = page.requested_after;
    const sequences = page.returned_sequences;
    if (!runId || !Number.isInteger(after) || !Array.isArray(sequences))
      return false;
    if ((lastByRun.get(runId) ?? 0) !== after) return false;
    for (let index = 0; index < sequences.length; index += 1) {
      if (
        !Number.isInteger(sequences[index]) ||
        sequences[index] <= after ||
        (index > 0 && sequences[index] <= sequences[index - 1])
      )
        return false;
    }
    const returnedLast = sequences.at(-1) ?? after;
    if (page.next_cursor !== null && page.next_cursor !== returnedLast)
      return false;
    lastByRun.set(runId, returnedLast);
    pageCountByRun.set(runId, (pageCountByRun.get(runId) ?? 0) + 1);
  }
  return [...pageCountByRun.values()].some((count) => count >= 2);
}

export function printTraceEdgeEvidence(result, write = console.log) {
  for (const name of ['events', ...KINDS]) {
    const diff = result.diffs[name];
    write(`${name} missing=${diff.missing.length} extra=${diff.extra.length}`);
  }
  write(`sequence_without_source_order=${result.sequenceWithoutSourceOrder}`);
  write(`stable_projection_hash=${result.stableProjectionHash}`);
  write(
    `event_pages_without_gap_or_duplicate=${result.eventPagesWithoutGapOrDuplicate}`,
  );
}

async function loadRecording(_recordingDirectory) {
  // TODO(S0 recording manifest): connect the independently sanitized SQL source
  // rows and canonical trace response once the cross-round manifest is fixed.
  return null;
}

async function main(argv) {
  const suppliedPath = argv[2];
  const recordingPath = resolve(suppliedPath ?? '');
  let entry;
  try {
    entry = suppliedPath ? await stat(recordingPath) : null;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (!entry?.isDirectory()) {
    console.error(`missing_recording=${suppliedPath ?? recordingPath}`);
    return 2;
  }

  const recording = await loadRecording(recordingPath);
  if (!recording) {
    console.error('loader_not_connected=true');
    return 3;
  }

  const result = compareTraceEdgeEvidence(recording);
  printTraceEdgeEvidence(result);
  return Object.values(result.diffs).every(
    (diff) => diff.missing.length === 0 && diff.extra.length === 0,
  ) &&
    result.sequenceWithoutSourceOrder === 0 &&
    result.stableProjectionHash &&
    result.eventPagesWithoutGapOrDuplicate
    ? 0
    : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv)
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(
        `checker_error=${error instanceof Error ? error.message : String(error)}`,
      );
      process.exitCode = 1;
    });
}
