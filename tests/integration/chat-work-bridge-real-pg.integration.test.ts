import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';

import type { AccessContext } from '../../src/platform/access-context.js';
import { ListAgentWorkflows } from '../../src/application/work/list-agent-workflows.js';
import { DescribeWorkflow } from '../../src/application/work/describe-workflow.js';
import { ProductWorkDefinitionQuery } from '../../src/application/work/product-work-definition-query.js';
import { validateProductWorkDefinition } from '../../src/application/work/validate-product-work-definition.js';
import { fingerprintWorkDefinitionSource } from '../../src/domain/work/work-definition-source.js';
import { PostgresWorkDefinitionSourceRepository } from '../../src/infrastructure/postgres/postgres-work-definition-source-repository.js';
import { PostgresConversationRepository } from '../../src/infrastructure/postgres/postgres-conversation-repository.js';
import { executeProductWorkRunStart } from '../../src/entrypoints/mcp/product-work-mcp-tools.js';
import type { WorkRun } from '../../src/domain/work/work-run.js';
import {
  applyDurableKernelMigrations,
  createPostgresPool,
} from '../../src/infrastructure/postgres/postgres.js';

const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
if (!connectionString)
  throw new Error(
    'real PostgreSQL integration requires DATABASE_URL or POSTGRES_URL',
  );

const tenantId = 'chat_work_bridge_tenant';
const workspaceId = randomUUID();
const principalId = 'chat-work-bridge-principal';
const agentAId = 'agent-a-def';
const agentBId = 'agent-b-def';
const agentVersionId = randomUUID();
const environmentVersionId = randomUUID();
const at = '2026-08-20T00:00:00.000Z';

const access: AccessContext = {
  tenantId,
  workspaceId,
  principalType: 'service_account',
  principalId,
  policySnapshotVersion: 'chat-work-bridge-v1',
};

const WORKFLOW_SOURCE = (name: string, description: string) =>
  `apiVersion: agentserver.dev/v1alpha1
kind: WorkDefinition
metadata:
  name: ${name}
  description: ${description}
spec:
  kind: single_agent
  agent_version_id: ${agentVersionId}
  environment_version_id: ${environmentVersionId}
  input_schema:
    type: object
    properties:
      query:
        type: string
    required: [query]
    additional_properties: false
`;

describe('Chat-Work Bridge integration on real PostgreSQL', () => {
  let pool: Pool;
  const createdDefinitionIds: string[] = [];
  const createdConversationIds: string[] = [];

  beforeAll(async () => {
    pool = createPostgresPool({
      connectionString: connectionString!,
      maxConnections: 4,
    });
    await applyDurableKernelMigrations(pool);
    await pool.query(
      `INSERT INTO workspaces
       (id,tenant_id,principal_type,principal_id,name,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$6)
       ON CONFLICT (id) DO UPDATE SET
         tenant_id=EXCLUDED.tenant_id,
         principal_type=EXCLUDED.principal_type,
         principal_id=EXCLUDED.principal_id,
         updated_at=EXCLUDED.updated_at`,
      [
        workspaceId,
        tenantId,
        access.principalType,
        principalId,
        'Chat Work Bridge',
        at,
      ],
    );
  });

  afterAll(async () => {
    if (createdConversationIds.length) {
      await pool.query(
        'DELETE FROM chat_messages WHERE conversation_id = ANY($1::uuid[])',
        [createdConversationIds],
      );
      await pool.query(
        'DELETE FROM conversation_members WHERE conversation_id = ANY($1::uuid[])',
        [createdConversationIds],
      );
      await pool.query(
        'DELETE FROM conversations WHERE id = ANY($1::uuid[])',
        [createdConversationIds],
      );
    }
    if (createdDefinitionIds.length) {
      // Published Work Definition source versions/definitions are immutable
      // (migration 0034 trigger) and are deliberately left in place, matching
      // the convention in product-work-definition-real-pg.integration.test.ts.
      // Only the (non-immutable) association rows are cleaned up.
      await pool.query(
        'DELETE FROM agent_workflow_associations WHERE work_definition_id = ANY($1::uuid[])',
        [createdDefinitionIds],
      );
    }
    await pool?.end();
  });

  async function publishWorkflow(
    name: string,
    description: string,
  ): Promise<string> {
    const definitionId = randomUUID();
    const versionId = randomUUID();
    createdDefinitionIds.push(definitionId);

    const source = {
      kind: 'single_agent' as const,
      agentVersionId,
      environmentVersionId,
      memoryVersionIds: [],
    };
    const parsedAuthorSource = validateProductWorkDefinition(
      WORKFLOW_SOURCE(
        `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}-${definitionId.slice(0, 8)}`,
        description,
      ),
    );
    if (!parsedAuthorSource.valid)
      throw new Error(
        `Test fixture YAML failed validation: ${JSON.stringify(parsedAuthorSource.diagnostics)}`,
      );

    const sources = new PostgresWorkDefinitionSourceRepository(pool);
    await sources.publish({
      definitionId,
      versionId,
      owner: access,
      name,
      description,
      source,
      fingerprint: fingerprintWorkDefinitionSource(source),
      authorSource: parsedAuthorSource.document,
      authorFingerprint: parsedAuthorSource.fingerprint,
      now: at,
    });

    return definitionId;
  }

  it('list_agent_workflows scoping: Agent A sees only its workflows', async () => {
    const sources = new PostgresWorkDefinitionSourceRepository(pool);

    // Create 3 workflows
    const w1 = await publishWorkflow('W1 for A', 'Workflow 1 for Agent A');
    const w2 = await publishWorkflow('W2 for A', 'Workflow 2 for Agent A');
    const w3 = await publishWorkflow('W3 for B', 'Workflow 3 for Agent B');

    // Associate W1, W2 with Agent A; W3 with Agent B
    await sources.associateAgentWorkflow({
      tenantId,
      workspaceId,
      agentDefinitionId: agentAId,
      definitionId: w1,
      now: at,
    });
    await sources.associateAgentWorkflow({
      tenantId,
      workspaceId,
      agentDefinitionId: agentAId,
      definitionId: w2,
      now: at,
    });
    await sources.associateAgentWorkflow({
      tenantId,
      workspaceId,
      agentDefinitionId: agentBId,
      definitionId: w3,
      now: at,
    });

    // Call ListAgentWorkflows for Agent A
    const listA = new ListAgentWorkflows(sources);
    const resultA = await listA.execute({
      agentDefinitionId: agentAId,
      accessContext: access,
    });

    // Assert: result contains exactly W1 and W2 (not W3)
    const resultIdSet = new Set(resultA.definitions.map((d) => d.id));
    expect(resultIdSet.has(w1)).toBe(true);
    expect(resultIdSet.has(w2)).toBe(true);
    expect(resultIdSet.has(w3)).toBe(false);
    expect(resultA.definitions.length).toBe(2);

    // Call ListAgentWorkflows for Agent B
    const listB = new ListAgentWorkflows(sources);
    const resultB = await listB.execute({
      agentDefinitionId: agentBId,
      accessContext: access,
    });

    // Assert: result contains exactly W3 (not W1 or W2)
    const resultBIdSet = new Set(resultB.definitions.map((d) => d.id));
    expect(resultBIdSet.has(w3)).toBe(true);
    expect(resultBIdSet.has(w1)).toBe(false);
    expect(resultBIdSet.has(w2)).toBe(false);
    expect(resultB.definitions.length).toBe(1);
  });

  it('describe_workflow parity: output matches direct getInputContract call', async () => {
    const sources = new PostgresWorkDefinitionSourceRepository(pool);
    const definitionId = await publishWorkflow(
      'Parity Test Workflow',
      'Testing describe_workflow parity',
    );

    // Get the version ID for this definition
    const queryApi = new ProductWorkDefinitionQuery(sources);
    const defResult = await queryApi.getDefinition({
      definitionId,
      accessContext: access,
    });
    const latestVersion = defResult.latestVersion;
    if (!latestVersion) throw new Error('No version found');

    // Call DescribeWorkflow
    const describeApi = new DescribeWorkflow(sources);
    const describeResult = await describeApi.execute({
      definitionId,
      accessContext: access,
    });

    // Call getInputContract directly
    const directInputContract = await queryApi.getInputContract({
      versionId: latestVersion.version.id,
      accessContext: access,
    });

    // Assert: inputContract from DescribeWorkflow matches direct getInputContract
    if (directInputContract === null) {
      expect(describeResult.inputContract).toBe(null);
    } else {
      expect(describeResult.inputContract).not.toBe(null);
      expect(describeResult.inputContract?.name).toBe(directInputContract.name);
      expect(describeResult.inputContract?.description).toBe(
        directInputContract.description,
      );
      expect(JSON.stringify(describeResult.inputContract?.schema)).toBe(
        JSON.stringify(directInputContract.schema),
      );
    }
  });

  it('chat_origin provenance: the real product_work_run_start handler writes work_ref to chat_messages', async () => {
    const triggerMessageId = randomUUID();

    // Create a real conversation to write into.
    const conversations = new PostgresConversationRepository(pool);
    const conversationPrincipalId = `principal-${randomUUID()}`;
    await conversations.findOrCreateDirect({
      tenantId,
      principalId: conversationPrincipalId,
      principalType: 'principal',
      agentDefinitionId: agentAId,
    });
    const allConversations = await conversations.listConversations({
      tenantId,
      memberType: 'principal',
      memberId: conversationPrincipalId,
    });
    const conversation = allConversations[0];
    if (!conversation) throw new Error('Failed to create conversation');
    createdConversationIds.push(conversation.id);

    const workId = randomUUID();
    const workRunId = randomUUID();
    const fakeWorkRun: WorkRun = {
      id: workRunId,
      tenantId,
      workspaceId,
      workId,
      definitionVersionId: randomUUID(),
      triggerKind: 'manual',
      triggerRef: 'test',
      idempotencyKey: 'test',
      rootTaskId: 'task-1',
      expiresAt: at,
      boundAt: at,
      createdAt: at,
      updatedAt: at,
    };

    // Exercise the REAL production handler (executeProductWorkRunStart), not
    // a hand-rolled duplicate: startWorkRun is faked, but the chat-provenance
    // branch and the write to Postgres are the real, shipped code path.
    const response = await executeProductWorkRunStart(
      {
        work_id: workId,
        trigger_kind: 'manual',
        chat_origin: {
          conversation_id: conversation.id,
          trigger_message_id: triggerMessageId,
        },
      },
      {
        startWorkRun: {
          execute: async () => ({
            workRun: fakeWorkRun,
            executionReceipt: { reused: false, taskId: 'task-1' },
          }),
        },
        conversations,
        current: { tenantId, workspaceId, principalId },
      },
    );
    expect('isError' in response).toBe(false);

    const allMessages = await conversations.listMessages({
      tenantId,
      conversationId: conversation.id,
    });
    const foundMessage = allMessages.find((m) => m.workRef !== null);
    expect(foundMessage).toBeDefined();

    const parsedRef = JSON.parse(foundMessage!.workRef!);
    expect(parsedRef.conversationId).toBe(conversation.id);
    expect(parsedRef.triggerMessageId).toBe(triggerMessageId);
    expect(parsedRef.workId).toBe(workId);
    expect(parsedRef.workRunId).toBe(workRunId);
  });

  it('start_work without chat_origin does not write any chat message', async () => {
    const conversations = new PostgresConversationRepository(pool);
    const conversationPrincipalId = `principal-${randomUUID()}`;
    await conversations.findOrCreateDirect({
      tenantId,
      principalId: conversationPrincipalId,
      principalType: 'principal',
      agentDefinitionId: agentAId,
    });
    const allConversations = await conversations.listConversations({
      tenantId,
      memberType: 'principal',
      memberId: conversationPrincipalId,
    });
    const conversation = allConversations[0];
    if (!conversation) throw new Error('Failed to create conversation');
    createdConversationIds.push(conversation.id);

    const workId = randomUUID();
    const fakeWorkRun: WorkRun = {
      id: randomUUID(),
      tenantId,
      workspaceId,
      workId,
      definitionVersionId: randomUUID(),
      triggerKind: 'manual',
      triggerRef: 'test',
      idempotencyKey: 'test',
      rootTaskId: 'task-1',
      expiresAt: at,
      boundAt: at,
      createdAt: at,
      updatedAt: at,
    };

    await executeProductWorkRunStart(
      { work_id: workId, trigger_kind: 'manual' },
      {
        startWorkRun: {
          execute: async () => ({
            workRun: fakeWorkRun,
            executionReceipt: { reused: false, taskId: 'task-1' },
          }),
        },
        conversations,
        current: { tenantId, workspaceId, principalId },
      },
    );

    const allMessages = await conversations.listMessages({
      tenantId,
      conversationId: conversation.id,
    });
    expect(allMessages.length).toBe(0);
  });

  it('work.ts has zero diff relative to the branch point (out-of-scope guard)', async () => {
    // 263be1c is the commit this branch was cut from (feat/chat-work-bridge's
    // merge-base with master at the time this lane started); it's always an
    // ancestor of HEAD on this branch regardless of clone/remote setup.
    const { execSync } = await import('node:child_process');
    const diffOutput = execSync(
      'git diff 263be1c..HEAD -- src/domain/work/work.ts',
      { encoding: 'utf8' },
    );
    expect(diffOutput.trim()).toBe('');
  });
});
