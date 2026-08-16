import { randomUUID } from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runCompositionSingleAgentSmoke({
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
    throw new Error('composition smoke requires DATABASE_URL from local-env');
  const scenarioId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const marker = `COMPOSITION_SINGLE_AGENT_OK_${scenarioId}`;

  async function request(path, { method = 'GET', body, expectedStatus } = {}) {
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
      signal: AbortSignal.timeout(10_000),
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

  progress('composition_product_definition_authoring');
  const publicDefinition = `apiVersion: agentserver.dev/v1alpha1
kind: WorkDefinition
metadata:
  name: composition-single-${scenarioId}
  description: Real-provider one-file Product Definition to Work to Run smoke.
spec:
  kind: single_agent
  agent:
    source: |
      apiVersion: agent-server/v1alpha1
      kind: ManagedAgent
      metadata:
        name: composition-agent-${scenarioId}
      spec:
        description: Inline Agent materialized by Work Definition apply.
        instructions: 'Return exactly the marker contained in the Product Work input. Do not call tools unless execution cannot proceed otherwise.'
        runtime:
          provider: paseo
          modelPolicyRef: free-only
          mode: isolated
        tools:
          - ref: agent-server/memory-read
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
  environment:
    source: |
      apiVersion: agent-server/v1alpha1
      kind: ManagedEnvironment
      metadata:
        name: composition-environment-${scenarioId}
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

  const validated = await request('/api/v1/work-definitions:validate', {
    method: 'POST',
    body: { source: publicDefinition },
    expectedStatus: 200,
  });
  if (validated.valid !== true || !validated.fingerprint)
    throw new Error(
      `composition Product Definition validation failed: ${JSON.stringify(validated)}`,
    );

  const planned = await request('/api/v1/work-definitions:plan', {
    method: 'POST',
    body: { source: publicDefinition },
    expectedStatus: 200,
  });
  if (
    planned.resolved?.participants?.[0]?.source !== 'inline' ||
    planned.resolved?.environment?.source !== 'inline' ||
    planned.resolved?.materialization?.inline_agents !== 1 ||
    planned.resolved?.materialization?.inline_environment !== true
  )
    throw new Error(
      `composition Product Definition plan mismatch: ${JSON.stringify(planned)}`,
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

    const invalid = await request(`/api/v1/works/${workId}/runs`, {
      method: 'POST',
      body: { trigger_kind: 'manual', input: {} },
      expectedStatus: 422,
    });
    if (invalid.error?.code !== 'input_validation_failed')
      throw new Error(
        `composition invalid Product input was not rejected: ${JSON.stringify(invalid)}`,
      );

    const started = await request(`/api/v1/works/${workId}/runs`, {
      method: 'POST',
      body: {
        trigger_kind: 'manual',
        input: { marker },
      },
      expectedStatus: 202,
    });
    const workRunId = started.work_run?.id;
    const rootTaskId = started.execution_receipt?.source_refs?.task_id;
    if (typeof workRunId !== 'string' || typeof rootTaskId !== 'string')
      throw new Error('composition smoke WorkRun identities missing');
    progress('composition_single_agent_started', {
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
      throw new Error('composition single-Agent WorkRun timed out');

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
    const agentEntry = requireEntry('agent', () => true);
    const environmentEntry = requireEntry('environment', () => true);
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
      `SELECT id,scope_kind,scope_id,task_id,agent_version_id,environment_version_id
         FROM runtime_sessions
        WHERE task_id=$1 AND tenant_id=$2 AND principal_type=$3 AND principal_id=$4`,
      [rootTaskId, owner.tenant_id, owner.principal_type, owner.principal_id],
    );
    const runtimeSession = session.rows[0];
    if (
      !runtimeSession ||
      runtimeSession.scope_kind !== 'task' ||
      runtimeSession.scope_id !== rootTaskId ||
      runtimeSession.agent_version_id !== agentEntry.resolved_version_id ||
      runtimeSession.environment_version_id !==
        environmentEntry.resolved_version_id
    )
      throw new Error(
        `composition runtime session snapshot mismatch: ${JSON.stringify(runtimeSession)}`,
      );

    progress('composition_single_agent_verified', {
      work_id: workId,
      work_run_id: workRunId,
      root_task_id: rootTaskId,
      runtime_session_id: runtimeSession.id,
      manifest_entries: rows.length,
      runtime: `${providerRun.provider}/${providerRun.model}`,
      authoring: 'one_file_definition',
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
