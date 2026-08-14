#!/usr/bin/env node

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  GetWorkResponseSchema,
  ProductRunTraceResponseSchema,
  ProductWorkRunResponseSchema,
  WorkListItemSchema,
  WorkListResponseSchema,
  type ProductRunTrace,
  type ProductWorkRun,
  type WorkListResponse,
  type WorkResponse,
  type WorkRunListResponse,
  WorkRunListResponseSchema,
  WorkRunSummarySchema,
} from '@atomlink-ye/agent-server/product-contract';

export const PASS = 0;
export const FAIL = 1;
export const MISSING = 2;

export const RECORDING_SCENARIOS = ['parallel-success', 'rework-once'] as const;
export type RecordingScenario = (typeof RECORDING_SCENARIOS)[number];

const defaultFixtureDirectory = resolve(
  fileURLToPath(new URL('./recordings/c4', import.meta.url)),
);

const recordingFiles: Record<RecordingScenario, Record<'work' | 'run' | 'trace', string>> = {
  'parallel-success': {
    work: 'parallel-success/api/work.json',
    run: 'parallel-success/api/work-run.json',
    trace: 'parallel-success/api/trace.json',
  },
  'rework-once': {
    work: 'rework-once/api/work.json',
    run: 'rework-once/api/work-run.json',
    trace: 'rework-once/api/trace.json',
  },
};

type ProvenanceFile = {
  readonly source_sha256: string;
  readonly copy_sha256: string;
};

type ProvenanceEntry = {
  readonly scenario: RecordingScenario;
  readonly source_root: string;
  readonly source_manifest_sha256: string;
  readonly files: Record<string, ProvenanceFile>;
};

type ProvenanceLedger = {
  readonly schema_version: number;
  readonly documents: readonly ProvenanceEntry[];
};

type LoadedReplay = {
  readonly scenario: RecordingScenario;
  readonly sourcePath: string;
  readonly trace: Extract<ProductRunTrace, { projection_status: 'internally_anchored' }>;
  readonly work: WorkResponse;
  readonly workList: WorkListResponse;
  readonly runList: WorkRunListResponse;
  readonly run: Extract<ProductWorkRun, { projection_status: 'internally_anchored' }>;
  readonly provenance: ProvenanceEntry | null;
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

function schemaIssues(result: { readonly success: boolean; readonly error?: { readonly issues: readonly { readonly path: readonly (string | number)[]; readonly message: string }[] } }): readonly string[] {
  if (result.success || !result.error) return [];
  return result.error.issues.slice(0, 8).map((issue) =>
    `${issue.path.join('.') || '<root>'}:${issue.message}`,
  );
}

async function readJsonDocument(path: string, scenario: RecordingScenario, name: string): Promise<{ readonly document: unknown; readonly bytes: Buffer }> {
  try {
    const bytes = await readFile(path);
    return { document: JSON.parse(bytes.toString('utf8')) as unknown, bytes };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ReplayMissingError(`recording_${name}_unreadable:${scenario}`, [detail]);
  }
}

async function verifyProvenance(
  directory: string,
  scenario: RecordingScenario,
  files: Readonly<Record<'work' | 'run' | 'trace', { readonly relativePath: string; readonly bytes: Buffer }>>,
): Promise<ProvenanceEntry> {
  const ledgerPath = resolve(directory, 'provenance.json');
  let ledger: ProvenanceLedger;
  try {
    ledger = JSON.parse(await readFile(ledgerPath, 'utf8')) as ProvenanceLedger;
  } catch (error) {
    throw new ReplayMissingError(`recording_provenance_unreadable:${scenario}`, [error instanceof Error ? error.message : String(error)]);
  }
  const entry = ledger.documents.find((candidate) => candidate.scenario === scenario);
  if (!entry || ledger.schema_version !== 1)
    throw new ReplayMissingError(`recording_provenance_missing:${scenario}`);
  for (const { relativePath, bytes } of Object.values(files)) {
    const expected = entry.files[relativePath];
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (!expected || expected.source_sha256 !== expected.copy_sha256 || expected.copy_sha256 !== actual)
      throw new ReplayMissingError(`recording_provenance_hash_mismatch:${scenario}`, [relativePath]);
  }
  return entry;
}

function deriveWorkList(work: WorkResponse, run: Extract<ProductWorkRun, { projection_status: 'internally_anchored' }>): WorkListResponse {
  const latestRun = deriveRunSummary(run);
  return WorkListResponseSchema.parse({
    works: [WorkListItemSchema.parse({
      ...work,
      product_state: run.work_run.product_state,
      latest_run_summary: {
        id: latestRun.id,
        updated_at: latestRun.updated_at,
        result_summary: run.work_run.result_summary,
        result_capture_status: run.work_run.result_capture_status,
      },
    })],
    next_cursor: null,
  });
}

function deriveRunSummary(run: Extract<ProductWorkRun, { projection_status: 'internally_anchored' }>) {
  return WorkRunSummarySchema.parse({
    id: run.work_run.id,
    work_id: run.work_run.work_id,
    definition_version_id: run.work_run.definition_version_id,
    trigger_kind: run.work_run.trigger_kind,
    trigger_ref: run.work_run.trigger_ref,
    expires_at: run.work_run.expires_at,
    bound_at: run.work_run.bound_at,
    created_at: run.work_run.created_at,
    updated_at: run.work_run.updated_at,
  });
}

function deriveRunList(run: Extract<ProductWorkRun, { projection_status: 'internally_anchored' }>): WorkRunListResponse {
  return WorkRunListResponseSchema.parse({ work_runs: [deriveRunSummary(run)], next_cursor: null });
}

/**
 * Load one recorder only after every current complete response contract
 * accepts its copied API document. An unaccepted recorder remains MISSING
 * rather than being migrated here.
 */
export async function loadStaticReplayRecording(
  scenario: RecordingScenario = scenarioFromEnvironment(),
): Promise<LoadedReplay> {
  const directory = fixtureDirectory();
  const paths = recordingFiles[scenario];
  const sourcePath = resolve(directory, paths.trace);
  const [workDocument, runDocument, traceDocument] = await Promise.all([
    readJsonDocument(resolve(directory, paths.work), scenario, 'work'),
    readJsonDocument(resolve(directory, paths.run), scenario, 'run'),
    readJsonDocument(resolve(directory, paths.trace), scenario, 'trace'),
  ]);

  // Every consumed recorder document crosses its current complete response
  // schema before any hash, count, projection, or derivation is attempted.
  const workResult = GetWorkResponseSchema.safeParse({ work: workDocument.document });
  const runResult = ProductWorkRunResponseSchema.safeParse(runDocument.document);
  const traceResult = ProductRunTraceResponseSchema.safeParse(traceDocument.document);
  if (!workResult.success || !runResult.success || !traceResult.success) {
    throw new ReplayMissingError(`recording_schema_invalid:${scenario}`, [
      ...schemaIssues(workResult).map((issue) => `work:${issue}`),
      ...schemaIssues(runResult).map((issue) => `api/work-run:${issue}`),
      ...schemaIssues(traceResult).map((issue) => `api/trace:${issue}`),
    ]);
  }
  if (runResult.data.projection_status !== 'internally_anchored' || traceResult.data.projection_status !== 'internally_anchored')
    throw new ReplayMissingError(`recording_not_anchored:${scenario}`);

  const provenance = process.env.C4_WALKING_PATH_DIRECT_DEMO === '1'
    ? null
    : await verifyProvenance(directory, scenario, {
        work: { relativePath: paths.work, bytes: workDocument.bytes },
        run: { relativePath: paths.run, bytes: runDocument.bytes },
        trace: { relativePath: paths.trace, bytes: traceDocument.bytes },
      });
  const work = workResult.data.work;
  const run = runResult.data;
  const trace = traceResult.data;
  const workList = deriveWorkList(work, run);
  const runList = deriveRunList(run);
  return { scenario, sourcePath, trace, work, workList, runList, run, provenance };
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
}) {
  const scenario = options?.scenario ?? scenarioFromEnvironment();
  const loaded = await loadStaticReplayRecording(scenario);
  const trace = loaded.trace;
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
  return { server, loaded, trace, url: `http://${options?.host ?? process.env.C4_REPLAY_HOST ?? '127.0.0.1'}:${(server.address() as { port: number }).port}` };
}

async function main(): Promise<void> {
  try {
    const replay = await startStaticReplayUpstream();
    process.stdout.write(`${JSON.stringify({ ready: true, url: replay.url, scenario: replay.loaded.scenario })}\n`);
  } catch (error) {
    const missing = error instanceof ReplayMissingError;
    process.stderr.write(`${JSON.stringify({ status: missing ? 'MISSING' : 'FAIL', code: missing ? MISSING : FAIL, reason: error instanceof Error ? error.message : String(error), details: missing ? error.details : undefined })}\n`);
    process.exitCode = missing ? MISSING : FAIL;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]))
  void main();
