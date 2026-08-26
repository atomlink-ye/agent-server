import { PGlite } from '@electric-sql/pglite-smoke';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { Pool } from 'pg';
import { afterEach, describe, expect, it } from 'vitest';

import { PostgresChatDispatchRepository } from '../../src/infrastructure/postgres/postgres-chat-dispatch-repository.js';
import { applyDurableKernelMigrations } from '../../src/infrastructure/postgres/postgres.js';

const conversationId = '00000000-0000-4000-8000-00000000d401';

describe('PostgresChatDispatchRepository PGlite wire compatibility', () => {
  let database: PGlite | undefined;
  let server: PGLiteSocketServer | undefined;
  let pool: Pool | undefined;

  afterEach(async () => {
    await pool?.end();
    await server?.stop();
    await database?.close();
    pool = undefined;
    server = undefined;
    database = undefined;
  });

  it('keeps a two-parameter claim isolated from a concurrent four-parameter owner query', async () => {
    database = new PGlite('memory://');
    await database.waitReady;
    server = new PGLiteSocketServer({
      db: database as never,
      host: '127.0.0.1',
      port: 0,
      maxConnections: 4,
    });
    await server.start();
    const port = Number(server.getServerConn().split(':').at(-1));
    pool = new Pool({
      connectionString: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`,
      max: 2,
    });
    await applyDurableKernelMigrations(pool);
    await pool.query(
      `INSERT INTO conversations
         (id,tenant_id,kind,direct_pair_key,next_sequence,created_at,updated_at)
       VALUES ($1,'tenant-wire','direct','direct:wire',1,NOW(),NOW())`,
      [conversationId],
    );

    const repository = new PostgresChatDispatchRepository(pool);
    await repository.enqueue({
      tenantId: 'tenant-wire',
      agentDefinitionId: 'agent-wire',
      conversationId,
      throughSequence: 1,
      dedupeKey: 'message:wire',
    });

    const ownerQuery = pool.query(
      `SELECT $1::text AS tenant_id,
              $2::text AS workspace_id,
              $3::text AS principal_type,
              $4::text AS principal_id`,
      ['tenant-wire', 'workspace-wire', 'service_account', 'principal-wire'],
    );
    const claim = repository.claimNext('worker-wire', 60_000);
    const [ownerResult, claimed] = await Promise.all([ownerQuery, claim]);

    expect(ownerResult.rows[0]).toEqual({
      tenant_id: 'tenant-wire',
      workspace_id: 'workspace-wire',
      principal_type: 'service_account',
      principal_id: 'principal-wire',
    });
    expect(claimed).toMatchObject({
      id: '1',
      tenantId: 'tenant-wire',
      conversationId,
    });
  });
});
