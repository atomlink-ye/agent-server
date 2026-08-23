import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';

import { AGENT_SERVER_SYNTHETIC_STOCK_SNAPSHOT_TOOL_REF } from '../../src/application/agents/built-in-skills.js';
import type { ExecutionMcpServerConfig } from '../../src/application/ports/runtime-extension-binding.js';
import { createApplication } from '../../src/composition/create-application.js';
import { SYNTHETIC_MARKET_FIXTURE_REF } from '../../src/adapters/demo-market/synthetic-market-adapter.js';
import type { PaseoSdkClient as PaseoSdkClientImplementation } from '../../src/adapters/paseo/paseo-sdk-client.js';
import type {
  PaseoClientPort,
  PaseoCreatedAgent,
  PaseoFinishedAgent,
} from '../../src/adapters/paseo/paseo-client-port.js';
import type { PaseoModelDescriptor } from '../../src/adapters/paseo/model-selector.js';
import type { ManagedEnvironmentProvider } from '../../src/domain/environments/managed-environment-package.js';
import { buildTurnPrompt } from '../../src/application/context/runtime-prompts.js';
import { createLogger } from '../../src/shared/observability/logger.js';
import { loadConfig } from '../../src/shared/config.js';
import { seedCanonicalPublishedAgent } from '../fixtures/canonical-agent.js';
import {
  createRealPostgresTestDatabase,
  type RealPostgresTestDatabase,
} from '../harness/postgres.js';

type CapturedAgentInput = Readonly<{
  systemPrompt: string;
  initialPrompt: string;
  mcpServers?: readonly ExecutionMcpServerConfig[];
}>;

type PaseoCreateAgentInput = Parameters<PaseoClientPort['createAgent']>[0];
type PaseoSdkClientOptions = ConstructorParameters<
  typeof PaseoSdkClientImplementation
>[0];
type SentAgentMessage = Readonly<{ agentId: string; text: string }>;
type FinishedAgent = PaseoFinishedAgent;

const paseo = vi.hoisted(() => {
  let resolveWaitStarted!: () => void;
  let resolveFinish!: (value: FinishedAgent) => void;
  const waitStarted = new Promise<void>((resolve) => {
    resolveWaitStarted = resolve;
  });
  const finished = new Promise<FinishedAgent>((resolve) => {
    resolveFinish = resolve;
  });
  return {
    agentInputs: [] as CapturedAgentInput[],
    createdAgents: [] as PaseoCreatedAgent[],
    sendAgentMessageCalls: [] as SentAgentMessage[],
    waitStarted,
    finished,
    markWaitStarted: resolveWaitStarted,
    complete: () =>
      resolveFinish({
        status: 'idle',
        error: null,
        lastMessage: 'NORTH_STAR_OK',
        usage: { inputTokens: 4, outputTokens: 3, totalCostUsd: 0 },
      }),
  };
});

vi.mock(import('../../src/adapters/paseo/paseo-sdk-client.js'), async () => {
  const actual = await vi.importActual<
    typeof import('../../src/adapters/paseo/paseo-sdk-client.js')
  >('../../src/adapters/paseo/paseo-sdk-client.js');

  class PaseoSdkClient
    extends actual.PaseoSdkClient
    implements PaseoClientPort
  {
    public constructor(_options: PaseoSdkClientOptions) {
      super(_options);
    }

    public async connect(): Promise<void> {}

    public connectionStatus(): string {
      return 'connected';
    }

    public async openWorkspace(_cwd: string): Promise<string> {
      return 'north-star-provider-workspace';
    }

    public async createIndependentWorkspace(_cwd: string): Promise<string> {
      return 'north-star-provider-workspace';
    }

    public async setWorkspaceTitle(
      _workspaceId: string,
      _title: string,
    ): Promise<void> {}

    public async listModels(
      _provider: ManagedEnvironmentProvider,
      _cwd: string,
    ): Promise<readonly PaseoModelDescriptor[]> {
      return [
        {
          id: 'opencode/deepseek-v4-flash-free',
          label: 'DeepSeek V4 Flash Free',
        },
      ];
    }

    public async createAgent(
      input: PaseoCreateAgentInput,
    ): Promise<PaseoCreatedAgent> {
      paseo.agentInputs.push({
        systemPrompt: input.systemPrompt,
        initialPrompt: input.initialPrompt,
        ...(input.mcpServers ? { mcpServers: input.mcpServers } : {}),
      });
      const createdAgent: PaseoCreatedAgent = {
        id: 'north-star-provider-session',
        provider: 'opencode',
        model: 'opencode/deepseek-v4-flash-free',
      };
      paseo.createdAgents.push(createdAgent);
      return createdAgent;
    }

    public async sendAgentMessage(
      agentId: string,
      text: string,
    ): Promise<void> {
      paseo.sendAgentMessageCalls.push({ agentId, text });
    }

    public async waitForFinish(
      _agentId: string,
      _timeoutMs: number,
    ): Promise<FinishedAgent> {
      paseo.markWaitStarted();
      return paseo.finished;
    }

    public async close(): Promise<void> {}
  }

  return { PaseoSdkClient } satisfies typeof actual;
});

const serviceAccountId = 'north-star-service-account';
const serviceAccountToken = 'north-star-service-account-token';
const tenantId = 'north-star-tenant';
const policyVersion = 'north-star-policy-v1';
const authorizationHeaders = {
  authorization: `Bearer ${serviceAccountToken}`,
  'content-type': 'application/json',
} as const;
const formalMessageInput = {
  text: 'Execute the durable runtime turn.',
} as const;
const expectedDeliveredTurnPrompt = buildTurnPrompt({
  taskInput: formalMessageInput.text,
  memory: null,
});

interface ScenarioState {
  workspaceId: string;
  environmentVersionId: string;
  agentVersionId: string;
  sessionId: string;
  runId: string;
  runtimeSession: Readonly<Record<string, unknown>>;
  runtimeSpec: Readonly<Record<string, unknown>>;
  generation: Readonly<Record<string, unknown>>;
  grant: Readonly<Record<string, unknown>>;
  turn: Readonly<Record<string, unknown>>;
  mcpTools: readonly string[];
  mcpCallText: string;
  runResponse: Readonly<Record<string, unknown>>;
}

let database: RealPostgresTestDatabase | undefined;
let application: Awaited<ReturnType<typeof createApplication>> | undefined;
let state: ScenarioState | undefined;
const executionLogs: string[] = [];

describe('North Star production runtime authority', () => {
  beforeAll(async () => {
    database = await createRealPostgresTestDatabase();
    const workspaceId = randomUUID();
    const environmentDefinitionId = randomUUID();
    const environmentVersionId = randomUUID();
    const agentDefinitionId = randomUUID();
    const agentVersionId = randomUUID();
    const now = new Date('2026-08-24T00:00:00.000Z');

    await seedWorkspace(database.pool, workspaceId, now);
    await seedEnvironment(
      database.pool,
      workspaceId,
      environmentDefinitionId,
      environmentVersionId,
      now,
    );
    await seedCanonicalPublishedAgent(
      database.pool,
      {
        tenantId,
        workspaceId,
        principalType: 'service_account',
        principalId: serviceAccountId,
        policySnapshotVersion: policyVersion,
      },
      {
        definitionId: agentDefinitionId,
        versionId: agentVersionId,
        name: 'North Star Runtime Agent',
        description: 'Exercises the production runtime authority graph.',
        instructions: 'Use the synthetic stock tool when it is available.',
        toolRefs: [AGENT_SERVER_SYNTHETIC_STOCK_SNAPSHOT_TOOL_REF],
        now,
      },
    );

    const root = join(tmpdir(), `agent-server-north-star-${randomUUID()}`);
    const config = loadConfig(
      {
        NODE_ENV: 'test',
        HOST: '127.0.0.1',
        PORT: '3000',
        LOG_LEVEL: 'error',
        SERVICE_NAME: 'agent-server-north-star',
        AGENT_SERVER_DIRECT_CHAT_PLANE: 'absent',
        AGENT_SERVER_PRODUCT_WORK_PLANE: 'absent',
        RUNTIME_ADAPTER: 'paseo',
        RUNTIME_MCP_LISTEN_HOST: '127.0.0.1',
        RUNTIME_MCP_ADVERTISED_HOST: '127.0.0.1',
        PASEO_WS_URL: 'ws://127.0.0.1:6767/ws',
        PASEO_PROVIDER: 'opencode',
        PASEO_AGENT_CWD: join(root, 'provider'),
        PASEO_RUNTIME_CELL_ROOT: join(root, 'runtime-cells'),
        AGENT_SERVER_SKILL_REGISTRY_ROOT: join(root, 'skills'),
        PASEO_WORKSPACE_TITLE: 'North Star Runtime',
        PASEO_CONNECT_TIMEOUT_MS: '1000',
        PASEO_EXECUTION_TIMEOUT_MS: '30000',
        PASEO_SESSION_RPC_TIMEOUT_MS: '30000',
        AGENT_SERVER_DISPATCHER_CONCURRENCY: '1',
        SERVICE_ACCOUNTS_JSON: JSON.stringify([
          {
            serviceAccountId,
            token: serviceAccountToken,
            tenantId,
            workspaceId,
            policyVersion,
            disabled: false,
          },
        ]),
      },
      root,
    );
    const logger = createLogger({
      service: config.serviceName,
      minimumLevel: 'error',
      write: (line) => executionLogs.push(line),
    });
    application = await createApplication(config, logger, {
      database: database.pool,
      singleRunDebug: true,
    });

    const sessionResponse = await application.app.request('/api/v1/sessions', {
      method: 'POST',
      headers: authorizationHeaders,
      body: JSON.stringify({
        workspace_id: workspaceId,
        agent_version_id: agentVersionId,
        environment_version_id: environmentVersionId,
      }),
    });
    assertStatus(sessionResponse, 201, 'create Product Session');
    const sessionBody = await responseObject(sessionResponse);
    const sessionId = requiredString(sessionBody, 'session_id');

    const messageResponse = await application.app.request(
      `/api/v1/sessions/${sessionId}/messages`,
      {
        method: 'POST',
        headers: {
          ...authorizationHeaders,
          'idempotency-key': `north-star-runtime-${randomUUID()}`,
        },
        body: JSON.stringify(formalMessageInput),
      },
    );
    assertStatus(messageResponse, 202, 'submit Product Session message');
    const messageBody = await responseObject(messageResponse);
    const runId = requiredString(messageBody, 'run_id');

    const execution = application.singleRunDebug?.claimAndExecute(runId);
    if (!execution) throw new Error('single-run debug control is unavailable');
    await withTimeout(
      Promise.race([
        paseo.waitStarted,
        execution.then(
          async (result) => {
            const diagnostics = await database!.pool.query<
              Record<string, unknown>
            >(
              `SELECT r.*, t.status AS task_status
                 FROM runs r
                 JOIN tasks t ON t.id=r.task_id
                WHERE r.id=$1`,
              [runId],
            );
            const events = await database!.pool.query<Record<string, unknown>>(
              `SELECT type,payload FROM run_events WHERE run_id=$1 ORDER BY sequence`,
              [runId],
            );
            throw new Error(
              `Run ended before provider start: ${JSON.stringify({ result, run: diagnostics.rows, events: events.rows, logs: executionLogs })}`,
            );
          },
          (error: unknown) => {
            throw error;
          },
        ),
      ]),
      10_000,
      'provider turn did not start',
    );
    await waitForTurnStatus(database.pool, runId, 'running');

    const providerInput = paseo.agentInputs[0];
    if (!providerInput)
      throw new Error('production provider did not create an agent');
    const mcp = providerInput.mcpServers?.[0];
    if (!mcp)
      throw new Error('production provider did not receive an MCP binding');
    const mcpEvidence = await exerciseMcp(mcp);

    paseo.complete();
    const executionResult = await withTimeout(
      execution,
      10_000,
      'claimed Run did not complete',
    );
    if (
      !executionResult.claimed ||
      executionResult.terminalStatus !== 'succeeded'
    )
      throw new Error(
        `single-run execution did not succeed: ${JSON.stringify(executionResult)}`,
      );
    const runResponse = await waitForRun(application, runId);

    const runtimeSession = await oneRow(
      database.pool,
      `SELECT id,scope_kind,scope_id,tenant_id,workspace_id,principal_type,
              principal_id,status,current_generation_id
         FROM runtime_sessions
        WHERE scope_kind='product_session' AND scope_id=$1`,
      [sessionId],
    );
    const runtimeSpec = await oneRow(
      database.pool,
      `SELECT runtime_session_id,revision,agent_version_id,environment_version_id,
              system_prompt_digest,tool_catalog_digest,extension_set_digest
         FROM runtime_session_specs
        WHERE runtime_session_id=$1`,
      [requiredString(runtimeSession, 'id')],
    );
    const generation = await oneRow(
      database.pool,
      `SELECT id,runtime_session_id,generation,provider,status,
              provider_workspace_id,provider_session_id
         FROM runtime_session_generations
        WHERE runtime_session_id=$1`,
      [requiredString(runtimeSession, 'id')],
    );
    const grant = await oneRow(
      database.pool,
      `SELECT id,runtime_session_id,generation_id,runtime_turn_id,
              allowed_tools,revoked_at
         FROM runtime_tool_grants
        WHERE runtime_session_id=$1`,
      [requiredString(runtimeSession, 'id')],
    );
    const turn = await oneRow(
      database.pool,
      `SELECT id,runtime_session_id,generation_id,source_kind,source_id,
              status,prompt_digest
         FROM runtime_turns
        WHERE source_kind='run' AND source_id=$1`,
      [runId],
    );

    state = {
      workspaceId,
      environmentVersionId,
      agentVersionId,
      sessionId,
      runId,
      runtimeSession,
      runtimeSpec,
      generation,
      grant,
      turn,
      mcpTools: mcpEvidence.tools,
      mcpCallText: mcpEvidence.callText,
      runResponse,
    };
  }, 30_000);

  afterAll(async () => {
    paseo.complete();
    if (application) await application.close();
    else if (database) await database.dispose();
  });

  it('creates the product-session RuntimeSession under the authenticated owner', () => {
    const current = scenario();
    expect(current.runtimeSession).toMatchObject({
      scope_kind: 'product_session',
      scope_id: current.sessionId,
      tenant_id: tenantId,
      workspace_id: current.workspaceId,
      principal_type: 'service_account',
      principal_id: serviceAccountId,
      status: 'ready',
    });
  });

  it('persists the exact desired system-prompt digest in the immutable spec', () => {
    const current = scenario();
    const providerInput = paseo.agentInputs[0];
    if (!providerInput) throw new Error('provider input missing');
    expect(providerInput.systemPrompt).toContain(
      'Use the synthetic stock tool when it is available.',
    );
    expect(current.runtimeSpec).toMatchObject({
      runtime_session_id: current.runtimeSession.id,
      agent_version_id: current.agentVersionId,
      environment_version_id: current.environmentVersionId,
      system_prompt_digest: createHash('sha256')
        .update(providerInput.systemPrompt, 'utf8')
        .digest('hex'),
    });
  });

  it('activates one provider generation owned by that RuntimeSession', () => {
    const current = scenario();
    const createdAgent = paseo.createdAgents[0];
    if (!createdAgent) throw new Error('provider create result missing');
    expect(current.generation).toMatchObject({
      runtime_session_id: current.runtimeSession.id,
      generation: 1,
      provider: 'opencode',
      status: 'active',
      provider_workspace_id: 'north-star-provider-workspace',
      provider_session_id: 'north-star-provider-session',
    });
    expect(current.generation.provider_session_id).toBe(createdAgent.id);
    expect(current.runtimeSession.current_generation_id).toBe(
      current.generation.id,
    );
  });

  it('authorizes MCP discovery and invocation through the durable turn grant', () => {
    const current = scenario();
    expect(current.grant).toMatchObject({
      runtime_session_id: current.runtimeSession.id,
      generation_id: current.generation.id,
      runtime_turn_id: current.turn.id,
      revoked_at: null,
    });
    expect(current.grant.allowed_tools).toContain(
      AGENT_SERVER_SYNTHETIC_STOCK_SNAPSHOT_TOOL_REF,
    );
    expect(current.mcpTools).toContain('synthetic_stock_snapshot');
    expect(current.mcpCallText).toContain('101.25');
  });

  it('completes a RuntimeTurn with session, generation, and Run identity', () => {
    const current = scenario();
    const createdAgent = paseo.createdAgents[0];
    if (!createdAgent) throw new Error('provider create result missing');
    const sentMessage = paseo.sendAgentMessageCalls[0];
    if (!sentMessage) throw new Error('provider message call missing');
    expect(paseo.sendAgentMessageCalls).toEqual([
      { agentId: createdAgent.id, text: expectedDeliveredTurnPrompt },
    ]);
    expect(current.turn).toMatchObject({
      runtime_session_id: current.runtimeSession.id,
      generation_id: current.generation.id,
      source_kind: 'run',
      source_id: current.runId,
      status: 'succeeded',
    });
    expect(current.turn.prompt_digest).toBe(
      createHash('sha256').update(sentMessage.text, 'utf8').digest('hex'),
    );
  });

  it('returns the provider result through the formal Run completion path', () => {
    expect(scenario().runResponse).toMatchObject({
      status: 'succeeded',
      result: { text: 'NORTH_STAR_OK' },
    });
  });
});

function scenario(): ScenarioState {
  if (!state) throw new Error('north-star scenario did not initialize');
  return state;
}

async function seedWorkspace(
  pool: Pool,
  workspaceId: string,
  now: Date,
): Promise<void> {
  await pool.query(
    `INSERT INTO workspaces(
       id,tenant_id,principal_type,principal_id,name,created_at,updated_at
     ) VALUES($1,$2,'service_account',$3,$4,$5,$5)`,
    [workspaceId, tenantId, serviceAccountId, 'North Star Workspace', now],
  );
}

async function seedEnvironment(
  pool: Pool,
  workspaceId: string,
  definitionId: string,
  versionId: string,
  now: Date,
): Promise<void> {
  await pool.query(
    `INSERT INTO environment_definitions(
       id,tenant_id,principal_type,principal_id,normalized_name,display_name,
       created_at,updated_at
     ) VALUES($1,$2,'service_account',$3,$4,$5,$6,$6)`,
    [
      definitionId,
      tenantId,
      serviceAccountId,
      `north-star-${definitionId}`,
      'North Star Environment',
      now,
    ],
  );
  await pool.query(
    `INSERT INTO environment_versions(
       id,definition_id,tenant_id,principal_type,principal_id,status,
       display_name,canonical_package,fingerprint,created_at,updated_at,published_at
     ) VALUES($1,$2,$3,'service_account',$4,'published',$5,$6,$7,$8,$8,$8)`,
    [
      versionId,
      definitionId,
      tenantId,
      serviceAccountId,
      'North Star Environment',
      {
        apiVersion: 'agent-server/v1alpha1',
        kind: 'ManagedEnvironment',
        metadata: { name: `north-star-${workspaceId}` },
        spec: {
          adapter: 'paseo',
          provider: 'opencode',
          modelPolicyRef: 'free-only',
          runtimeCellPolicy: 'per_runtime_session',
        },
      },
      `sha256:${createHash('sha256').update(versionId).digest('hex')}`,
      now,
    ],
  );
}

async function waitForTurnStatus(
  pool: Pool,
  runId: string,
  status: string,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await pool.query<{ status: string }>(
      `SELECT status FROM runtime_turns WHERE source_kind='run' AND source_id=$1`,
      [runId],
    );
    if (result.rows[0]?.status === status) return;
    await delay(20);
  }
  throw new Error(`runtime turn did not reach ${status}`);
}

async function waitForRun(
  currentApplication: Awaited<ReturnType<typeof createApplication>>,
  runId: string,
): Promise<Readonly<Record<string, unknown>>> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const response = await currentApplication.app.request(
      `/api/v1/runs/${runId}`,
      { headers: authorizationHeaders },
    );
    assertStatus(response, 200, 'read Run');
    const body = await responseObject(response);
    if (body.status === 'succeeded') return body;
    if (['failed', 'cancelled', 'timed_out'].includes(String(body.status)))
      throw new Error(`north-star Run ended as ${String(body.status)}`);
    await delay(20);
  }
  throw new Error('north-star Run did not finish');
}

async function exerciseMcp(
  server: ExecutionMcpServerConfig,
): Promise<{ readonly tools: readonly string[]; readonly callText: string }> {
  const initialized = await mcpRequest(server, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'north-star-scenario', version: '1.0.0' },
    },
  });
  const sessionId = initialized.sessionId;
  if (!sessionId) throw new Error('MCP initialize did not return a session id');

  await mcpRequest(
    server,
    {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
      params: {},
    },
    sessionId,
    false,
  );
  const listed = await mcpRequest(
    server,
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    sessionId,
  );
  const tools = readToolNames(listed.body);
  const called = await mcpRequest(
    server,
    {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'synthetic_stock_snapshot',
        arguments: {
          fixture_ref: SYNTHETIC_MARKET_FIXTURE_REF,
          symbol: 'ACME',
        },
      },
    },
    sessionId,
  );
  return { tools, callText: JSON.stringify(called.body) };
}

async function mcpRequest(
  server: ExecutionMcpServerConfig,
  body: Readonly<Record<string, unknown>>,
  sessionId?: string,
  parseBody = true,
): Promise<{
  readonly sessionId: string | null;
  readonly body: Readonly<Record<string, unknown>>;
}> {
  const response = await fetch(server.url, {
    method: 'POST',
    headers: {
      ...server.headers,
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok)
    throw new Error(
      `MCP request failed (${response.status}): ${await response.text()}`,
    );
  const responseBody = parseBody
    ? await parseMcpBody(response)
    : Object.freeze({});
  return {
    sessionId: response.headers.get('mcp-session-id'),
    body: responseBody,
  };
}

async function parseMcpBody(
  response: Response,
): Promise<Readonly<Record<string, unknown>>> {
  const text = await response.text();
  const data = response.headers
    .get('content-type')
    ?.includes('text/event-stream')
    ? text
        .split('\n')
        .find((line) => line.startsWith('data:'))
        ?.slice('data:'.length)
        .trim()
    : text;
  if (!data) throw new Error('MCP response body is empty');
  const parsed: unknown = JSON.parse(data);
  if (!isRecord(parsed)) throw new Error('MCP response is not an object');
  if (parsed.error)
    throw new Error(`MCP response error: ${JSON.stringify(parsed.error)}`);
  return parsed;
}

function readToolNames(
  body: Readonly<Record<string, unknown>>,
): readonly string[] {
  const result = body.result;
  if (!isRecord(result) || !Array.isArray(result.tools))
    throw new Error('MCP tools/list result is invalid');
  return result.tools.map((tool) => {
    if (!isRecord(tool) || typeof tool.name !== 'string')
      throw new Error('MCP tool descriptor is invalid');
    return tool.name;
  });
}

async function oneRow(
  pool: Pool,
  sql: string,
  values: readonly unknown[],
): Promise<Readonly<Record<string, unknown>>> {
  const result = await pool.query<Record<string, unknown>>(sql, [...values]);
  if (result.rows.length !== 1)
    throw new Error(`expected one row, received ${result.rows.length}`);
  return result.rows[0]!;
}

async function responseObject(
  response: Response,
): Promise<Readonly<Record<string, unknown>>> {
  const value: unknown = await response.json();
  if (!isRecord(value)) throw new Error('HTTP response is not an object');
  return value;
}

function requiredString(
  value: Readonly<Record<string, unknown>>,
  key: string,
): string {
  const candidate = value[key];
  if (typeof candidate !== 'string' || candidate.length === 0)
    throw new Error(`required string ${key} is missing`);
  return candidate;
}

function assertStatus(
  response: Response,
  expected: number,
  label: string,
): void {
  if (response.status !== expected)
    throw new Error(
      `${label} returned ${response.status}, expected ${expected}`,
    );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
