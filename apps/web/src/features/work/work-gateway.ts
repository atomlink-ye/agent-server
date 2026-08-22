import type {
  ProductRunTrace,
  ProductWorkDefinitionVersionResponse,
  ProductWorkRun,
  WorkListResponse,
  WorkResponse,
  WorkRunListResponse,
  WorkRunSummary,
} from '@atomlink-ye/agent-server/product-contract';
import {
  CreateWorkResponseSchema,
  GetProductWorkDefinitionVersionResponseSchema,
  GetWorkResponseSchema,
  ProductRunTraceResponseSchema,
  ProductSessionTranscriptsResponseSchema,
  ProductWorkRunResponseSchema,
  StartWorkRunResponseSchema,
  UpdateWorkDefinitionVersionResponseSchema,
  WorkListResponseSchema,
  WorkRunListResponseSchema,
  WorkDefinitionApplyResponseSchema,
} from '@atomlink-ye/agent-server/product-contract';

import { apiTransport, ApiTransportError } from '../../api/transport';

export type AnchoredRun = Extract<
  ProductWorkRun,
  { projection_status: 'internally_anchored' }
>;
export type AnchoredTrace = Extract<
  ProductRunTrace,
  { projection_status: 'internally_anchored' }
>;

export type WorkDetailData = {
  readonly work: WorkResponse;
  readonly runs: readonly WorkRunSummary[];
  readonly run: AnchoredRun | null;
  readonly trace: AnchoredTrace | null;
  readonly selectedDefinitionVersionId: string;
  readonly definitionVersion: ProductWorkDefinitionVersionResponse | null;
};
export type WorkListItem = WorkListResponse['works'][number];

export type RoleSummary = {
  readonly label: {
    readonly name: string;
    readonly role: string;
    readonly status: string;
  };
  readonly summary: {
    readonly entry_count: number;
    readonly last_meaningful: { readonly action: string | null } | null;
  };
};

export type DefinitionDiagnostics = readonly {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}[];

export interface DefinitionValidation {
  readonly fingerprint: string;
  readonly diagnostics: DefinitionDiagnostics;
}

export interface DefinitionPlan {
  readonly fingerprint: string;
  readonly resolved: {
    readonly kind: 'single_agent' | 'collaboration';
    readonly participants: readonly {
      readonly name: string;
      readonly role: 'primary' | 'lead' | 'member';
      readonly source: 'referenced' | 'inline';
      readonly agent_version_id: string | null;
      readonly skills: readonly string[];
      readonly tools: readonly string[];
    }[];
    readonly environment: {
      readonly source: 'referenced' | 'inline';
      readonly environment_version_id: string | null;
    };
    readonly memory_version_ids: readonly string[];
    readonly required_runtime_capabilities: readonly string[];
    readonly platform_capabilities: readonly string[];
  };
}

export interface DefinitionApply {
  readonly definitionId: string;
  readonly versionId: string;
}

export interface CreatedWork {
  readonly workId: string;
}

export class ProductReadError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ProductReadError';
  }
}

export class ProductMutationError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ProductMutationError';
  }
}

export async function loadWorks(): Promise<WorkListResponse> {
  return parseProduct(
    WorkListResponseSchema,
    await readProductJson('/api/works'),
  );
}

export async function loadWorkDetail(
  workId: string,
  selectedRunId: string | undefined,
  preferCurrentDefinition: boolean,
): Promise<WorkDetailData> {
  const encodedId = encodeURIComponent(workId);
  const [workValue, runsValue] = await Promise.all([
    readProductJson(`/api/works/${encodedId}`),
    readProductJson(`/api/works/${encodedId}/runs`),
  ]);
  const workResponse = parseProduct(GetWorkResponseSchema, workValue);
  const runsResponse = parseProduct(WorkRunListResponseSchema, runsValue);
  if (
    workResponse.work.id !== workId ||
    runsResponse.work_runs.some((run) => run.work_id !== workId)
  ) {
    throw new ProductReadError(
      'The Product Work response did not match the requested Work.',
      502,
    );
  }
  const runs = runsResponse.work_runs;
  const selectedSummary = selectedRunId
    ? runs.find((run) => run.id === selectedRunId)
    : runs[0];
  if (selectedRunId && !selectedSummary) {
    throw new Error('The selected Product WorkRun is not available.');
  }

  const selectedDefinitionVersionId = preferCurrentDefinition
    ? workResponse.work.definition_version_id
    : (selectedSummary?.definition_version_id ??
      workResponse.work.definition_version_id);
  const definitionPromise = readOptionalProductJson(
    `/api/work-definition-versions/${encodeURIComponent(selectedDefinitionVersionId)}`,
  ).then((value) =>
    value === null
      ? null
      : parseProduct(GetProductWorkDefinitionVersionResponseSchema, value),
  );
  if (!selectedSummary) {
    return {
      work: workResponse.work,
      runs,
      run: null,
      trace: null,
      selectedDefinitionVersionId,
      definitionVersion: (await definitionPromise)?.version ?? null,
    };
  }

  const runPath = `/api/works/${encodedId}/runs/${encodeURIComponent(selectedSummary.id)}`;
  const [runValue, traceValue, definitionResponse] = await Promise.all([
    readProductJson(runPath),
    readProductJson(`${runPath}/trace`),
    definitionPromise,
  ]);
  const run = parseProduct(ProductWorkRunResponseSchema, runValue);
  const trace = parseProduct(ProductRunTraceResponseSchema, traceValue);
  if (
    run.projection_status === 'internally_anchored' &&
    (run.work?.id !== workId || run.work_run?.id !== selectedSummary.id)
  ) {
    throw new ProductReadError(
      'The Product Run response did not match the requested Work.',
      502,
    );
  }
  if (
    trace.projection_status === 'internally_anchored' &&
    (trace.work?.id !== workId || trace.work_run?.id !== selectedSummary.id)
  ) {
    throw new ProductReadError(
      'The Product Trace response did not match the requested Run.',
      502,
    );
  }
  if (!isAnchoredRun(run) || !isAnchoredTrace(trace)) {
    throw new Error('The Product WorkRun projection was not captured.');
  }
  return {
    work: workResponse.work,
    runs,
    run,
    trace,
    selectedDefinitionVersionId,
    definitionVersion: definitionResponse?.version ?? null,
  };
}

export async function loadRunRoleSummaries(
  workId: string,
  runId: string,
): Promise<readonly RoleSummary[]> {
  const body = parseProduct(
    ProductSessionTranscriptsResponseSchema,
    await readProductJson(
      `/api/works/${encodeURIComponent(workId)}/runs/${encodeURIComponent(runId)}/session-transcripts`,
    ),
  );
  if (body.work_id !== workId || body.work_run_id !== runId) {
    throw new ProductReadError(
      'The session transcript response did not match the requested Run.',
      502,
    );
  }
  return body.sessions.map((session) => ({
    label: session.label,
    summary: {
      entry_count: session.summary.entry_count,
      last_meaningful: session.summary.last_meaningful
        ? { action: session.summary.last_meaningful.action }
        : null,
    },
  }));
}

export async function startWorkRun(workId: string): Promise<string> {
  try {
    const body = parseProduct(
      StartWorkRunResponseSchema,
      await apiTransport.request(
        `/api/works/${encodeURIComponent(workId)}/runs`,
        {
          method: 'POST',
          cache: 'no-store',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ trigger_kind: 'manual' }),
        },
      ),
    );
    return body.work_run.id;
  } catch (error) {
    if (error instanceof ProductMutationError) throw error;
    if (error instanceof ApiTransportError) {
      const payload = error.message;
      throw new ProductMutationError(payload, error.status, error.code);
    }
    throw error;
  }
}

export async function validateWorkDefinition(
  source: string,
): Promise<DefinitionValidation> {
  return decodeDefinitionValidation(
    await apiTransport.request('/api/work-definitions/validate', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source }),
    }),
  );
}

export async function planWorkDefinition(
  source: string,
): Promise<DefinitionPlan> {
  return decodeFingerprint(
    await apiTransport.request('/api/work-definitions/plan', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source }),
    }),
  );
}

export async function applyWorkDefinition(
  source: string,
): Promise<DefinitionApply> {
  return decodeDefinitionApply(
    await apiTransport.request('/api/work-definitions/apply', {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': crypto.randomUUID(),
      },
      body: JSON.stringify({ source }),
    }),
  );
}

export async function createWork(
  definitionId: string,
  versionId: string,
  title: string,
): Promise<CreatedWork> {
  return decodeCreatedWork(
    await apiTransport.request('/api/works', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        definition_id: definitionId,
        definition_version_id: versionId,
        title,
      }),
    }),
  );
}

export async function pinWorkDefinition(
  workId: string,
  definitionVersionId: string,
): Promise<void> {
  parseProduct(
    UpdateWorkDefinitionVersionResponseSchema,
    await apiTransport.request(
      `/api/works/${encodeURIComponent(workId)}/definition-version`,
      {
        method: 'POST',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ definition_version_id: definitionVersionId }),
      },
    ),
  );
}

async function readProductJson(path: string): Promise<unknown> {
  try {
    return await apiTransport.request(path, {
      method: 'GET',
      cache: 'no-store',
    });
  } catch (error) {
    if (error instanceof ApiTransportError) {
      throw new ProductReadError(error.message, error.status);
    }
    throw error;
  }
}

async function readOptionalProductJson(path: string): Promise<unknown | null> {
  try {
    return await readProductJson(path);
  } catch (error) {
    if (error instanceof ProductReadError && error.status === 404) return null;
    throw error;
  }
}

function isAnchoredRun(value: ProductWorkRun): value is AnchoredRun {
  return value.projection_status === 'internally_anchored';
}

function isAnchoredTrace(value: ProductRunTrace): value is AnchoredTrace {
  return value.projection_status === 'internally_anchored';
}

function decodeDefinitionValidation(value: unknown): DefinitionValidation {
  const root = record(value);
  const fingerprint = root?.fingerprint;
  if (typeof fingerprint !== 'string' || !fingerprint) {
    throw new Error('The Definition validation response was invalid.');
  }
  return {
    fingerprint,
    diagnostics: decodeDiagnostics(root?.diagnostics),
  };
}

function decodeFingerprint(value: unknown): DefinitionPlan {
  const root = record(value);
  const fingerprint = root?.fingerprint;
  const resolved = record(root?.resolved);
  if (
    typeof fingerprint !== 'string' ||
    !fingerprint ||
    (resolved?.kind !== 'single_agent' && resolved?.kind !== 'collaboration') ||
    !Array.isArray(resolved.participants) ||
    !Array.isArray(resolved.memory_version_ids) ||
    !resolved.memory_version_ids.every(isString) ||
    !Array.isArray(resolved.required_runtime_capabilities) ||
    !resolved.required_runtime_capabilities.every(isString) ||
    !Array.isArray(resolved.platform_capabilities) ||
    !resolved.platform_capabilities.every(isString)
  ) {
    throw new Error('The Definition plan response was invalid.');
  }
  const participants = resolved.participants.map(decodeParticipant);
  const environment = record(resolved.environment);
  if (
    !environment ||
    (environment.source !== 'referenced' && environment.source !== 'inline') ||
    (environment.environment_version_id !== null &&
      typeof environment.environment_version_id !== 'string')
  ) {
    throw new Error('The Definition plan response was invalid.');
  }
  return {
    fingerprint,
    resolved: {
      kind: resolved.kind,
      participants,
      environment: {
        source: environment.source,
        environment_version_id: environment.environment_version_id,
      },
      memory_version_ids: resolved.memory_version_ids,
      required_runtime_capabilities: resolved.required_runtime_capabilities,
      platform_capabilities: resolved.platform_capabilities,
    },
  };
}

function decodeDefinitionApply(value: unknown): DefinitionApply {
  const body = parseProduct(WorkDefinitionApplyResponseSchema, value);
  return { definitionId: body.definition.id, versionId: body.version.id };
}

function decodeCreatedWork(value: unknown): CreatedWork {
  return { workId: parseProduct(CreateWorkResponseSchema, value).work.id };
}

function decodeDiagnostics(value: unknown): DefinitionDiagnostics {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value))
    throw new Error('The Definition diagnostics response was invalid.');
  return value.map((item) => {
    const diagnostic = record(item);
    if (
      typeof diagnostic?.path !== 'string' ||
      typeof diagnostic.code !== 'string' ||
      typeof diagnostic.message !== 'string'
    ) {
      throw new Error('The Definition diagnostics response was invalid.');
    }
    return {
      path: diagnostic.path,
      code: diagnostic.code,
      message: diagnostic.message,
    };
  });
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function decodeParticipant(
  value: unknown,
): DefinitionPlan['resolved']['participants'][number] {
  const participant = record(value);
  if (
    !participant ||
    typeof participant.name !== 'string' ||
    (participant.role !== 'primary' &&
      participant.role !== 'lead' &&
      participant.role !== 'member') ||
    (participant.source !== 'referenced' && participant.source !== 'inline') ||
    (participant.agent_version_id !== null &&
      typeof participant.agent_version_id !== 'string') ||
    !Array.isArray(participant.skills) ||
    !participant.skills.every(isString) ||
    !Array.isArray(participant.tools) ||
    !participant.tools.every(isString)
  )
    throw new Error('The Definition plan response was invalid.');
  return {
    name: participant.name,
    role: participant.role,
    source: participant.source,
    agent_version_id: participant.agent_version_id,
    skills: participant.skills,
    tools: participant.tools,
  };
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function parseProduct<T>(
  schema: { parse(value: unknown): T },
  value: unknown,
): T {
  try {
    return schema.parse(value);
  } catch {
    throw new Error('The Product response was invalid.');
  }
}
