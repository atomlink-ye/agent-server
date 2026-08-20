import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AccessContext } from '../../src/platform/access-context.js';
import { DescribeWorkflow } from '../../src/application/work/describe-workflow.js';
import { ProductWorkDefinitionQuery } from '../../src/application/work/product-work-definition-query.js';
import { ResolveWorkDefinition } from '../../src/application/work/resolve-work-definition.js';
import { validateProductWorkDefinition } from '../../src/application/work/validate-product-work-definition.js';
import { fingerprintWorkDefinitionSource } from '../../src/domain/work/work-definition-source.js';
import { RuntimeToolGrantService } from '../../src/application/extensions/runtime-tool-grant-service.js';
import { PostgresExecutionFactQuery } from '../../src/infrastructure/postgres/postgres-execution-fact-query.js';
import { PostgresInvokableRepository } from '../../src/infrastructure/postgres/postgres-invokable-repository.js';
import { PostgresWorkDefinitionSourceRepository } from '../../src/infrastructure/postgres/postgres-work-definition-source-repository.js';
import { PostgresConversationRepository } from '../../src/infrastructure/postgres/postgres-conversation-repository.js';
import {
  PRODUCT_WORK_CREATE_TOOL_REF,
  PRODUCT_WORK_LIST_AGENT_WORKFLOWS_TOOL_REF,
  PRODUCT_WORK_RUN_START_TOOL_REF,
} from '../../src/entrypoints/mcp/product-work-mcp-tools.js';
import { createWorkModule } from '../../src/modules/work/work-module.js';
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

const WORKFLOW_SOURCE = (
  name: string,
  description: string,
  inputField = 'query',
) =>
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
      ${inputField}:
        type: string
    required: [${inputField}]
    additional_properties: false
`;

describe('Chat-Work Bridge integration on real PostgreSQL', () => {
  let pool: Pool;
  let workTools: Map<string, RegisteredTool>;
  const createdDefinitionIds: string[] = [];
  const createdWorkIds: string[] = [];
  const createdTaskIds: string[] = [];

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

    const invokables = new PostgresInvokableRepository(pool);
    const authoredDefinitions = new PostgresWorkDefinitionSourceRepository(
      pool,
    );
    const resolver = new ResolveWorkDefinition({
      agents: {
        async findDefinition() {
          return null;
        },
        async findVersion(_owner, versionId) {
          return versionId === agentVersionId
            ? ({
                id: agentVersionId,
                definitionId: randomUUID(),
                tenantId,
                workspaceId,
                principalType: access.principalType,
                principalId,
                status: 'published',
                displayName: 'Chat Work Bridge Agent',
                fingerprint: `sha256:${'a'.repeat(64)}`,
              } as any)
            : null;
        },
      },
      agentResolution: {
        async resolvePublished(versionId) {
          return versionId === agentVersionId
            ? {
                source: 'managed' as const,
                id: agentVersionId,
                instructions: 'Handle typed Product Work input.',
                modelPolicyRef: 'free-only' as const,
                proposalLimit: 0,
                skills: [],
                toolRefs: [],
              }
            : null;
        },
      },
      definitions: invokables,
      authoredDefinitions,
      environments: {
        async findVersion(_owner, versionId) {
          return versionId === environmentVersionId
            ? ({
                id: environmentVersionId,
                definitionId: randomUUID(),
                tenantId,
                workspaceId,
                principalType: access.principalType,
                principalId,
                status: 'published',
                displayName: 'Chat Work Bridge Environment',
                package: {},
                canonicalJson: '{}',
                fingerprint: `sha256:${'e'.repeat(64)}`,
                createdAt: at,
                updatedAt: at,
                publishedAt: at,
              } as any)
            : null;
        },
      },
    });
    const workModule = createWorkModule({
      database: pool,
      definitions: invokables,
      definitionResolution: resolver,
      execution: {
        async admitRoot(request) {
          const taskId = randomUUID();
          await pool.query(
            `INSERT INTO tasks
             (id,tenant_id,workspace_id,principal_type,principal_id,policy_snapshot_version,
              root_task_id,depth,status,ingress,invokable_kind,invokable_version_id,
              input_snapshot_ref,input_fingerprint,created_at,updated_at)
             VALUES($1,$2,$3,$4,$5,$6,$1,0,'active','api',$7,$8,$9,$10,$11,$11)`,
            [
              taskId,
              request.accessContext.tenantId,
              request.accessContext.workspaceId,
              request.accessContext.principalType,
              request.accessContext.principalId,
              request.accessContext.policySnapshotVersion,
              request.invokable.kind,
              request.invokable.versionId,
              'chat-work-bridge',
              'chat-work-bridge',
              at,
            ],
          );
          createdTaskIds.push(taskId);
          return { taskId, reused: false };
        },
      },
      executionFacts: new PostgresExecutionFactQuery(pool),
      conversations: new PostgresConversationRepository(pool),
      runtimeCapabilities: {
        capabilities() {
          return { supported: new Set(['external_workspace'] as const) };
        },
      },
    });
    const grants = new RuntimeToolGrantService();
    const grantIssue = grants.issue({
      tenantId,
      principalType: access.principalType,
      principalId: access.principalId,
      workspaceId,
      productSessionId: randomUUID(),
      allowedTools: [
        PRODUCT_WORK_CREATE_TOOL_REF,
        PRODUCT_WORK_LIST_AGENT_WORKFLOWS_TOOL_REF,
        PRODUCT_WORK_RUN_START_TOOL_REF,
      ],
      catalogTools: [
        PRODUCT_WORK_CREATE_TOOL_REF,
        PRODUCT_WORK_LIST_AGENT_WORKFLOWS_TOOL_REF,
        PRODUCT_WORK_RUN_START_TOOL_REF,
      ],
    });
    const grant = grants.resolve(grantIssue.token);
    if (!grant) throw new Error('Failed to resolve the MCP test grant.');
    workTools = new Map();
    const server = {
      registerTool(
        name: string,
        _config: unknown,
        handler: RegisteredTool,
      ): void {
        workTools.set(name, handler);
      },
    } as unknown as McpServer;
    workModule.contributeRuntime({ server, grant, grants });
  });

  afterAll(async () => {
    if (createdWorkIds.length) {
      await pool.query(
        `DELETE FROM work_run_resource_manifest
         WHERE work_run_id IN (
           SELECT id FROM work_runs
            WHERE tenant_id=$1 AND workspace_id=$2
              AND work_id = ANY($3::uuid[])
         )`,
        [tenantId, workspaceId, createdWorkIds],
      );
      await pool.query(
        `DELETE FROM work_runs
         WHERE tenant_id=$1 AND workspace_id=$2
           AND work_id = ANY($3::uuid[])`,
        [tenantId, workspaceId, createdWorkIds],
      );
      await pool.query(
        `DELETE FROM works
         WHERE tenant_id=$1 AND workspace_id=$2 AND id = ANY($3::uuid[])`,
        [tenantId, workspaceId, createdWorkIds],
      );
    }
    if (createdTaskIds.length)
      await pool.query('DELETE FROM tasks WHERE id = ANY($1::uuid[])', [
        createdTaskIds,
      ]);
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
    inputField = 'query',
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
        `${name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, '')}-${definitionId.slice(0, 8)}`,
        description,
        inputField,
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
    const w1 = await publishWorkflow('W1 for A', 'Workflow 1 for Agent A');
    const w2 = await publishWorkflow('W2 for A', 'Workflow 2 for Agent A');
    const w3 = await publishWorkflow('W3 for B', 'Workflow 3 for Agent B');

    const associate = requiredTool(
      workTools,
      'product_work_associate_agent_workflow',
    );
    const list = requiredTool(workTools, 'list_agent_workflows');
    const associated = await associate({
      agent_definition_id: agentAId,
      definition_id: w1,
    });
    expect(parseToolPayload(associated).associated).toBe(true);
    await associate({ agent_definition_id: agentAId, definition_id: w2 });
    await associate({ agent_definition_id: agentBId, definition_id: w3 });

    const resultA = parseToolPayload(
      await list({ agent_definition_id: agentAId }),
    );

    // Assert: result contains exactly W1 and W2 (not W3)
    const resultIdSet = new Set(
      resultA.definitions.map((d: { id: string }) => d.id),
    );
    expect(resultIdSet.has(w1)).toBe(true);
    expect(resultIdSet.has(w2)).toBe(true);
    expect(resultIdSet.has(w3)).toBe(false);
    expect(resultA.definitions.length).toBe(2);

    const resultB = parseToolPayload(
      await list({ agent_definition_id: agentBId }),
    );

    // Assert: result contains exactly W3 (not W1 or W2)
    const resultBIdSet = new Set(
      resultB.definitions.map((d: { id: string }) => d.id),
    );
    expect(resultBIdSet.has(w3)).toBe(true);
    expect(resultBIdSet.has(w1)).toBe(false);
    expect(resultBIdSet.has(w2)).toBe(false);
    expect(resultB.definitions.length).toBe(1);

    const scopedRows = await pool.query<{
      tenant_id: string;
      workspace_id: string;
    }>(
      `SELECT tenant_id,workspace_id
         FROM agent_workflow_associations
        WHERE work_definition_id = ANY($1::uuid[])`,
      [[w1, w2, w3]],
    );
    expect(
      scopedRows.rows.every(
        (row) => row.tenant_id === tenantId && row.workspace_id === workspaceId,
      ),
    ).toBe(true);

    // Roll back the association rows through the test harness, then prove the
    // same production list tool observes the empty state.
    await pool.query(
      `DELETE FROM agent_workflow_associations
       WHERE tenant_id=$1 AND workspace_id=$2
         AND work_definition_id = ANY($3::uuid[])`,
      [tenantId, workspaceId, [w1, w2, w3]],
    );
    const afterRollback = parseToolPayload(
      await list({ agent_definition_id: agentAId }),
    );
    expect(afterRollback.definitions).toEqual([]);
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

  it('continue_work persists a typed predecessor link through the MCP path', async () => {
    const definitionId = await publishWorkflow(
      'Feedback Continuation Workflow',
      'Continues a Product Work from typed feedback.',
      'feedback',
    );
    const sources = new PostgresWorkDefinitionSourceRepository(pool);
    const versions = await sources.listProductVersions!({
      definitionId,
      owner: access,
      limit: 1,
      cursor: null,
    });
    const version = versions.items[0]?.version;
    if (!version)
      throw new Error('Feedback workflow version was not published.');

    const start = requiredTool(workTools, 'start_work');
    const continueWork = requiredTool(workTools, 'continue_work');
    const startPayload = parseToolPayload(
      await start({
        work_definition_version_id: version.id,
        input: { feedback: 'initial feedback' },
      }),
    );
    const workReference = startPayload.work_reference;
    createdWorkIds.push(workReference.work_id);
    expect(workReference).toEqual({
      work_id: expect.any(String),
      definition_id: definitionId,
      definition_version_id: version.id,
    });

    const initialRuns = await pool.query<{ id: string }>(
      `SELECT id
         FROM work_runs
        WHERE tenant_id=$1 AND workspace_id=$2 AND work_id=$3
        ORDER BY created_at DESC,id DESC`,
      [tenantId, workspaceId, workReference.work_id],
    );
    expect(initialRuns.rows).toHaveLength(1);
    const predecessorId = initialRuns.rows[0]!.id;

    const chatBefore = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count
         FROM chat_messages
        WHERE tenant_id=$1 AND work_ref=$2`,
      [tenantId, workReference.work_id],
    );
    const continuationPayload = parseToolPayload(
      await continueWork({
        work_ref: workReference.work_id,
        feedback: 'follow-up feedback',
      }),
    );
    expect(continuationPayload).toEqual({
      work_reference: workReference,
      continuation_kind: 'new_work_run',
    });

    const runs = await pool.query<{
      id: string;
      predecessor_work_run_id: string | null;
      input_snapshot: Record<string, unknown> | null;
    }>(
      `SELECT id,predecessor_work_run_id,input_snapshot
         FROM work_runs
        WHERE tenant_id=$1 AND workspace_id=$2 AND work_id=$3
        ORDER BY created_at DESC,id DESC`,
      [tenantId, workspaceId, workReference.work_id],
    );
    expect(runs.rows).toHaveLength(2);
    const successor = runs.rows[0]!;
    expect(successor.id).not.toBe(predecessorId);
    expect(successor.predecessor_work_run_id).toBe(predecessorId);
    expect(successor.input_snapshot).toEqual({
      feedback: 'follow-up feedback',
    });

    const chatAfter = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count
         FROM chat_messages
        WHERE tenant_id=$1 AND work_ref=$2`,
      [tenantId, workReference.work_id],
    );
    expect(chatAfter.rows[0]?.count).toBe(chatBefore.rows[0]?.count);
  });

  it('work.ts WorkOrigin type is untouched by this PR (out-of-scope guard)', () => {
    // Verify that the WorkOrigin domain type (tracking Work creation provenance)
    // was not modified by this PR's work on the chat-triggered Work feature.
    // The two concepts are easy to confuse; this guard prevents regressions where
    // someone might "helpfully" merge WorkOrigin with ChatWorkOriginRef.
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
    const source = readFileSync(
      resolve(root, 'src/domain/work/work.ts'),
      'utf8',
    );
    expect(source).toContain(
      "export type WorkOrigin = 'created' | 'backfilled';",
    );
    expect(source).not.toMatch(/ChatWorkOriginRef|chat_origin|chatOrigin/);
  });
});

type RegisteredTool = (args: Record<string, unknown>) => Promise<unknown>;

function requiredTool(
  tools: Map<string, RegisteredTool>,
  name: string,
): RegisteredTool {
  const tool = tools.get(name);
  if (!tool) throw new Error(`MCP tool was not registered: ${name}`);
  return tool;
}

function parseToolPayload(result: unknown): any {
  if (!result || typeof result !== 'object')
    throw new Error('MCP tool returned an invalid result.');
  const content = (result as { content?: readonly { text?: string }[] })
    .content;
  const text = content?.[0]?.text;
  if (!text) throw new Error('MCP tool returned no text payload.');
  return JSON.parse(text);
}
