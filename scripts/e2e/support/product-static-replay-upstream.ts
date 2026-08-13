#!/usr/bin/env node

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  GetWorkResponseSchema,
  ProductRunTraceResponseSchema,
  ProductWorkRunResponseSchema,
  type ProductRunTrace,
  type ProductWorkRun,
  type WorkListResponse,
  type WorkResponse,
  type WorkRunListResponse,
} from '@atomlink-ye/agent-server/product-contract';

import {
  projectWorkList,
  projectWorkRunList,
  type ProductRecording,
} from '../../../apps/web/lib/product-recording-projections.js';

export const PASS = 0;
export const FAIL = 1;
export const MISSING = 2;

export const RECORDING_SCENARIOS = ['parallel-success', 'rework-once'] as const;
export type RecordingScenario = (typeof RECORDING_SCENARIOS)[number];
export type ReplayMutation = 'none' | 'omit-feedback' | 'constant-duration';

const defaultFixtureDirectory = resolve(
  fileURLToPath(new URL('../../../apps/web/lib/__fixtures__/product-recordings', import.meta.url)),
);

const recordingFiles: Record<RecordingScenario, string> = {
  'parallel-success': 'parallel-success-fa77ba9.json',
  'rework-once': 'rework-once-fa77ba9.json',
};

type RecordingEnvelope = ProductRecording & {
  readonly scenario?: string;
  readonly recording_documents: readonly unknown[];
};

type LoadedReplay = {
  readonly scenario: RecordingScenario;
  readonly sourcePath: string;
  readonly trace: Extract<ProductRunTrace, { projection_status: 'internally_anchored' }>;
  readonly work: WorkResponse;
  readonly workList: WorkListResponse;
  readonly runList: WorkRunListResponse;
  readonly run: Extract<ProductWorkRun, { projection_status: 'internally_anchored' }>;
};

export class ReplayMissingError extends Error {
  readonly code = 'MISSING';

  constructor(readonly reason: string, readonly details?: readonly string[]) {
    super(reason);
    this.name = 'ReplayMissingError';
  }
}

function isScenario(value: string | undefined): value is RecordingScenario {
  return (RECORDING_SCENARIOS as readonly string[]).includes(value ?? '');
}

function scenarioFromEnvironment(): RecordingScenario {
  const value = process.env.C4_REPLAY_SCENARIO ?? 'parallel-success';
  if (isScenario(value)) return value;
  throw new ReplayMissingError('invalid_replay_scenario', [value]);
}

function fixtureDirectory(): string {
  return resolve(process.env.C4_RECORDING_DIR ?? defaultFixtureDirectory);
}

function parseTraceDocument(
  scenario: RecordingScenario,
  document: unknown,
): Extract<ProductRunTrace, { projection_status: 'internally_anchored' }> {
  const parsed = ProductRunTraceResponseSchema.safeParse(document);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 8).map((issue) =>
      `${issue.path.join('.') || '<root>'}:${issue.message}`,
    );
    throw new ReplayMissingError(`recording_trace_schema_invalid:${scenario}`, issues);
  }
  if (parsed.data.projection_status !== 'internally_anchored') {
    throw new ReplayMissingError(`recording_trace_not_anchored:${scenario}`);
  }
  return parsed.data;
}

/**
 * Load one recorder only after the current complete trace contract accepts
 * recording_documents[0]. This is intentionally a hard prerequisite: the
 * old recorder shape must remain MISSING rather than being migrated here.
 */
export async function loadStaticReplayRecording(
  scenario: RecordingScenario = scenarioFromEnvironment(),
): Promise<LoadedReplay> {
  const sourcePath = resolve(fixtureDirectory(), recordingFiles[scenario]);
  let envelope: RecordingEnvelope;
  try {
    envelope = JSON.parse(await readFile(sourcePath, 'utf8')) as RecordingEnvelope;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ReplayMissingError(`recording_unreadable:${scenario}`, [detail]);
  }

  if (!Array.isArray(envelope.recording_documents) || envelope.recording_documents.length < 3)
    throw new ReplayMissingError(`recording_documents_missing:${scenario}`);

  // Do not reshape this document. In particular, do not translate old
  // target.run_id fields into a newer source_refs field. The current schema
  // is the acceptance boundary for any future recorder replacement.
  const trace = parseTraceDocument(scenario, envelope.recording_documents[0]);
  const recording: ProductRecording = {
    recording_documents: envelope.recording_documents,
  };
  const workList = projectWorkList(recording);
  const runList = projectWorkRunList(recording, trace.work.id);
  const work = GetWorkResponseSchema.parse({ work: envelope.recording_documents[2] }).work;
  const detail = envelope.recording_documents[1];
  const run = ProductWorkRunResponseSchema.parse({
    work,
    work_run: detail,
    projection_status: trace.projection_status,
    work_items: trace.work_items,
    actors: trace.actors,
    messages: trace.messages,
  });
  if (run.projection_status !== 'internally_anchored')
    throw new ReplayMissingError(`recording_run_not_anchored:${scenario}`);

  return { scenario, sourcePath, trace, work, workList, runList, run };
}

function applyMutation(
  trace: Extract<ProductRunTrace, { projection_status: 'internally_anchored' }>,
  mutation: ReplayMutation,
): Extract<ProductRunTrace, { projection_status: 'internally_anchored' }> {
  if (mutation === 'none') return trace;
  if (mutation === 'omit-feedback') {
    return ProductRunTraceResponseSchema.parse({
      ...trace,
      edges: trace.edges.filter((edge) => edge.kind !== 'feedback'),
    }) as Extract<ProductRunTrace, { projection_status: 'internally_anchored' }>;
  }
  return ProductRunTraceResponseSchema.parse({
    ...trace,
    work_items: trace.work_items.map((item) => ({
      ...item,
      attempts: item.attempts.map((attempt) => ({
        ...attempt,
        duration_ms: attempt.duration_ms === null ? null : 1,
      })),
    })),
  }) as Extract<ProductRunTrace, { projection_status: 'internally_anchored' }>;
}

function mutationFromEnvironment(): ReplayMutation {
  const value = process.env.C4_REPLAY_MUTATION ?? 'none';
  if (value === 'none' || value === 'omit-feedback' || value === 'constant-duration')
    return value;
  throw new ReplayMissingError('invalid_replay_mutation', [value]);
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const bytes = Buffer.from(JSON.stringify(body));
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('content-length', bytes.byteLength);
  res.end(bytes);
}

function notFound(res: ServerResponse): void {
  json(res, 404, { error: { code: 'not_found', message: 'Recorded product path not found.' } });
}

function pathParts(request: IncomingMessage): string[] {
  const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
  return pathname.split('/').filter(Boolean).map((part) => decodeURIComponent(part));
}

export async function startStaticReplayUpstream(options?: {
  readonly host?: string;
  readonly port?: number;
  readonly scenario?: RecordingScenario;
  readonly mutation?: ReplayMutation;
}) {
  const scenario = options?.scenario ?? scenarioFromEnvironment();
  const mutation = options?.mutation ?? mutationFromEnvironment();
  const loaded = await loadStaticReplayRecording(scenario);
  const trace = applyMutation(loaded.trace, mutation);
  const run = ProductWorkRunResponseSchema.parse({
    ...loaded.run,
    work_items: trace.work_items,
    actors: trace.actors,
    messages: trace.messages,
  });
  const server = createServer((request, response) => {
    if (request.method !== 'GET') {
      response.statusCode = 405;
      response.end();
      return;
    }
    const parts = pathParts(request);
    if (parts.length === 1 && parts[0] === 'health') {
      json(response, 200, { ok: true });
      return;
    }
    if (parts.length === 3 && parts[0] === 'api' && parts[1] === 'v1' && parts[2] === 'works') {
      json(response, 200, loaded.workList);
      return;
    }
    if (parts.length === 4 && parts[0] === 'api' && parts[1] === 'v1' && parts[2] === 'works') {
      if (parts[3] !== loaded.work.id) return notFound(response);
      json(response, 200, { work: loaded.work });
      return;
    }
    if (parts.length === 5 && parts[0] === 'api' && parts[1] === 'v1' && parts[2] === 'works' && parts[4] === 'runs') {
      if (parts[3] !== loaded.work.id) return notFound(response);
      json(response, 200, loaded.runList);
      return;
    }
    if (
      parts.length === 6 &&
      parts[0] === 'api' &&
      parts[1] === 'v1' &&
      parts[2] === 'works' &&
      parts[4] === 'runs'
    ) {
      if (parts[3] !== loaded.work.id || parts[5] !== loaded.run.work_run.id)
        return notFound(response);
      json(response, 200, run);
      return;
    }
    if (
      parts.length === 7 &&
      parts[0] === 'api' &&
      parts[1] === 'v1' &&
      parts[2] === 'works' &&
      parts[4] === 'runs' &&
      parts[6] === 'trace'
    ) {
      if (parts[3] !== loaded.work.id || parts[5] !== loaded.run.work_run.id)
        return notFound(response);
      json(response, 200, trace);
      return;
    }
    notFound(response);
  });
  await new Promise<void>((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(options?.port ?? Number(process.env.C4_REPLAY_PORT ?? 39781), options?.host ?? process.env.C4_REPLAY_HOST ?? '127.0.0.1', () => resolvePromise());
  });
  return { server, loaded, mutation, trace, url: `http://${options?.host ?? process.env.C4_REPLAY_HOST ?? '127.0.0.1'}:${(server.address() as { port: number }).port}` };
}

async function main(): Promise<void> {
  try {
    const replay = await startStaticReplayUpstream();
    process.stdout.write(`${JSON.stringify({ ready: true, url: replay.url, scenario: replay.loaded.scenario, mutation: replay.mutation })}\n`);
  } catch (error) {
    const missing = error instanceof ReplayMissingError;
    process.stderr.write(`${JSON.stringify({ status: missing ? 'MISSING' : 'FAIL', code: missing ? MISSING : FAIL, reason: error instanceof Error ? error.message : String(error), details: missing ? error.details : undefined })}\n`);
    process.exitCode = missing ? MISSING : FAIL;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]))
  void main();
