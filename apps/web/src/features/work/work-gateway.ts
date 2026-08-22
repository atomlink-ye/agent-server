import type {
  ProductRunTrace,
  ProductWorkDefinitionVersionResponse,
  ProductWorkRun,
  WorkListResponse,
  WorkResponse,
  WorkRunListResponse,
  WorkRunSummary,
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

export type RoleSummary = {
  readonly label: { readonly name: string; readonly role: string; readonly status: string };
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
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ProductReadError';
  }
}

export class ProductMutationError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = 'ProductMutationError';
  }
}

export async function loadWorks(): Promise<WorkListResponse> {
  return readProductJson<WorkListResponse>('/api/works');
}

export async function loadWorkDetail(
  workId: string,
  selectedRunId: string | undefined,
  preferCurrentDefinition: boolean,
): Promise<WorkDetailData> {
  const encodedId = encodeURIComponent(workId);
  const [workResponse, runsResponse] = await Promise.all([
    readProductJson<{ work: WorkResponse }>(`/api/works/${encodedId}`),
    readProductJson<WorkRunListResponse>(`/api/works/${encodedId}/runs`),
  ]);
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
  const definitionPromise = readOptionalProductJson<{
    version: ProductWorkDefinitionVersionResponse;
  }>(`/api/work-definition-versions/${encodeURIComponent(selectedDefinitionVersionId)}`);
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
  const [run, trace, definitionResponse] = await Promise.all([
    readProductJson<ProductWorkRun>(runPath),
    readProductJson<ProductRunTrace>(`${runPath}/trace`),
    definitionPromise,
  ]);
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
  const body = await readProductJson<unknown>(
    `/api/works/${encodeURIComponent(workId)}/runs/${encodeURIComponent(runId)}/session-transcripts`,
  );
  const sessions = record(body)?.sessions;
  if (!Array.isArray(sessions)) throw new Error('The session transcript response was invalid.');
  return sessions.map(decodeRoleSummary);
}

export async function startWorkRun(workId: string): Promise<string> {
  try {
    const body = await apiTransport.request<unknown>(
      `/api/works/${encodeURIComponent(workId)}/runs`,
      {
        method: 'POST',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ trigger_kind: 'manual' }),
      },
    );
    const run = record(body)?.work_run;
    const runId = record(run)?.id;
    if (typeof runId !== 'string' || !runId) {
      throw new ProductMutationError('The Run start response was invalid.', 502);
    }
    return runId;
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
    await apiTransport.request<unknown>('/api/work-definitions/validate', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source }),
    }),
  );
}

export async function planWorkDefinition(source: string): Promise<DefinitionPlan> {
  return decodeFingerprint(
    await apiTransport.request<unknown>('/api/work-definitions/plan', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source }),
    }),
  );
}

export async function applyWorkDefinition(source: string): Promise<DefinitionApply> {
  return decodeDefinitionApply(
    await apiTransport.request<unknown>('/api/work-definitions/apply', {
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
    await apiTransport.request<unknown>('/api/works', {
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
  await apiTransport.request<unknown>(
    `/api/works/${encodeURIComponent(workId)}/definition-version`,
    {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ definition_version_id: definitionVersionId }),
    },
  );
}

async function readProductJson<T>(path: string): Promise<T> {
  try {
    return await apiTransport.request<T>(path, {
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

async function readOptionalProductJson<T>(path: string): Promise<T | null> {
  try {
    return await readProductJson<T>(path);
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

function decodeRoleSummary(value: unknown): RoleSummary {
  const root = record(value);
  const label = record(root?.label);
  const summary = record(root?.summary);
  const lastMeaningful = summary?.last_meaningful;
  const last = lastMeaningful === null ? null : record(lastMeaningful);
  if (
    typeof label?.name !== 'string' ||
    typeof label.role !== 'string' ||
    typeof label.status !== 'string' ||
    !Number.isSafeInteger(summary?.entry_count) ||
    (last !== null && typeof last?.action !== 'string' && last?.action !== null)
  ) {
    throw new Error('The session transcript response was invalid.');
  }
  return {
    label: { name: label.name, role: label.role, status: label.status },
    summary: {
      entry_count: summary.entry_count as number,
      last_meaningful: last ? { action: last.action as string | null } : null,
    },
  };
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
    !Array.isArray(resolved.participants)
  ) {
    throw new Error('The Definition plan response was invalid.');
  }
  return { fingerprint, resolved: resolved as DefinitionPlan['resolved'] };
}

function decodeDefinitionApply(value: unknown): DefinitionApply {
  const root = record(value);
  const definitionId = record(root?.definition)?.id;
  const versionId = record(root?.version)?.id;
  if (typeof definitionId !== 'string' || !definitionId || typeof versionId !== 'string' || !versionId) {
    throw new Error('The Definition apply response was invalid.');
  }
  return { definitionId, versionId };
}

function decodeCreatedWork(value: unknown): CreatedWork {
  const workId = record(record(value)?.work)?.id;
  if (typeof workId !== 'string' || !workId) {
    throw new Error('The Work creation response was invalid.');
  }
  return { workId };
}

function decodeDiagnostics(value: unknown): DefinitionDiagnostics {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error('The Definition diagnostics response was invalid.');
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
