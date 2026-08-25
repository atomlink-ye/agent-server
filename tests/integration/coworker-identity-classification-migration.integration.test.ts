import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';

const migrations = join(
  fileURLToPath(
    new URL('../../src/infrastructure/postgres/migrations/', import.meta.url),
  ),
);
let db: PGlite | undefined;

afterEach(async () => db?.close());

describe('0060 coworker identity classification migration', () => {
  it('classifies provenance, removes only canonical legacy direct state, and is rerunnable', async () => {
    db = new PGlite();
    for (const file of readdirSync(migrations)
      .filter(
        (f) =>
          f.endsWith('.sql') && f < '0060_coworker_identity_classification.sql',
      )
      .sort())
      await db.exec(readFileSync(join(migrations, file), 'utf8'));
    await db.exec(`
      INSERT INTO workspaces VALUES ('10000000-0000-4000-8000-00000000f001','t','service_account','p','w',now(),now());
      INSERT INTO agent_definitions(id,tenant_id,workspace_id,principal_type,principal_id,name,managed_discriminator,normalized_name,created_at,updated_at) VALUES
      ('20000000-0000-4000-8000-00000000f001','t','10000000-0000-4000-8000-00000000f001','service_account','p','legacy','managed_agent_v1','legacy',now(),now()),
      ('20000000-0000-4000-8000-00000000f002','t','10000000-0000-4000-8000-00000000f001','service_account','p','peer','managed_agent_v1','peer',now(),now());
      INSERT INTO agent_versions(id,definition_id,tenant_id,workspace_id,principal_type,principal_id,status,name,instructions,managed_discriminator,canonical_package,fingerprint,pattern_metadata,compiler_metadata,policy_snapshot,reference_snapshot,tool_skill_snapshot,validation_report,compiled_package,execution_snapshot,created_at,updated_at,published_at) VALUES ('21000000-0000-4000-8000-00000000f001','20000000-0000-4000-8000-00000000f001','t','10000000-0000-4000-8000-00000000f001','service_account','p','published','legacy','x','managed_agent_v1','{}','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','{}','{}','{}','{}','{}','{}','{}','{}',now(),now(),now());
      INSERT INTO agent_registry_idempotency(operation,tenant_id,principal_type,principal_id,idempotency_key,request_fingerprint,definition_id,version_id,created_at,updated_at) VALUES ('import','t','service_account','p','work-inline-agent-import:x','sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','20000000-0000-4000-8000-00000000f001','21000000-0000-4000-8000-00000000f001',now(),now());
      INSERT INTO agent_chat_runtimes VALUES ('t','20000000-0000-4000-8000-00000000f001','v',1,'available',NULL,now(),now()),('t','20000000-0000-4000-00000000f002','v',1,'available',NULL,now(),now());
      INSERT INTO conversations(id,tenant_id,kind,direct_pair_key,next_sequence,created_at,updated_at) VALUES
      ('30000000-0000-4000-8000-00000000f001','t','direct','direct:t:p:20000000-0000-4000-8000-00000000f001',1,now(),now()),
      ('30000000-0000-4000-8000-00000000f002','t','group','contains-20000000-0000-4000-8000-00000000f001',1,now(),now());
      INSERT INTO conversation_members VALUES
      ('30000000-0000-4000-8000-00000000f001','t','principal','p','service_account',NULL,now()),
      ('30000000-0000-4000-8000-00000000f001','t','agent_definition','20000000-0000-4000-8000-00000000f001',NULL,NULL,now());`);
    const migration = readFileSync(
      join(migrations, '0060_coworker_identity_classification.sql'),
      'utf8',
    );
    await db.exec(migration);
    await db.exec(migration);
    const values = await Promise.all([
      db.query<{ value: string }>(
        `SELECT identity_class AS value FROM agent_identity_classes WHERE agent_definition_id='20000000-0000-4000-8000-00000000f001'`,
      ),
      db.query<{ value: string }>(
        `SELECT count(*)::text AS value FROM agent_chat_runtimes WHERE agent_definition_id='20000000-0000-4000-8000-00000000f001'`,
      ),
      db.query<{ value: string }>(
        `SELECT count(*)::text AS value FROM conversations WHERE id='30000000-0000-4000-8000-00000000f001'`,
      ),
      db.query<{ value: string }>(
        `SELECT count(*)::text AS value FROM conversations WHERE id='30000000-0000-4000-8000-00000000f002'`,
      ),
      db.query<{ value: string }>(
        `SELECT team_version_spec_shape_is_valid('{"lead":{"name":"l","workerVersionId":"x"},"roster":[{"name":"m","workerVersionId":"y"}],"environmentVersionId":"z"}'::jsonb)::text AS value`,
      ),
      db.query<{ value: string }>(
        `SELECT team_version_spec_shape_is_valid('{"lead":{"name":"l"},"roster":[],"environmentVersionId":"z"}'::jsonb)::text AS value`,
      ),
    ]);
    expect(values.map((r) => r.rows[0]?.value)).toEqual([
      'legacy_work_internal',
      '0',
      '0',
      '1',
      'true',
      'false',
    ]);
  });
});
