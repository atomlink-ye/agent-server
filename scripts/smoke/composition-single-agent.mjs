import { randomUUID } from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;

export const COMPOSITION_ADMISSION_TIMEOUT_ENV =
  'COMPOSITION_ADMISSION_TIMEOUT_MS';
export const DEFAULT_COMPOSITION_ADMISSION_TIMEOUT_MS = 60_000;
export const MAX_COMPOSITION_ADMISSION_TIMEOUT_MS = 600_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const TERMINAL_PRODUCT_STATES = new Set([
  'complete',
  'problem',
  'not_captured',
]);

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function resolveCompositionAdmissionTimeoutMs(
  environment = process.env,
) {
  const rawValue = environment[COMPOSITION_ADMISSION_TIMEOUT_ENV]?.trim();
  if (!rawValue) return DEFAULT_COMPOSITION_ADMISSION_TIMEOUT_MS;
  if (!/^\d+$/.test(rawValue))
    throw new Error(
      `${COMPOSITION_ADMISSION_TIMEOUT_ENV} must be a positive decimal safe integer no greater than ${MAX_COMPOSITION_ADMISSION_TIMEOUT_MS}.`,
    );
  const value = Number(rawValue);
  if (
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > MAX_COMPOSITION_ADMISSION_TIMEOUT_MS
  )
    throw new Error(
      `${COMPOSITION_ADMISSION_TIMEOUT_ENV} must be a positive decimal safe integer no greater than ${MAX_COMPOSITION_ADMISSION_TIMEOUT_MS}.`,
    );
  return value;
}

export function classifyCompositionWorkRunState({ summary, detail } = {}) {
  const workRun = detail?.work_run ?? summary;
  if (!workRun || typeof workRun.id !== 'string')
    return { state: 'not_found', work_run_id: null };
  if (workRun.bound_at === null)
    return {
      state: 'pending_unbound',
      work_run_id: workRun.id,
      bound_at: null,
      product_state: null,
    };
  const productState = detail?.work_run?.product_state;
  return {
    state: TERMINAL_PRODUCT_STATES.has(productState)
      ? 'terminal'
      : 'bound_running',
    work_run_id: workRun.id,
    bound_at: workRun.bound_at,
    product_state: productState ?? null,
  };
}

export async function collectCompositionAdmissionAbortDiagnostic({
  request,
  workId,
  triggerRef,
  error,
}) {
  let summary;
  let detail;
  let lookup = 'found';
  try {
    const listed = await request(
      `/api/v1/works/${workId}/runs?limit=100&order=created_desc`,
      { expectedStatus: 200 },
    );
    summary = (Array.isArray(listed.work_runs) ? listed.work_runs : []).find(
      (candidate) => candidate.trigger_ref === triggerRef,
    );
    if (!summary) lookup = 'not_found';
    if (summary?.id) {
      detail = await request(
        `/api/v1/works/${workId}/runs/${encodeURIComponent(summary.id)}`,
        { expectedStatus: 200 },
      );
    }
  } catch {
    lookup = 'unavailable';
  }
  return {
    work_id: workId,
    admission_error: error?.name === 'TimeoutError' ? 'timeout' : 'aborted',
    lookup,
    ...classifyCompositionWorkRunState({ summary, detail }),
  };
}

function isCompositionAdmissionAbort(error) {
  return error?.name === 'TimeoutError' || error?.name === 'AbortError';
}

export async function runCompositionSingleWorkerSmoke({
  baseUrl,
  token,
  workspaceId,
  expectedProvider,
  expectedModel,
  timeoutMs = 360_000,
  progress = () => undefined,
}) {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl)
    throw new Error('composition smoke requires a host-native DATABASE_URL');
  const compositionAdmissionTimeoutMs = resolveCompositionAdmissionTimeoutMs();
  const scenarioId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const marker = `COMPOSITION_SINGLE_WORKER_OK_${scenarioId}`;
  const triggerRef = `composition-single-${scenarioId}`;

  async function request(
    path,
    {
      method = 'GET',
      body,
      expectedStatus,
      requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    } = {},
  ) {
    const response = await fetch(new URL(path, baseUrl), {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(method === 'POST' && !path.startsWith('/api/v1/works')
          ? {
              'idempotency-key': `composition-smoke-${scenarioId}-${randomUUID()}`,
            }
          : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
    const text = await response.text();
    const json = text ? JSON.parse(text) : {};
    if (
      expectedStatus === undefined
        ? !response.ok
        : response.status !== expectedStatus
    )
      throw new Error(
        `${method} ${path} -> ${response.status} ${JSON.stringify(json)}`,
      );
    return json;
  }

  async function importAndPublish(source, importPath, publishPath) {
    const imported = await request(importPath, {
      method: 'POST',
      body: { source },
      expectedStatus: 201,
    });
    return request(publishPath(imported.version.id), {
      method: 'POST',
      body: {},
      expectedStatus: 200,
    });
  }

  progress('composition_single_worker_importing');
  const workerSource = `apiVersion: agent-server/v1alpha1
kind: Worker
metadata:
  name: composition-single-${scenarioId}
spec:
  description: Composition-first single Worker real-provider smoke
  instructions: 'Return exactly the marker contained in the Work input. Do not call tools unless execution cannot proceed otherwise.'
  runtime:
    provider: paseo
    modelPolicyRef: free-only
    mode: isolated
  tools:
    - ref: agent-server/memory-read
      kind: tool
  skills:
    - ref: agent-server/memory-api
  input:
    schema:
      type: object
      properties: {}
      additionalProperties: false
    prompt: "Follow the Product Work input."
  session:
    invocation: fresh_per_invocation
    followUps: queued
    binding: reusable
  memory:
    policy: workspace_snapshot
    proposalLimit: 0
  permissions:
    network: read_only
    filesystem: workspace_read
  completion:
    type: executable
    command: "done"
`;
  const workerValidation = await request('/api/v1/worker-packages:validate', {
    method: 'POST',
    body: { source: workerSource },
    expectedStatus: 200,
  });
  if (workerValidation.valid !== true || !workerValidation.fingerprint)
    throw new Error(
      `composition Worker package validation failed: ${JSON.stringify(workerValidation)}`,
    );
  const worker = await importAndPublish(
    workerSource,
    '/api/v1/workers:import',
    (id) => `/api/v1/worker-versions/${id}:publish`,
  );
  const environment = await importAndPublish(
    `apiVersion: agent-server/v1alpha1
kind: ManagedEnvironment
metadata:
  name: composition-single-environment-${scenarioId}
spec:
  adapter: paseo
  provider: opencode
  modelPolicyRef: free-only
  runtimeCellPolicy: per_runtime_session
`,
    '/api/v1/environments:import',
    (id) => `/api/v1/environment-versions/${id}:publish`,
  );

  const publicDefinition = `apiVersion: agentserver.dev/v1alpha1
kind: WorkDefinition
metadata:
  name: composition-single-${scenarioId}
  description: Real-provider Product Definition -> Work -> Run smoke.
spec:
  kind: single_worker
  worker_version_id: ${worker.id}
  environment_version_id: ${environment.id}
  memory_version_ids: []
  input_schema:
    type: object
    properties:
      marker:
        type: string
        min_length: 1
        max_length: 256
    required: [marker]
    additional_properties: false
`;

  const validated = await request('/api/v1/work-definitions:validate', {
    method: 'POST',
    body: { source: publicDefinition },
    expectedStatus: 200,
  });
  if (validated.valid !== true || !validated.fingerprint)
    throw new Error(
      `composition Product Definition validation failed: ${JSON.stringify(validated)}`,
    );
  const applied = await request('/api/v1/work-definitions:apply', {
    method: 'POST',
    body: { source: publicDefinition },
    expectedStatus: 201,
  });
  const definitionId = applied.definition?.id;
  const definitionVersionId = applied.version?.id;
  if (
    typeof definitionId !== 'string' ||
    typeof definitionVersionId !== 'string' ||
    applied.version?.fingerprint !== validated.fingerprint ||
    !applied.resolved?.resource_manifest_fingerprint
  )
    throw new Error(
      `composition Product Definition apply invalid: ${JSON.stringify(applied)}`,
    );

  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const workspace = await pool.query(
      `SELECT tenant_id,principal_type,principal_id
         FROM workspaces WHERE id=$1`,
      [workspaceId],
    );
    const owner = workspace.rows[0];
    if (!owner)
      throw new Error(`composition smoke workspace missing: ${workspaceId}`);

    const created = await request('/api/v1/works', {
      method: 'POST',
      body: {
        definition_id: definitionId,
        definition_version_id: definitionVersionId,
        title: `Composition single ${scenarioId}`,
      },
      expectedStatus: 201,
    });
    const workId = created.work?.id;
    if (typeof workId !== 'string')
      throw new Error('composition smoke Work id missing');

    let started;
    try {
      started = await request(`/api/v1/works/${workId}/runs`, {
        method: 'POST',
        body: {
          trigger_kind: 'manual',
          trigger_ref: triggerRef,
          input: { marker },
        },
        expectedStatus: 202,
        requestTimeoutMs: compositionAdmissionTimeoutMs,
      });
    } catch (error) {
      if (isCompositionAdmissionAbort(error)) {
        const diagnostic = await collectCompositionAdmissionAbortDiagnostic({
          request,
          workId,
          triggerRef,
          error,
        });
        progress('composition_single_worker_admission_aborted', diagnostic);
        throw new Error(
          `composition WorkRun admission ${diagnostic.admission_error}: state=${diagnostic.state} lookup=${diagnostic.lookup}`,
          { cause: error },
        );
      }
      throw error;
    }
    const workRunId = started.work_run?.id;
    const rootTaskId = started.execution_receipt?.source_refs?.task_id;
    if (typeof workRunId !== 'string' || typeof rootTaskId !== 'string')
      throw new Error('composition smoke WorkRun identities missing');
    const rootRuns = await pool.query(
      `SELECT r.id FROM runs r
         JOIN tasks t ON t.id=r.task_id
        WHERE r.task_id=$1 AND t.tenant_id=$2 AND t.workspace_id=$3
          AND t.principal_type=$4 AND t.principal_id=$5`,
      [
        rootTaskId,
        owner.tenant_id,
        workspaceId,
        owner.principal_type,
        owner.principal_id,
      ],
    );
    if (rootRuns.rows.length !== 1)
      throw new Error(
        `composition root Run provenance mismatch: ${JSON.stringify(rootRuns.rows)}`,
      );
    const rootRunId = rootRuns.rows[0].id;
    progress('composition_single_worker_started', {
      work_id: workId,
      work_run_id: workRunId,
    });

    const inputSnapshot = await pool.query(
      `SELECT input_snapshot,input_fingerprint FROM work_runs WHERE id=$1`,
      [workRunId],
    );
    if (
      inputSnapshot.rows[0]?.input_snapshot?.marker !== marker ||
      !/^sha256:[0-9a-f]{64}$/.test(
        inputSnapshot.rows[0]?.input_fingerprint ?? '',
      )
    )
      throw new Error(
        `composition WorkRun input snapshot mismatch: ${JSON.stringify(inputSnapshot.rows[0])}`,
      );

    const deadline = Date.now() + timeoutMs;
    let projection;
    while (Date.now() < deadline) {
      const response = await fetch(
        new URL(`/api/v1/works/${workId}/runs/${workRunId}`, baseUrl),
        {
          headers: {
            authorization: `Bearer ${token}`,
            accept: 'application/json',
          },
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (response.status === 503) {
        await pause(1_000);
        continue;
      }
      if (!response.ok)
        throw new Error(`composition WorkRun projection -> ${response.status}`);
      projection = await response.json();
      const state = projection.work_run?.product_state;
      if (state === 'running') {
        await pause(1_000);
        continue;
      }
      if (state === 'complete') break;
      throw new Error(
        `composition WorkRun terminal state ${JSON.stringify(projection.work_run)}`,
      );
    }
    if (projection?.work_run?.product_state !== 'complete')
      throw new Error('composition single-Worker WorkRun timed out');

    const trace = await request(
      `/api/v1/works/${workId}/runs/${workRunId}/trace`,
      { expectedStatus: 200 },
    );
    const providerRuns = (Array.isArray(trace.runs) ? trace.runs : []).filter(
      (run) => run.provider !== null && run.model !== null,
    );
    if (providerRuns.length !== 1)
      throw new Error(
        `composition trace expected one provider Run, got ${providerRuns.length}`,
      );
    const providerRun = providerRuns[0];
    if (
      providerRun.provider !== expectedProvider ||
      providerRun.model !== expectedModel
    )
      throw new Error(
        `composition runtime mismatch: ${providerRun.provider}/${providerRun.model}`,
      );
    const technicalRun = await request(
      `/api/v1/runs/${encodeURIComponent(providerRun.source_refs.run_id)}`,
      { expectedStatus: 200 },
    );
    if (technicalRun.result?.text?.trim() !== marker)
      throw new Error(
        `composition runtime result mismatch: ${JSON.stringify(technicalRun.result)}`,
      );
    if (
      !(technicalRun.usage?.input_tokens > 0) ||
      !(technicalRun.usage?.output_tokens > 0)
    )
      throw new Error('composition runtime usage was not captured');

    const manifest = await pool.query(
      `SELECT resource_kind,requested_ref,resolved_version_id,resolved_fingerprint,slot
         FROM work_run_resource_manifest
        WHERE work_run_id=$1 ORDER BY slot`,
      [workRunId],
    );
    const rows = manifest.rows;
    const requireEntry = (kind, predicate) => {
      const entry = rows.find(
        (row) => row.resource_kind === kind && predicate(row),
      );
      if (!entry)
        throw new Error(
          `composition manifest missing ${kind}: ${JSON.stringify(rows)}`,
        );
      return entry;
    };
    requireEntry(
      'definition',
      (row) => row.resolved_version_id === definitionVersionId,
    );
    requireEntry('worker', (row) => row.resolved_version_id === worker.id);
    requireEntry(
      'environment',
      (row) => row.resolved_version_id === environment.id,
    );
    requireEntry(
      'skill',
      (row) => row.requested_ref === 'agent-server/memory-api',
    );
    requireEntry(
      'tool',
      (row) => row.requested_ref === 'agent-server/memory-read',
    );
    requireEntry(
      'platform_capability',
      (row) => row.requested_ref === 'platform_mcp',
    );

    const session = await pool.query(
      `SELECT rs.id,rs.scope_kind,rs.scope_id,
              rss.subject_kind,rss.agent_version_id,rss.worker_version_id,
              rss.environment_version_id
         FROM runtime_sessions rs
         JOIN runtime_session_specs rss
           ON rss.runtime_session_id=rs.id
          AND rss.revision=rs.desired_spec_revision
         JOIN runtime_turns rt ON rt.runtime_session_id=rs.id
         JOIN runs r ON r.id=rt.source_id::uuid
         JOIN tasks t ON t.id=r.task_id
        WHERE rt.source_kind='run' AND r.id=$1 AND t.id=$2
          AND rss.subject_kind='worker'
          AND rs.tenant_id=$3 AND rs.principal_type=$4 AND rs.principal_id=$5`,
      [
        rootRunId,
        rootTaskId,
        owner.tenant_id,
        owner.principal_type,
        owner.principal_id,
      ],
    );
    const runtimeSession = session.rows.length === 1 ? session.rows[0] : null;
    if (
      !runtimeSession ||
      runtimeSession.scope_kind !== 'run' ||
      runtimeSession.scope_id !== rootRunId ||
      runtimeSession.subject_kind !== 'worker' ||
      runtimeSession.agent_version_id !== null ||
      runtimeSession.worker_version_id !== worker.id ||
      runtimeSession.environment_version_id !== environment.id
    )
      throw new Error(
        `composition runtime session snapshot mismatch: ${JSON.stringify(session.rows)}`,
      );

    progress('composition_single_worker_verified', {
      work_id: workId,
      work_run_id: workRunId,
      root_task_id: rootTaskId,
      runtime_session_id: runtimeSession.id,
      manifest_entries: rows.length,
      runtime: `${providerRun.provider}/${providerRun.model}`,
    });
    return {
      workId,
      workRunId,
      rootTaskId,
      runtimeSessionId: runtimeSession.id,
    };
  } finally {
    await pool.end();
  }
}

export async function runCompositionSingleWorkerInlineSmoke({
  baseUrl,
  token,
  workspaceId,
  expectedProvider,
  expectedModel,
  timeoutMs = 360_000,
  progress = () => undefined,
}) {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl)
    throw new Error(
      'inline composition smoke requires a host-native DATABASE_URL',
    );
  const compositionAdmissionTimeoutMs = resolveCompositionAdmissionTimeoutMs();
  const scenarioId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const marker = `COMPOSITION_SINGLE_WORKER_INLINE_OK_${scenarioId}`;
  const triggerRef = `composition-inline-${scenarioId}`;

  async function request(
    path,
    {
      method = 'GET',
      body,
      expectedStatus,
      requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    } = {},
  ) {
    const response = await fetch(new URL(path, baseUrl), {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(method === 'POST' && !path.startsWith('/api/v1/works')
          ? {
              'idempotency-key': `inline-smoke-${scenarioId}-${randomUUID()}`,
            }
          : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
    const text = await response.text();
    const json = text ? JSON.parse(text) : {};
    if (
      expectedStatus === undefined
        ? !response.ok
        : response.status !== expectedStatus
    )
      throw new Error(
        `${method} ${path} -> ${response.status} ${JSON.stringify(json)}`,
      );
    return json;
  }

  const inlineDefinition = `apiVersion: agentserver.dev/v1alpha1
kind: WorkDefinition
metadata:
  name: composition-inline-${scenarioId}
  description: Inline Product Definition real-provider smoke (quickstart path).
spec:
  kind: single_worker

  worker:
    source: |
      apiVersion: agent-server/v1alpha1
      kind: Worker
      metadata:
        name: composition-inline-worker-${scenarioId}
      spec:
        description: Inline smoke Worker
        instructions: 'Return exactly the marker contained in the Work input. Do not call tools unless execution cannot proceed otherwise.'
        runtime:
          provider: paseo
          modelPolicyRef: free-only
          mode: isolated
        tools: []
        skills: []
        input:
          schema:
            type: object
            properties: {}
            additionalProperties: false
          prompt: "Follow the Product Work input."
        session:
          invocation: fresh_per_invocation
          followUps: queued
          binding: reusable
        memory:
          policy: workspace_snapshot
          proposalLimit: 0
        permissions:
          network: none
          filesystem: none
        completion:
          type: executable
          command: "done"

  environment:
    source: |
      apiVersion: agent-server/v1alpha1
      kind: ManagedEnvironment
      metadata:
        name: composition-inline-env-${scenarioId}
      spec:
        adapter: paseo
        provider: opencode
        modelPolicyRef: free-only
        runtimeCellPolicy: per_runtime_session

  memory_version_ids: []
  input_schema:
    type: object
    properties:
      marker:
        type: string
        min_length: 1
        max_length: 256
    required: [marker]
    additional_properties: false
`;

  progress('composition_single_worker_inline_definition_ready');

  const validated = await request('/api/v1/work-definitions:validate', {
    method: 'POST',
    body: { source: inlineDefinition },
    expectedStatus: 200,
  });
  if (validated.valid !== true || !validated.fingerprint)
    throw new Error(`inline validate failed: ${JSON.stringify(validated)}`);

  const planned = await request('/api/v1/work-definitions:plan', {
    method: 'POST',
    body: { source: inlineDefinition },
    expectedStatus: 200,
  });
  const planMat = planned.resolved?.materialization;
  if (
    !planMat ||
    typeof planMat.inline_workers !== 'number' ||
    planMat.inline_workers < 1 ||
    planMat.inline_environment !== true
  )
    throw new Error(
      `inline plan materialization unexpected: ${JSON.stringify(planMat)}`,
    );

  const applied = await request('/api/v1/work-definitions:apply', {
    method: 'POST',
    body: { source: inlineDefinition },
    expectedStatus: 201,
  });
  const definitionId = applied.definition?.id;
  const definitionVersionId = applied.version?.id;
  if (
    typeof definitionId !== 'string' ||
    typeof definitionVersionId !== 'string' ||
    applied.version?.fingerprint !== validated.fingerprint ||
    !applied.resolved?.resource_manifest_fingerprint
  )
    throw new Error(`inline apply invalid: ${JSON.stringify(applied)}`);

  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const workspace = await pool.query(
      `SELECT tenant_id,principal_type,principal_id
         FROM workspaces WHERE id=$1`,
      [workspaceId],
    );
    const owner = workspace.rows[0];
    if (!owner)
      throw new Error(`inline smoke workspace missing: ${workspaceId}`);

    const created = await request('/api/v1/works', {
      method: 'POST',
      body: {
        definition_id: definitionId,
        definition_version_id: definitionVersionId,
        title: `Composition inline ${scenarioId}`,
      },
      expectedStatus: 201,
    });
    const workId = created.work?.id;
    if (typeof workId !== 'string')
      throw new Error('inline smoke Work id missing');

    let started;
    try {
      started = await request(`/api/v1/works/${workId}/runs`, {
        method: 'POST',
        body: {
          trigger_kind: 'manual',
          trigger_ref: triggerRef,
          input: { marker },
        },
        expectedStatus: 202,
        requestTimeoutMs: compositionAdmissionTimeoutMs,
      });
    } catch (error) {
      if (isCompositionAdmissionAbort(error)) {
        const diagnostic = await collectCompositionAdmissionAbortDiagnostic({
          request,
          workId,
          triggerRef,
          error,
        });
        progress(
          'composition_single_worker_inline_admission_aborted',
          diagnostic,
        );
        throw new Error(
          `inline WorkRun admission ${diagnostic.admission_error}: state=${diagnostic.state} lookup=${diagnostic.lookup}`,
          { cause: error },
        );
      }
      throw error;
    }
    const workRunId = started.work_run?.id;
    const rootTaskId = started.execution_receipt?.source_refs?.task_id;
    if (typeof workRunId !== 'string' || typeof rootTaskId !== 'string')
      throw new Error('inline smoke WorkRun identities missing');
    const rootRuns = await pool.query(
      `SELECT r.id FROM runs r
         JOIN tasks t ON t.id=r.task_id
        WHERE r.task_id=$1 AND t.tenant_id=$2 AND t.workspace_id=$3
          AND t.principal_type=$4 AND t.principal_id=$5`,
      [
        rootTaskId,
        owner.tenant_id,
        workspaceId,
        owner.principal_type,
        owner.principal_id,
      ],
    );
    if (rootRuns.rows.length !== 1)
      throw new Error(
        `inline root Run provenance mismatch: ${JSON.stringify(rootRuns.rows)}`,
      );
    const rootRunId = rootRuns.rows[0].id;
    progress('composition_single_worker_inline_started', {
      work_id: workId,
      work_run_id: workRunId,
    });

    const deadline = Date.now() + timeoutMs;
    let projection;
    while (Date.now() < deadline) {
      const response = await fetch(
        new URL(`/api/v1/works/${workId}/runs/${workRunId}`, baseUrl),
        {
          headers: {
            authorization: `Bearer ${token}`,
            accept: 'application/json',
          },
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (response.status === 503) {
        await pause(1_000);
        continue;
      }
      if (!response.ok)
        throw new Error(`inline WorkRun projection -> ${response.status}`);
      projection = await response.json();
      const state = projection.work_run?.product_state;
      if (state === 'running') {
        await pause(1_000);
        continue;
      }
      if (state === 'complete') break;
      // Fetch trace + run events before throwing so the failure is diagnosable in CI.
      let failTrace = null;
      let failRunEvents = null;
      try {
        const traceResp = await fetch(
          new URL(`/api/v1/works/${workId}/runs/${workRunId}/trace`, baseUrl),
          {
            headers: {
              authorization: `Bearer ${token}`,
              accept: 'application/json',
            },
            signal: AbortSignal.timeout(10_000),
          },
        );
        if (traceResp.ok) {
          failTrace = await traceResp.json();
          const technicalRunId = failTrace?.runs?.[0]?.source_refs?.run_id;
          if (technicalRunId) {
            const eventsResp = await fetch(
              new URL(
                `/api/v1/runs/${encodeURIComponent(technicalRunId)}/events`,
                baseUrl,
              ),
              {
                headers: {
                  authorization: `Bearer ${token}`,
                  accept: 'application/json',
                },
                signal: AbortSignal.timeout(10_000),
              },
            );
            if (eventsResp.ok) failRunEvents = await eventsResp.json();
          }
        }
      } catch {
        /* best-effort */
      }
      progress('composition_single_worker_inline_failed_trace', {
        work_run: projection.work_run,
        trace: failTrace,
        run_events: failRunEvents,
      });
      throw new Error(
        `inline WorkRun terminal state ${JSON.stringify(projection.work_run)} trace=${JSON.stringify(failTrace)}`,
      );
    }
    if (projection?.work_run?.product_state !== 'complete')
      throw new Error('inline single-Worker WorkRun timed out');

    const trace = await request(
      `/api/v1/works/${workId}/runs/${workRunId}/trace`,
      { expectedStatus: 200 },
    );
    const providerRuns = (Array.isArray(trace.runs) ? trace.runs : []).filter(
      (run) => run.provider !== null && run.model !== null,
    );
    if (providerRuns.length !== 1)
      throw new Error(
        `inline trace expected one provider Run, got ${providerRuns.length}`,
      );
    const providerRun = providerRuns[0];
    if (
      providerRun.provider !== expectedProvider ||
      providerRun.model !== expectedModel
    )
      throw new Error(
        `inline runtime mismatch: ${providerRun.provider}/${providerRun.model}`,
      );
    const technicalRun = await request(
      `/api/v1/runs/${encodeURIComponent(providerRun.source_refs.run_id)}`,
      { expectedStatus: 200 },
    );
    if (technicalRun.result?.text?.trim() !== marker)
      throw new Error(
        `inline runtime result mismatch: ${JSON.stringify(technicalRun.result)}`,
      );
    if (
      !(technicalRun.usage?.input_tokens > 0) ||
      !(technicalRun.usage?.output_tokens > 0)
    )
      throw new Error('inline runtime usage was not captured');

    const manifest = await pool.query(
      `SELECT resource_kind,requested_ref,resolved_version_id,resolved_fingerprint,slot
         FROM work_run_resource_manifest
        WHERE work_run_id=$1 ORDER BY slot`,
      [workRunId],
    );
    const rows = manifest.rows;
    const requireEntry = (kind, predicate) => {
      const entry = rows.find(
        (row) => row.resource_kind === kind && predicate(row),
      );
      if (!entry)
        throw new Error(
          `inline manifest missing ${kind}: ${JSON.stringify(rows)}`,
        );
      return entry;
    };
    requireEntry(
      'definition',
      (row) => row.resolved_version_id === definitionVersionId,
    );
    const workerEntry = requireEntry(
      'worker',
      (row) => typeof row.resolved_version_id === 'string',
    );
    const environmentEntry = requireEntry(
      'environment',
      (row) => typeof row.resolved_version_id === 'string',
    );

    const session = await pool.query(
      `SELECT rs.id,rs.scope_kind,rs.scope_id,
              rss.subject_kind,rss.agent_version_id,rss.worker_version_id,
              rss.environment_version_id
         FROM runtime_sessions rs
         JOIN runtime_session_specs rss
           ON rss.runtime_session_id=rs.id
          AND rss.revision=rs.desired_spec_revision
         JOIN runtime_turns rt ON rt.runtime_session_id=rs.id
         JOIN runs r ON r.id=rt.source_id::uuid
         JOIN tasks t ON t.id=r.task_id
        WHERE rt.source_kind='run' AND r.id=$1 AND t.id=$2
          AND rss.subject_kind='worker'
          AND rs.tenant_id=$3 AND rs.principal_type=$4 AND rs.principal_id=$5`,
      [
        rootRunId,
        rootTaskId,
        owner.tenant_id,
        owner.principal_type,
        owner.principal_id,
      ],
    );
    const runtimeSession = session.rows.length === 1 ? session.rows[0] : null;
    if (
      !runtimeSession ||
      runtimeSession.scope_kind !== 'run' ||
      runtimeSession.scope_id !== rootRunId ||
      runtimeSession.subject_kind !== 'worker' ||
      runtimeSession.agent_version_id !== null ||
      runtimeSession.worker_version_id !== workerEntry.resolved_version_id ||
      runtimeSession.environment_version_id !==
        environmentEntry.resolved_version_id
    )
      throw new Error(
        `inline runtime session snapshot mismatch: ${JSON.stringify(session.rows)}`,
      );

    progress('composition_single_worker_inline_verified', {
      work_id: workId,
      work_run_id: workRunId,
      root_task_id: rootTaskId,
      runtime_session_id: runtimeSession.id,
      manifest_entries: rows.length,
      runtime: `${providerRun.provider}/${providerRun.model}`,
      materialization: {
        inline_workers: planMat.inline_workers,
        inline_environment: planMat.inline_environment,
      },
    });
    return {
      workId,
      workRunId,
      rootTaskId,
      runtimeSessionId: runtimeSession.id,
    };
  } finally {
    await pool.end();
  }
}
