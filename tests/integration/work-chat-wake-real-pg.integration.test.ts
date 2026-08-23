import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';

import { createChatWorkCardProjection } from '../../src/application/product-projection/chat-work-card-projection.js';
import { createProductProjection } from '../../src/application/product-projection/product-projection.js';
import { WorkProjectionFactsSource } from '../../src/application/product-projection/work-projection-facts-source.js';
import { createWorkChatWakeWorker } from '../../src/application/work-chat/work-chat-wake-worker.js';
import { createWorkChatWakeDelivery } from '../../src/application/work-chat/work-chat-wake-delivery.js';
import { PostgresConversationWorkLinkRepository } from '../../src/composition/postgres-conversation-work-link-repository.js';
import { PostgresConversationRepository } from '../../src/infrastructure/postgres/postgres-conversation-repository.js';
import { PostgresExecutionFactQuery } from '../../src/infrastructure/postgres/postgres-execution-fact-query.js';
import { PostgresWorkChatConversationAgentResolver } from '../../src/infrastructure/postgres/postgres-work-chat-conversation-agent-resolver.js';
import { PostgresWorkChatWakeStateRepository } from '../../src/infrastructure/postgres/postgres-work-chat-wake-state-repository.js';
import { PostgresWorkChatWakeWorkSource } from '../../src/infrastructure/postgres/postgres-work-chat-wake-work-source.js';
import { PostgresWorkIdentityRepository } from '../../src/infrastructure/postgres/postgres-work-identity-repository.js';
import { PostgresWorkProjectionFactsQuery } from '../../src/infrastructure/postgres/postgres-work-projection-facts-query.js';
import {
  applyDurableKernelMigrations,
  createPostgresPool,
} from '../../src/infrastructure/postgres/postgres.js';

const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
if (!connectionString)
  throw new Error(
    'real PostgreSQL integration requires DATABASE_URL or POSTGRES_URL',
  );

const tenantId = `work-chat-wake-${randomUUID()}`;
const workspaceId = randomUUID();
const principalId = 'work-chat-wake-real-pg';
const agentDefinitionId = `wake-agent-${randomUUID()}`;
const agentVersionId = randomUUID();
const teamDefinitionId = randomUUID();
const teamVersionId = randomUUID();
const environmentDefinitionId = randomUUID();
const environmentVersionId = randomUUID();
const workId = randomUUID();
const workRunId = randomUUID();
const rootTaskId = randomUUID();
const rootRunId = randomUUID();
const completionRequestRunId = randomUUID();
const secondCompletionRequestRunId = randomUUID();
const teamRunId = randomUUID();
const memberRunId = randomUUID();
const at = '2026-08-20T00:00:00.000Z';

describe('Work Chat wake on real PostgreSQL', () => {
  let pool: Pool;
  let conversationId: string;

  beforeAll(async () => {
    pool = createPostgresPool({
      connectionString: connectionString!,
      maxConnections: 5,
    });
    await applyDurableKernelMigrations(pool);
    await seedRealWorkFixture();
  });

  afterAll(async () => {
    await pool.query(
      'DELETE FROM work_chat_wake_outbox WHERE tenant_id=$1 AND workspace_id=$2 AND work_id=$3',
      [tenantId, workspaceId, workId],
    );
    await pool.query(
      'DELETE FROM work_chat_wake_states WHERE tenant_id=$1 AND workspace_id=$2 AND work_id=$3',
      [tenantId, workspaceId, workId],
    );
    await pool.query(
      'DELETE FROM conversation_work_links WHERE tenant_id=$1 AND workspace_id=$2 AND work_id=$3',
      [tenantId, workspaceId, workId],
    );
    if (conversationId) {
      await pool.query('DELETE FROM chat_dispatches WHERE conversation_id=$1', [
        conversationId,
      ]);
      await pool.query('DELETE FROM chat_messages WHERE conversation_id=$1', [
        conversationId,
      ]);
      await pool.query(
        'DELETE FROM conversation_members WHERE conversation_id=$1',
        [conversationId],
      );
      await pool.query('DELETE FROM conversations WHERE id=$1', [
        conversationId,
      ]);
    }
    await pool.query(
      'DELETE FROM agent_chat_runtimes WHERE tenant_id=$1 AND agent_definition_id=$2',
      [tenantId, agentDefinitionId],
    );
    await pool.query('DELETE FROM team_member_runs WHERE id=$1', [memberRunId]);
    await pool.query('DELETE FROM team_runs WHERE id=$1', [teamRunId]);
    await pool.query(
      `DELETE FROM work_run_resource_manifest
        WHERE work_run_id IN (
          SELECT id FROM work_runs WHERE root_task_id=$1
        )`,
      [rootTaskId],
    );
    await pool.query('DELETE FROM work_runs WHERE root_task_id=$1 OR id=$2', [
      rootTaskId,
      workRunId,
    ]);
    await pool.query('DELETE FROM runs WHERE id = ANY($1::uuid[])', [
      [rootRunId, completionRequestRunId, secondCompletionRequestRunId],
    ]);
    await pool.query('DELETE FROM tasks WHERE id=$1', [rootTaskId]);
    await pool.query('DELETE FROM works WHERE id=$1', [workId]);
    await pool.query('DELETE FROM team_versions WHERE id=$1', [teamVersionId]);
    await pool.query('DELETE FROM team_definitions WHERE id=$1', [
      teamDefinitionId,
    ]);
    await pool.query('DELETE FROM environment_versions WHERE id=$1', [
      environmentVersionId,
    ]);
    await pool.query('DELETE FROM environment_definitions WHERE id=$1', [
      environmentDefinitionId,
    ]);
    await pool.query('DELETE FROM workspaces WHERE id=$1', [workspaceId]);
    await pool?.end();
  });

  it('wakes, replays idempotently, and re-enters without creating execution records', async () => {
    const workIdentity = new PostgresWorkIdentityRepository(pool);
    const productProjection = createProductProjection({
      workIdentity,
      workFacts: new WorkProjectionFactsSource({
        getByRootTask: ({ tenantId, workspaceId, rootTaskId }) =>
          new PostgresWorkProjectionFactsQuery(pool).getByRootTask(
            { tenantId, workspaceId },
            rootTaskId,
          ),
      }),
      executionFacts: new PostgresExecutionFactQuery(pool),
    });
    const cardProjection = createChatWorkCardProjection({
      workIdentity,
      productProjection,
    });
    const conversations = new PostgresConversationRepository(pool);
    const links = new PostgresConversationWorkLinkRepository(pool);
    const agentDefinitions = new PostgresWorkChatConversationAgentResolver(
      pool,
    );
    const delivery = createWorkChatWakeDelivery({
      conversations,
      agentDefinitions,
    });
    const worker = createWorkChatWakeWorker(
      {
        workSource: new PostgresWorkChatWakeWorkSource(pool),
        state: new PostgresWorkChatWakeStateRepository(pool),
        projection: cardProjection,
        conversationWorkLinks: links,
        conversations,
        conversationAgentDefinitions: agentDefinitions,
      },
      {
        workerId: 'work-chat-wake-demo',
        leaseMs: 60_000,
        now: () => new Date(at),
      },
    );

    const initialCard = await cardProjection.getByWorkId({
      tenantId,
      workspaceId,
      workId,
    });
    expect(initialCard.productState).toBe('needs_you');

    const before = await executionRecordCounts();
    await expect(worker.processOnce()).resolves.toBe(true);

    const firstMessages = await conversations.listMessages({
      tenantId,
      conversationId,
    });
    expect(firstMessages).toHaveLength(1);
    expect(firstMessages[0]).toMatchObject({
      authorType: 'agent_definition',
      workRef: workId,
    });
    expect(firstMessages[0]?.deliveryId).toBeTruthy();

    const outboxResult = await pool.query<{
      id: string;
      observed_at: string | Date;
    }>(
      `SELECT id,observed_at FROM work_chat_wake_outbox
       WHERE tenant_id=$1 AND workspace_id=$2 AND work_id=$3
       ORDER BY id`,
      [tenantId, workspaceId, workId],
    );
    const firstOutbox = outboxResult.rows?.[0];
    if (!firstOutbox) throw new Error('expected first wake outbox row');
    const replayCard = await cardProjection.getByWorkId({
      tenantId,
      workspaceId,
      workId,
    });
    await delivery.deliver({
      deliveryId: String(firstOutbox.id),
      tenantId,
      workspaceId,
      workId,
      conversationId,
      card: replayCard,
      observedAt:
        firstOutbox.observed_at instanceof Date
          ? firstOutbox.observed_at.toISOString()
          : firstOutbox.observed_at,
    });
    await expect(
      conversations.listMessages({ tenantId, conversationId }),
    ).resolves.toHaveLength(1);

    await pool.query(
      `UPDATE team_runs
          SET phase='member_work',completion_approval_required=false,
              completion_requested_by_run_id=NULL,revision=revision+1,updated_at=$2
        WHERE id=$1`,
      [teamRunId, at],
    );
    await expect(worker.processOnce()).resolves.toBe(true);
    await expect(
      conversations.listMessages({ tenantId, conversationId }),
    ).resolves.toHaveLength(1);

    await pool.query(
      `UPDATE team_runs
          SET phase='lead_finalize',completion_approval_required=true,
              completion_requested_by_run_id=$2,revision=revision+1,updated_at=$3
        WHERE id=$1`,
      [teamRunId, secondCompletionRequestRunId, at],
    );
    await expect(worker.processOnce()).resolves.toBe(true);

    const secondMessages = await conversations.listMessages({
      tenantId,
      conversationId,
    });
    expect(secondMessages).toHaveLength(2);
    expect(secondMessages.map((message) => message.workRef)).toEqual([
      workId,
      workId,
    ]);
    expect(
      new Set(secondMessages.map((message) => message.deliveryId)).size,
    ).toBe(2);
    expect(await executionRecordCounts()).toEqual(before);
  });

  async function seedRealWorkFixture(): Promise<void> {
    await pool.query(
      `INSERT INTO workspaces
       (id,tenant_id,principal_type,principal_id,name,created_at,updated_at)
       VALUES($1,$2,'service_account',$3,'Work Chat Wake Demo',$4,$4)`,
      [workspaceId, tenantId, principalId, at],
    );
    await pool.query(
      `INSERT INTO environment_definitions
       (id,tenant_id,principal_type,principal_id,normalized_name,display_name,created_at,updated_at)
       VALUES($1,$2,'service_account',$3,'wake-demo','Wake Demo',$4,$4)`,
      [environmentDefinitionId, tenantId, principalId, at],
    );
    await pool.query(
      `INSERT INTO environment_versions
       (id,definition_id,tenant_id,principal_type,principal_id,status,display_name,canonical_package,fingerprint,created_at,updated_at,published_at)
       VALUES($1,$2,$3,'service_account',$4,'published','Wake Demo','{}'::jsonb,'wake-demo',$5,$5,$5)`,
      [
        environmentVersionId,
        environmentDefinitionId,
        tenantId,
        principalId,
        at,
      ],
    );
    await pool.query(
      `INSERT INTO team_definitions
       (id,tenant_id,workspace_id,principal_type,principal_id,name,description,created_at,updated_at)
       VALUES($1,$2,$3,'service_account',$4,'Wake Demo Team','real PG wake fixture',$5,$5)`,
      [teamDefinitionId, tenantId, workspaceId, principalId, at],
    );
    await pool.query(
      `INSERT INTO team_versions
       (id,definition_id,tenant_id,workspace_id,principal_type,principal_id,status,name,description,spec,environment_version_id,created_at,updated_at,published_at)
       VALUES($1,$2,$3,$4,'service_account',$5,'published','Wake Demo Team','real PG wake fixture',$6::jsonb,$7,$8,$8,$8)`,
      [
        teamVersionId,
        teamDefinitionId,
        tenantId,
        workspaceId,
        principalId,
        JSON.stringify({
          lead: { name: 'lead', agentVersionId },
          roster: [
            { name: 'reviewer', agentVersionId },
            { name: 'builder', agentVersionId: randomUUID() },
          ],
          environmentVersionId,
        }),
        environmentVersionId,
        at,
      ],
    );
    await pool.query(
      `INSERT INTO works
       (id,tenant_id,workspace_id,definition_id,current_definition_version_id,title,origin,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,'Real PG Wake Work','created',$6,$6)`,
      [workId, tenantId, workspaceId, teamDefinitionId, teamVersionId, at],
    );
    await pool.query(
      `INSERT INTO work_runs
       (id,tenant_id,workspace_id,work_id,definition_version_id,trigger_kind,trigger_ref,idempotency_key,expires_at,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,'manual','wake-demo','wake-demo',$6,$7,$7)`,
      [
        workRunId,
        tenantId,
        workspaceId,
        workId,
        teamVersionId,
        '2026-08-20T01:00:00.000Z',
        at,
      ],
    );
    await pool.query(
      `INSERT INTO tasks
       (id,tenant_id,workspace_id,principal_type,principal_id,policy_snapshot_version,
        root_task_id,depth,status,ingress,invokable_kind,invokable_version_id,
        input_snapshot_ref,input_fingerprint,created_at,updated_at)
       VALUES($1,$2,$3,'service_account',$4,'wake-demo',$1,0,'completed','api','team',$5,'wake','wake',$6,$6)`,
      [rootTaskId, tenantId, workspaceId, principalId, teamVersionId, at],
    );
    await pool.query(
      `INSERT INTO runs
       (id,task_id,attempt,status,fencing_token,result,created_at,updated_at)
       VALUES($1,$2,1,'succeeded',1,'{"text":"completion request"}'::jsonb,$3,$3)`,
      [rootRunId, rootTaskId, at],
    );
    await pool.query(
      `INSERT INTO runs
       (id,task_id,attempt,status,fencing_token,result,created_at,updated_at)
       VALUES
         ($1,$3,2,'succeeded',1,'{"text":"completion request"}'::jsonb,$4,$4),
         ($2,$3,3,'succeeded',1,'{"text":"completion request"}'::jsonb,$4,$4)`,
      [completionRequestRunId, secondCompletionRequestRunId, rootTaskId, at],
    );
    await pool.query(
      `INSERT INTO team_runs
       (id,tenant_id,workspace_id,principal_type,principal_id,root_task_id,root_run_id,
        team_version_id,environment_version_id,status,phase,final_text,control_state,
        revision,lead_turn_count,completion_requested_by_run_id,completion_approval_required,
        created_at,updated_at)
       VALUES($1,$2,$3,'service_account',$4,$5,$6,$7,$8,'active','lead_finalize',NULL,
        'lead_running',1,1,$9,true,$10,$10)`,
      [
        teamRunId,
        tenantId,
        workspaceId,
        principalId,
        rootTaskId,
        rootRunId,
        teamVersionId,
        environmentVersionId,
        completionRequestRunId,
        at,
      ],
    );
    await pool.query(
      `INSERT INTO team_member_runs
       (id,team_run_id,name,role,agent_version_id,status,tenant_id,workspace_id,
        principal_type,principal_id,created_at,updated_at)
       VALUES($1,$2,'reviewer','member',$3,'active',$4,$5,'service_account',$6,$7,$7)`,
      [
        memberRunId,
        teamRunId,
        agentVersionId,
        tenantId,
        workspaceId,
        principalId,
        at,
      ],
    );
    await pool.query(
      `UPDATE work_runs SET root_task_id=$2,bound_at=$3,updated_at=$3 WHERE id=$1`,
      [workRunId, rootTaskId, at],
    );

    const conversations = new PostgresConversationRepository(pool);
    const conversation = await conversations.findOrCreateDirect({
      tenantId,
      principalId,
      principalType: 'principal',
      agentDefinitionId,
    });
    conversationId = conversation.id;
    await conversations.ensureChatRuntime({
      tenantId,
      agentDefinitionId,
      activeAgentVersionId: agentVersionId,
    });
    await new PostgresConversationWorkLinkRepository(
      pool,
    ).linkWorkToConversation({
      tenantId,
      workspaceId,
      workId,
      conversationId,
      triggerMessageId: '00000000-0000-4000-8000-000000000001',
    });
  }

  async function executionRecordCounts(): Promise<{
    tasks: number;
    runs: number;
    runDispatches: number;
  }> {
    const result = await pool.query<{
      tasks: string;
      runs: string;
      run_dispatches: string;
    }>(
      `SELECT
         (SELECT COUNT(*)::text FROM tasks) AS tasks,
         (SELECT COUNT(*)::text FROM runs) AS runs,
         (SELECT COUNT(*)::text FROM run_dispatches) AS run_dispatches`,
    );
    const row = result.rows?.[0];
    if (!row) throw new Error('missing execution record counts');
    return {
      tasks: Number(row.tasks),
      runs: Number(row.runs),
      runDispatches: Number(row.run_dispatches),
    };
  }
});
