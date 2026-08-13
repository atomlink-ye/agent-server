import { randomUUID } from 'node:crypto';

import { serve, type ServerType } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

import { PostgresExecutionFactQuery } from '../../src/infrastructure/postgres/postgres-execution-fact-query.js';
import {
  applyDurableKernelMigrations,
  createPostgresPool,
} from '../../src/infrastructure/postgres/postgres.js';
import { ErrorResponseSchema } from '../../src/contracts/http.js';
import type { AppConfig } from '../../src/shared/config.js';
import { createApp } from '../../src/entrypoints/api/app.js';
import { createWorkModule } from '../../src/modules/work/work-module.js';
import { AGENT_SERVER_PRODUCT_WORK_CREATE_TOOL_REF } from '../../src/application/agents/built-in-skills.js';
import { RuntimeMcpServer } from '../../src/infrastructure/extensions/runtime-mcp-server.js';

const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
const required = process.env.REAL_POSTGRES_REQUIRED === '1';
if (required && !connectionString)
  throw new Error(
    'REAL_POSTGRES_REQUIRED=1 requires DATABASE_URL or POSTGRES_URL',
  );

const describeRealPostgres = connectionString ? describe : describe.skip;

const tenantId = 'oi38_product_api_tenant';
const workspaceA = '00000000-0000-4000-8000-00000000a038';
const workspaceB = '00000000-0000-4000-8000-00000000b038';
const workA = '00000000-0000-4000-8000-0000000a0381';
const workB = '00000000-0000-4000-8000-0000000b0381';
const runA = '00000000-0000-4000-8000-0000000a0382';
const definitionA = '00000000-0000-4000-8000-0000000a0383';
const versionA = '00000000-0000-4000-8000-0000000a0384';
const environmentDefinitionA = '00000000-0000-4000-8000-0000000a0385';
const environmentVersionA = '00000000-0000-4000-8000-0000000a0386';
const tokenA = 'oi38-token-owner-a';
const tokenB = 'oi38-token-owner-b';
let httpBaseUrl = '';
let workModule: ReturnType<typeof createWorkModule>;
const generatedWorkIds: string[] = [];
const generatedTaskIds: string[] = [];

describeRealPostgres(
  'Product API v1 OI-38 cross-scope existence oracle',
  () => {
    let pool: Pool;
    let server: ServerType;

    beforeAll(async () => {
      pool = createPostgresPool({
        connectionString: connectionString!,
        maxConnections: 4,
      });
      await applyDurableKernelMigrations(pool);
      await seedIdentityRows(pool);

      const serviceAccounts = [
        {
          serviceAccountId: 'oi38-owner-a',
          token: tokenA,
          tenantId,
          workspaceId: workspaceA,
          policyVersion: 'oi38-test',
          disabled: false,
        },
        {
          serviceAccountId: 'oi38-owner-b',
          token: tokenB,
          tenantId,
          workspaceId: workspaceB,
          policyVersion: 'oi38-test',
          disabled: false,
        },
      ];
      const config = { serviceAccounts } as unknown as AppConfig;
      const definition = definitionFixture();
      const version = versionFixture();
      workModule = createWorkModule({
        database: pool,
        definitions: {
          async findTeamDefinitionById(id) {
            return id === definition.id ? definition : null;
          },
          async findPublishedTeamVersionById(id) {
            return id === version.id ? version : null;
          },
        },
        execution: {
          async admitRoot(request) {
            const id = randomUUID();
            await pool.query(
              `INSERT INTO tasks(id,tenant_id,workspace_id,principal_type,principal_id,policy_snapshot_version,root_task_id,depth,status,ingress,invokable_kind,invokable_version_id,input_snapshot_ref,input_fingerprint,created_at,updated_at)
               VALUES($1,$2,$3,$4,$5,$6,$1,0,'active','api',$7,$8,'work-e4','work-e4',now(),now())`,
              [
                id,
                request.accessContext.tenantId,
                request.accessContext.workspaceId,
                request.accessContext.principalType,
                request.accessContext.principalId,
                request.accessContext.policySnapshotVersion,
                request.invokable.kind,
                request.invokable.versionId,
              ],
            );
            generatedTaskIds.push(id);
            return { taskId: id, reused: false };
          },
        },
        executionFacts: new PostgresExecutionFactQuery(pool),
      });
      const app = createApp(
        Object.assign(minimalAppDependencies(config), { workModule }) as never,
      );

      server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
      if (!server.listening)
        await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address();
      if (address === null || typeof address === 'string')
        throw new Error('OI-38 server did not expose TCP address');
      httpBaseUrl = `http://127.0.0.1:${address.port}`;
    });

    afterAll(async () => {
      if (server)
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      if (generatedWorkIds.length) {
        await pool.query(
          `DELETE FROM work_run_resource_manifest
           WHERE work_run_id IN (
             SELECT id FROM work_runs WHERE work_id = ANY($1::uuid[])
           )`,
          [generatedWorkIds],
        );
        await pool.query(
          'DELETE FROM work_runs WHERE work_id = ANY($1::uuid[])',
          [generatedWorkIds],
        );
        await pool.query('DELETE FROM works WHERE id = ANY($1::uuid[])', [
          generatedWorkIds,
        ]);
      }
      if (generatedTaskIds.length)
        await pool.query('DELETE FROM tasks WHERE id = ANY($1::uuid[])', [
          generatedTaskIds,
        ]);
      await pool?.end();
    });

    it('requires owner positive control and makes foreign/missing Work indistinguishable', async () => {
      const ownerRuns = await request(
        '/api/v1/works/' + workA + '/runs',
        tokenA,
      );
      expect(ownerRuns.status).toBe(200);
      const ownerBody = (await ownerRuns.json()) as { work_runs: unknown[] };
      expect(ownerBody.work_runs.length).toBeGreaterThanOrEqual(1);

      const foreignWork = await pool.query<{ id: string }>(
        'SELECT id FROM works WHERE id=$1 AND tenant_id=$2 AND workspace_id=$3',
        [workA, tenantId, workspaceA],
      );
      expect(foreignWork.rows).toHaveLength(1);

      const missingId = randomUUID();
      const foreign = await request('/api/v1/works/' + workA + '/runs', tokenB);
      const missing = await request(
        '/api/v1/works/' + missingId + '/runs',
        tokenB,
      );
      expect(foreign.status).toBe(404);
      expect(missing.status).toBe(404);
      const foreignError = await normalizeErrorJson(foreign);
      const missingError = await normalizeErrorJson(missing);
      expect(foreignError).toBe(missingError);
      expect(foreignError).toBe(
        JSON.stringify({
          error: {
            code: 'work_not_found',
            message: 'The requested Work was not found.',
          },
        }),
      );
    });

    it('fails closed for mismatched Work/WorkRun detail and trace', async () => {
      for (const suffix of ['', '/trace']) {
        const response = await request(
          `/api/v1/works/${workB}/runs/${runA}${suffix}`,
          tokenA,
        );
        expect(response.status).toBe(404);
        expect(await normalizeErrorJson(response)).toBe(
          JSON.stringify({
            error: {
              code: 'work_run_not_found',
              message: 'The WorkRun was not found for the requested workspace.',
            },
          }),
        );
      }
    });

    it('runs the real HTTP create, start, and read path', async () => {
      const created = await request('/api/v1/works', tokenA, {
        method: 'POST',
        body: JSON.stringify({
          definition_id: definitionA,
          definition_version_id: versionA,
          title: 'E4 walking slice',
        }),
      });
      expect(created.status).toBe(201);
      const workId = ((await created.json()) as any).work.id;
      generatedWorkIds.push(workId);
      const started = await request(`/api/v1/works/${workId}/runs`, tokenA, {
        method: 'POST',
        body: JSON.stringify({ trigger_kind: 'manual', trigger_ref: 'e4' }),
      });
      expect(started.status).toBe(202);
      const runs = await request(`/api/v1/works/${workId}/runs`, tokenA);
      expect(runs.status).toBe(200);
      expect(((await runs.json()) as any).work_runs).toHaveLength(1);
      const read = await request(`/api/v1/works/${workId}`, tokenA);
      if (read.status === 404)
        throw new Error('work_http_projection_installer_missing');
      expect(read.status).toBe(200);
      expect(((await read.json()) as any).work.id).toBe(workId);
    });

    it('creates through real MCP and reads the same Work through HTTP', async () => {
      const mcp = new RuntimeMcpServer(
        {} as never,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        workModule.contributeRuntime,
      );
      const grant = mcp.grants.issue({
        tenantId,
        workspaceId: workspaceA,
        principalType: 'service_account',
        principalId: 'oi38-owner-a',
        productSessionId: randomUUID(),
        allowedTools: [AGENT_SERVER_PRODUCT_WORK_CREATE_TOOL_REF],
      });
      const url = await mcp.start();
      const client = new Client({ name: 'work-e5', version: '1' });
      try {
        await client.connect(
          new StreamableHTTPClientTransport(new URL(url), {
            requestInit: {
              headers: { authorization: `Bearer ${grant.token}` },
            },
          }) as never,
        );
        const tools = await client.listTools();
        if (!tools.tools.some((tool) => tool.name === 'product_work_create'))
          throw new Error('work_mcp_registration_missing:product_work_create');
        const result = await client.callTool({
          name: 'product_work_create',
          arguments: {
            definition_id: definitionA,
            definition_version_id: versionA,
            title: 'E5 MCP walking slice',
          },
        });
        expect(result.isError).not.toBe(true);
        const content = result.content as { type: string; text?: string }[];
        const text = content[0]?.type === 'text' ? (content[0].text ?? '') : '';
        const workId = JSON.parse(text).work.id;
        generatedWorkIds.push(workId);
        const read = await request(`/api/v1/works/${workId}`, tokenA);
        if (read.status === 404)
          throw new Error(`work_mcp_readback_missing:work_id=${workId}`);
        expect(read.status).toBe(200);
        expect(((await read.json()) as any).work.id).toBe(workId);
      } finally {
        await client.close().catch(() => undefined);
        await mcp.stop();
      }
    });
  },
);

async function request(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`${httpBaseUrl}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...init.headers,
    },
  });
}

async function normalizeErrorJson(response: Response): Promise<string> {
  const parsed = ErrorResponseSchema.parse(await response.json());
  return JSON.stringify({
    error: { code: parsed.error.code, message: parsed.error.message },
  });
}

function minimalAppDependencies(config: AppConfig): Record<string, unknown> {
  return {
    config,
    logger: { log() {} },
    readiness: {
      async check() {
        return [];
      },
    },
    runtime: {},
    submitRun: {},
    getRun: {},
    invokeTask: {},
    getTask: {},
    getTaskTree: {},
    createMemoryProposal: {},
    listMemoryProposals: {},
    reviewMemoryProposal: {},
    listMemoryEntries: {},
    agentRegistry: {},
  };
}

function definitionFixture() {
  const now = '2026-08-14T00:00:00.000Z';
  return {
    id: definitionA,
    tenantId,
    workspaceId: workspaceA,
    principalType: 'service_account',
    principalId: 'oi38-owner-a',
    name: 'OI38 Definition',
    description: 'test',
    createdAt: now,
    updatedAt: now,
  } as const;
}

function versionFixture() {
  const now = '2026-08-14T00:00:00.000Z';
  return {
    id: versionA,
    definitionId: definitionA,
    tenantId,
    workspaceId: workspaceA,
    principalType: 'service_account',
    principalId: 'oi38-owner-a',
    status: 'published',
    name: 'OI38 Version',
    description: 'test',
    spec: {
      lead: { name: 'lead', agentVersionId: 'oi38-lead-agent' },
      roster: [{ name: 'member', agentVersionId: 'oi38-member-agent' }],
      environmentVersionId: environmentVersionA,
    },
    environmentVersionId: environmentVersionA,
    createdAt: now,
    updatedAt: now,
    publishedAt: now,
  } as const;
}

async function seedIdentityRows(pool: Pool): Promise<void> {
  const now = new Date().toISOString();
  const residue = await pool.query<{ root_task_id: string }>(
    `SELECT root_task_id FROM work_runs
     WHERE work_id IN (SELECT id FROM works WHERE current_definition_version_id=$1)`,
    [versionA],
  );
  await pool.query(
    `DELETE FROM work_run_resource_manifest
     WHERE work_run_id IN (
       SELECT id FROM work_runs
       WHERE work_id IN (SELECT id FROM works WHERE current_definition_version_id=$1)
     )`,
    [versionA],
  );
  await pool.query(
    `DELETE FROM work_runs
     WHERE work_id IN (SELECT id FROM works WHERE current_definition_version_id=$1)`,
    [versionA],
  );
  await pool.query('DELETE FROM works WHERE current_definition_version_id=$1', [
    versionA,
  ]);
  if (residue.rows.length)
    await pool.query('DELETE FROM tasks WHERE id = ANY($1::uuid[])', [
      residue.rows.map((row) => row.root_task_id),
    ]);
  await pool.query('DELETE FROM work_runs WHERE id=$1', [runA]);
  await pool.query('DELETE FROM works WHERE id IN ($1,$2)', [workA, workB]);
  await pool.query('DELETE FROM team_versions WHERE id=$1', [versionA]);
  await pool.query('DELETE FROM team_definitions WHERE id=$1', [definitionA]);
  await pool.query('DELETE FROM environment_versions WHERE id=$1', [
    environmentVersionA,
  ]);
  await pool.query('DELETE FROM environment_definitions WHERE id=$1', [
    environmentDefinitionA,
  ]);
  await pool.query(
    'DELETE FROM workspaces WHERE id IN ($1,$2) AND tenant_id=$3',
    [workspaceA, workspaceB, tenantId],
  );
  await pool.query(
    'INSERT INTO workspaces(id,tenant_id,principal_type,principal_id,name,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$6),($7,$2,$3,$8,$9,$6,$6)',
    [
      workspaceA,
      tenantId,
      'service_account',
      'oi38-owner-a',
      'OI38 A',
      now,
      workspaceB,
      'oi38-owner-b',
      'OI38 B',
    ],
  );
  await pool.query(
    'INSERT INTO team_definitions(id,tenant_id,workspace_id,principal_type,principal_id,name,description,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)',
    [
      definitionA,
      tenantId,
      workspaceA,
      'service_account',
      'oi38-owner-a',
      'OI38 Definition',
      'test',
      now,
    ],
  );
  await pool.query(
    'INSERT INTO environment_definitions(id,tenant_id,principal_type,principal_id,normalized_name,display_name,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$7)',
    [
      environmentDefinitionA,
      tenantId,
      'service_account',
      'oi38-owner-a',
      'oi38-environment',
      'OI38 Environment',
      now,
    ],
  );
  await pool.query(
    "INSERT INTO environment_versions(id,definition_id,tenant_id,principal_type,principal_id,status,display_name,canonical_package,fingerprint,created_at,updated_at,published_at) VALUES($1,$2,$3,$4,$5,'published',$6,$7,$8,$9,$9,$9)",
    [
      environmentVersionA,
      environmentDefinitionA,
      tenantId,
      'service_account',
      'oi38-owner-a',
      'OI38 Environment',
      { apiVersion: 'agent-server/v1alpha1', kind: 'ManagedEnvironment' },
      'sha256:oi38-environment',
      now,
    ],
  );
  await pool.query(
    `INSERT INTO team_versions(id,definition_id,tenant_id,workspace_id,principal_type,principal_id,status,name,description,spec,environment_version_id,created_at,updated_at,published_at)
     VALUES ($1,$2,$3,$4,$5,$6,'published',$7,$8,$9,$10,$11,$11,$11)`,
    [
      versionA,
      definitionA,
      tenantId,
      workspaceA,
      'service_account',
      'oi38-owner-a',
      'OI38 Version',
      'test',
      {
        lead: { name: 'lead', agentVersionId: 'oi38-lead-agent' },
        roster: [{ name: 'member', agentVersionId: 'oi38-member-agent' }],
        environmentVersionId: environmentVersionA,
      },
      environmentVersionA,
      now,
    ],
  );
  for (const [id, workspace, title] of [
    [workA, workspaceA, 'Owner Work'],
    [workB, workspaceA, 'Pairing Work'],
  ] as const)
    await pool.query(
      'INSERT INTO works(id,tenant_id,workspace_id,definition_id,current_definition_version_id,title,origin,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)',
      [id, tenantId, workspace, definitionA, versionA, title, 'created', now],
    );
  await pool.query(
    'INSERT INTO work_runs(id,tenant_id,workspace_id,work_id,definition_version_id,trigger_kind,trigger_ref,idempotency_key,root_task_id,expires_at,bound_at,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL,$9,NULL,$9,$9)',
    [
      runA,
      tenantId,
      workspaceA,
      workA,
      versionA,
      'manual',
      'oi38-trigger',
      'oi38-idempotency',
      new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    ],
  );
}
