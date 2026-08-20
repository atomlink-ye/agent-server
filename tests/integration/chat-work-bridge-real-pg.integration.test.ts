import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';

import type { AccessContext } from '../../src/platform/access-context.js';
import type { WorkDefinitionSourceDefinition } from '../../src/domain/work/work-definition-source.js';
import { ListAgentWorkflows } from '../../src/application/work/list-agent-workflows.js';
import { DescribeWorkflow } from '../../src/application/work/describe-workflow.js';
import { ProductWorkDefinitionQuery } from '../../src/application/work/product-work-definition-query.js';
import { PostgresWorkDefinitionSourceRepository } from '../../src/infrastructure/postgres/postgres-work-definition-source-repository.js';
import { PostgresConversationRepository } from '../../src/infrastructure/postgres/postgres-conversation-repository.js';
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
      await pool.query(
        'DELETE FROM agent_workflow_associations WHERE work_definition_id = ANY($1::uuid[])',
        [createdDefinitionIds],
      );
      await pool.query(
        'DELETE FROM work_definition_source_versions WHERE definition_id = ANY($1::uuid[])',
        [createdDefinitionIds],
      );
      await pool.query(
        'DELETE FROM work_definition_source_definitions WHERE id = ANY($1::uuid[])',
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

    const sources = new PostgresWorkDefinitionSourceRepository(pool);
    await sources.publish({
      definitionId,
      versionId,
      owner: access,
      name,
      description,
      source: { kind: 'single_agent', agentVersionId },
      fingerprint: 'sha256:test-fp',
      authorSource: JSON.parse(
        WORKFLOW_SOURCE(name.replace(/\s+/g, '_'), description),
      ),
      authorFingerprint: 'sha256:author-fp',
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

  it('chat_origin provenance: work reference is persisted in chat message', async () => {
    const conversationId = randomUUID();
    createdConversationIds.push(conversationId);
    const triggerMessageId = randomUUID();

    // Create a conversation first
    const conversations = new PostgresConversationRepository(pool);
    await conversations.findOrCreateDirect({
      tenantId,
      principalId: 'principal-123',
      principalType: 'principal',
      agentDefinitionId: agentAId,
    });

    // Use the actual conversation ID from the created one
    const allConversations = await conversations.listConversations({
      tenantId,
      memberType: 'principal',
      memberId: 'principal-123',
    });
    const actualConversationId = allConversations[0].id;
    createdConversationIds[createdConversationIds.length - 1] =
      actualConversationId;

    // Create a chat message with a work reference (simulating what the MCP tool does)
    const workRef = JSON.stringify({
      conversationId: actualConversationId,
      triggerMessageId,
      workId: randomUUID(),
      workRunId: randomUUID(),
    });

    const message = await conversations.appendMessage({
      tenantId,
      conversationId: actualConversationId,
      authorType: 'agent_definition',
      authorId: agentAId,
      body: 'Started work run xyz',
      workRef,
    });

    // Verify: read back the message and confirm work_ref is present
    const allMessages = await conversations.listMessages({
      tenantId,
      conversationId: actualConversationId,
    });

    expect(allMessages.length).toBeGreaterThan(0);
    const foundMessage = allMessages.find(
      (m) => m.id === message.id && m.workRef !== null,
    );
    expect(foundMessage).toBeDefined();
    expect(foundMessage?.workRef).toBe(workRef);

    // Verify: parse the work reference and check its structure
    const parsedRef = JSON.parse(foundMessage!.workRef!);
    expect(parsedRef.conversationId).toBe(actualConversationId);
    expect(parsedRef.triggerMessageId).toBe(triggerMessageId);
    expect(parsedRef.workId).toBeDefined();
    expect(parsedRef.workRunId).toBeDefined();
  });

  it('work.ts file has zero diffs', async () => {
    // Verify that work.ts has not been modified by checking the git diff
    const { execSync } = await import('node:child_process');
    const diffOutput = execSync('git diff HEAD -- src/domain/work/work.ts', {
      cwd: '/Volumes/AgentsWorkspace/orgs/0xdtech/code/agent-server/.worktrees/chat-work-bridge',
      encoding: 'utf8',
    });
    expect(diffOutput.trim()).toBe('');
  });
});
