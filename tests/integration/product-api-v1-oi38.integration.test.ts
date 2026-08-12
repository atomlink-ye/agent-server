import { randomUUID } from 'node:crypto';

import { serve, type ServerType } from '@hono/node-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { Pool } from 'pg';

import { createProductProjection } from '../../src/application/product-projection/product-projection.js';
import { QueryWorkProjectionFacts } from '../../src/application/work/query-work-projection-facts.js';
import { WorkProjectionFactsSource } from '../../src/application/product-projection/work-projection-facts-source.js';
import { PostgresWorkProjectionFactsQuery } from '../../src/infrastructure/postgres/postgres-work-projection-facts-query.js';
import { PostgresExecutionFactQuery } from '../../src/infrastructure/postgres/postgres-execution-fact-query.js';
import { PostgresWorkIdentityRepository } from '../../src/infrastructure/postgres/postgres-work-identity-repository.js';
import {
  applyDurableKernelMigrations,
  createPostgresPool,
} from '../../src/infrastructure/postgres/postgres.js';
import { registerProductWorkCommandRoutes } from '../../src/entrypoints/api/routes/product-work-commands.js';
import { registerProductWorkRoutes } from '../../src/entrypoints/api/routes/product-work.js';
import { ErrorResponseSchema } from '../../src/contracts/http.js';
import type { ApiEnvironment } from '../../src/entrypoints/api/http-types.js';
import type { AppConfig } from '../../src/shared/config.js';

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

      const repository = new PostgresWorkIdentityRepository(pool);
      const projection = createProductProjection({
        workIdentity: {
          findWorkById: (id, owner) => repository.findWorkById(id, owner),
          findWorkRunById: (id, owner) => repository.findWorkRunById(id, owner),
        },
        workFacts: new WorkProjectionFactsSource(
          new QueryWorkProjectionFacts(
            new PostgresWorkProjectionFactsQuery(pool),
          ),
        ),
        executionFacts: new PostgresExecutionFactQuery(pool),
      });
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
      const app = new Hono<ApiEnvironment>();
      app.use('*', async (context, next) => {
        const requestId = context.req.header('x-request-id') ?? randomUUID();
        context.set('requestId', requestId);
        context.header('x-request-id', requestId);
        await next();
      });
      const workIdentity = {
        listWorks: (input: any) => repository.listWorks(input.owner, input),
        listWorkRuns: (input: any) =>
          repository.listWorkRuns(input.owner, input.workId, input),
        createWork: async () => {
          throw new Error('not used');
        },
      };
      registerProductWorkCommandRoutes(app, {
        config,
        workIdentity: workIdentity as never,
        workExists: projection.getWork,
        startWorkRun: {
          execute: async () => {
            throw new Error('not used');
          },
        },
      });
      registerProductWorkRoutes(app, { config, productProjection: projection });

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
      expect(normalizeError(await foreign.json())).toEqual(
        normalizeError(await missing.json()),
      );
      expect(normalizeError(await foreign.json())).toEqual({
        error: {
          code: 'work_not_found',
          message: 'The requested Work was not found.',
        },
      });
    });

    it('fails closed for mismatched Work/WorkRun detail and trace', async () => {
      for (const suffix of ['', '/trace']) {
        const response = await request(
          `/api/v1/works/${workB}/runs/${runA}${suffix}`,
          tokenA,
        );
        expect(response.status).toBe(404);
        expect(normalizeError(await response.json())).toEqual({
          error: {
            code: 'work_run_not_found',
            message: 'The WorkRun was not found for the requested workspace.',
          },
        });
      }
    });
  },
);

async function request(path: string, token: string): Promise<Response> {
  return fetch(`${httpBaseUrl}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
}

function normalizeError(value: unknown) {
  const parsed = ErrorResponseSchema.parse(value);
  return { error: { code: parsed.error.code, message: parsed.error.message } };
}

async function seedIdentityRows(pool: Pool): Promise<void> {
  const now = new Date().toISOString();
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
