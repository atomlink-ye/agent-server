import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';

import {
  PRODUCTION_MUTATION_ARMS,
  PRODUCTION_MUTATION_EXPECTATIONS,
  applyProductionMutation,
  countTargetAssertions,
} from './c3-e8-production-mutation.mjs';
import { parseVitestSummary } from './c3-e8-browser-wrapper.mjs';

export const WINDOW_MARKER = 'c3_e8_mutation_window:';
export const OBSERVATION_MISSING_MARKER =
  'c3_e8_observation_missing:reason=request-ledger-incomplete';

function hashBytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function stripAnsi(value) {
  return value.replaceAll(/\u001b\[[0-?]*[ -/]*[@-~]/gu, '');
}

function rawText(result) {
  return `${result.stdout.toString('utf8')}\n${result.stderr.toString('utf8')}`;
}

export function parseWindowEvents(stdout, stderr) {
  const events = [];
  for (const [stream, bytes] of [['stdout', stdout], ['stderr', stderr]]) {
    const lines = stripAnsi(bytes.toString('utf8')).split(/\r?\n/u);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith(WINDOW_MARKER)) continue;
      const payload = trimmed.slice(WINDOW_MARKER.length);
      try {
        const event = JSON.parse(payload);
        if (!event || typeof event.event !== 'string' || !Number.isFinite(event.wallTime))
          return { events: [], error: 'malformed-event' };
        events.push({ ...event, stream });
      } catch {
        return { events: [], error: 'malformed-event' };
      }
    }
  }
  return { events, error: null };
}

function eventCount(events, name) {
  return events.filter(({ event }) => event === name).length;
}

function validateEvents(events) {
  const allowed = new Set([
    'target_started', 'target_failed', 'target_completed',
    'control_started', 'control_failed', 'control_completed',
  ]);
  if (events.some(({ event }) => !allowed.has(event))) return 'unknown-event';
  const exact = [
    'target_started', 'control_started',
  ];
  if (exact.some((name) => eventCount(events, name) !== 1)) return 'missing-or-duplicate-start';
  for (const role of ['target', 'control']) {
    const terminals = ['failed', 'completed']
      .map((suffix) => `${role}_${suffix}`)
      .filter((name) => eventCount(events, name) === 1);
    if (terminals.length !== 1) return 'missing-or-duplicate-terminal';
  }
  const targetStart = events.findIndex(({ event }) => event === 'target_started');
  const controlStart = events.findIndex(({ event }) => event === 'control_started');
  const targetTerminal = events.findIndex(({ event }) => event === 'target_failed' || event === 'target_completed');
  const controlTerminal = events.findIndex(({ event }) => event === 'control_failed' || event === 'control_completed');
  if (targetStart < 0 || targetTerminal <= targetStart || controlStart < 0 || controlTerminal <= controlStart)
    return 'event-order';
  return null;
}

export function evaluateMutationWindow({ arm, child, stdout, stderr, restoreEqual }) {
  if (!PRODUCTION_MUTATION_ARMS.includes(arm))
    return { process: 2, reason: 'unknown-arm', targetFailureCount: 0, summary: null, events: [] };
  const parsedEvents = parseWindowEvents(stdout, stderr);
  const eventError = parsedEvents.error ?? validateEvents(parsedEvents.events);
  const combined = rawText({ stdout, stderr });
  const summary = parseVitestSummary(combined);
  const summaryComplete = summary && summary.fileTotal === 1 && summary.testTotal === 2 &&
    summary.skipped === 0 && summary.todo === 0;
  const targetFailureCount = countTargetAssertions(arm, combined);
  const targetFailed = eventCount(parsedEvents.events, 'target_failed') === 1;
  const controlCompleted = eventCount(parsedEvents.events, 'control_completed') === 1;
  const observationMissing = (combined.match(new RegExp(OBSERVATION_MISSING_MARKER, 'gu')) ?? []).length === 1;
  const base = {
    process: 2,
    reason: eventError ?? 'incomplete-window',
    targetFailureCount,
    summary,
    events: parsedEvents.events,
  };
  if (!summaryComplete) return { ...base, reason: 'summary-incomplete' };
  if (!restoreEqual) return { ...base, reason: 'restore-uncertain' };
  if (eventError) return base;
  if (arm === 'never-settle') {
    if (observationMissing && targetFailed && controlCompleted && child.code !== 0)
      return { ...base, process: 2, reason: 'observation-missing' };
    return { ...base, process: 2, reason: 'incomplete-window' };
  }
  if (child.code === 1 && targetFailed && controlCompleted && targetFailureCount === 1)
    return { ...base, process: 1, reason: 'target-failed-control-completed' };
  return { ...base, reason: 'target-control-verdict-mismatch' };
}

function defaultRunCommand(cwd, evidenceDirectory) {
  const wrapper = resolve(dirname(new URL(import.meta.url).pathname), 'c3-e8-browser-wrapper.mjs');
  const result = spawnSync(process.execPath, [wrapper, '--evidence', evidenceDirectory], {
    cwd,
    encoding: null,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    code: result.status,
    signal: result.signal,
    spawnError: result.error ?? null,
    stdout: Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.alloc(0),
    stderr: Buffer.isBuffer(result.stderr) ? result.stderr : Buffer.alloc(0),
  };
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function runMutationWindow({
  sourcePath,
  arm,
  evidenceDirectory,
  cwd = process.cwd(),
  runCommand = defaultRunCommand,
}) {
  if (!sourcePath || !evidenceDirectory || !PRODUCTION_MUTATION_ARMS.includes(arm))
    return { process: 2, reason: 'usage' };
  mkdirSync(evidenceDirectory, { recursive: true });
  const sourceBefore = readFileSync(sourcePath);
  const sourceBeforeHash = hashBytes(sourceBefore);
  const events = [{ event: 'mutation_applied', wallTime: Date.now(), seq: 1 }];
  let child = {
    code: null,
    signal: null,
    spawnError: null,
    stdout: Buffer.alloc(0),
    stderr: Buffer.alloc(0),
  };
  let restoreEqual = false;
  let outcome;
  try {
    const mutated = Buffer.from(applyProductionMutation(sourceBefore.toString('utf8'), arm));
    writeFileSync(sourcePath, mutated);
    writeFileSync(resolve(evidenceDirectory, 'source.before'), sourceBefore);
    writeFileSync(resolve(evidenceDirectory, 'source.mutated'), mutated);
    writeFileSync(resolve(evidenceDirectory, 'source.before.sha256'), `${sourceBeforeHash}\n`);
    writeFileSync(resolve(evidenceDirectory, 'source.mutated.sha256'), `${hashBytes(mutated)}\n`);
    child = runCommand(cwd, resolve(evidenceDirectory, 'browser'));
    writeFileSync(resolve(evidenceDirectory, 'raw.stdout'), child.stdout);
    writeFileSync(resolve(evidenceDirectory, 'raw.stderr'), child.stderr);
    writeFileSync(resolve(evidenceDirectory, 'raw.exit'), `${child.code ?? 2}\n`);
    const parsed = parseWindowEvents(child.stdout, child.stderr);
    let nextSeq = 2;
    for (const event of parsed.events) events.push({ ...event, seq: nextSeq++ });
    outcome = evaluateMutationWindow({
      arm,
      child,
      stdout: child.stdout,
      stderr: child.stderr,
      restoreEqual: false,
    });
  } catch (error) {
    outcome = { process: 2, reason: `runner-error:${error instanceof Error ? error.message : String(error)}` };
  } finally {
    events.push({ event: 'restore_started', wallTime: Date.now(), seq: events.length + 1 });
    try {
      writeFileSync(sourcePath, sourceBefore);
      restoreEqual = readFileSync(sourcePath).equals(sourceBefore);
    } catch {
      restoreEqual = false;
    }
    if (restoreEqual) events.push({ event: 'restore_completed', wallTime: Date.now(), seq: events.length + 1 });
    writeFileSync(resolve(evidenceDirectory, 'source.restored.sha256'), `${hashBytes(readFileSync(sourcePath))}\n`);
    writeJson(resolve(evidenceDirectory, 'events.json'), events);
  }
  if (!restoreEqual) outcome = { ...(outcome ?? {}), process: 2, reason: 'restore-uncertain' };
  else if (outcome?.reason === 'restore-uncertain')
    outcome = evaluateMutationWindow({ arm, child, stdout: child.stdout, stderr: child.stderr, restoreEqual: true });
  writeJson(resolve(evidenceDirectory, 'outcome.json'), { ...outcome, restoreEqual, sourceBeforeHash });
  return { ...outcome, restoreEqual, sourceBeforeHash };
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const [sourcePath, arm, evidenceFlag, evidenceDirectory] = process.argv.slice(2);
  if (evidenceFlag !== '--evidence' || !sourcePath || !arm || !evidenceDirectory) {
    process.stderr.write('usage: node c3-e8-mutation-window-runner.mjs <source> <arm> --evidence <dir>\n');
    process.exitCode = 2;
  } else {
    const outcome = runMutationWindow({ sourcePath, arm, evidenceDirectory });
    process.stdout.write(`${WINDOW_MARKER}${JSON.stringify({ outcome: outcome.process, reason: outcome.reason })}\n`);
    process.exitCode = outcome.process;
  }
}
