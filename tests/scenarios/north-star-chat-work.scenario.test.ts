import { afterEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';

import {
  AGENT_SERVER_LIST_AGENT_WORKFLOWS_TOOL_REF,
  AGENT_SERVER_PRODUCT_WORK_RUN_START_TOOL_REF,
} from '../../src/application/agents/built-in-skills.js';
import { ScriptedExecutionPlane } from '../../src/adapters/runtime/scripted-execution-plane.js';
import { ExecutionRuntimeChatTurnProvider } from '../../src/adapters/chat/execution-runtime-chat-turn-provider.js';
import { registerProductWorkMcpTools } from '../../src/entrypoints/mcp/product-work-mcp-tools.js';
import { RuntimeMcpServer } from '../../src/infrastructure/extensions/runtime-mcp-server.js';
import { RuntimeToolRegistry } from '../../src/platform/runtime-tool-registry.js';
import { applyDurableKernelMigrations } from '../../src/infrastructure/postgres/postgres.js';
import { validateProductWorkDefinition } from '../../src/application/work/validate-product-work-definition.js';
import { fingerprintWorkDefinitionSource } from '../../src/domain/work/work-definition-source.js';
import { PostgresWorkDefinitionSourceRepository } from '../../src/infrastructure/postgres/postgres-work-definition-source-repository.js';
import { createWorkModule } from '../../src/modules/work/work-module.js';
import { PostgresInvokableRepository } from '../../src/infrastructure/postgres/postgres-invokable-repository.js';
import { PostgresExecutionFactQuery } from '../../src/infrastructure/postgres/postgres-execution-fact-query.js';
import { ResolveWorkDefinition } from '../../src/application/work/resolve-work-definition.js';
import { ChatDeliveryReconciler } from '../../src/application/chat/chat-delivery-reconciler.js';
import { PostgresConversationRepository } from '../../src/infrastructure/postgres/postgres-conversation-repository.js';
import { PostgresChatDispatchRepository } from '../../src/infrastructure/postgres/postgres-chat-dispatch-repository.js';
import { PostgresConversationWorkEntitlementRepository } from '../../src/infrastructure/postgres/postgres-conversation-work-entitlement-repository.js';
import { PostgresConversationWorkLinkRepository } from '../../src/modules/work/conversation-work-link-repository.js';
import { LocalRuntimeExtensionBinder } from '../../src/infrastructure/extensions/local-runtime-extension-binder.js';
import { postConversationMessage } from '../../src/application/chat/post-conversation-message.js';
import { AdmitRootTask } from '../../src/application/tasks/admit-root-task.js';
import { CompleteRun } from '../../src/application/runs/complete-run.js';
import { ExecuteRun } from '../../src/application/runs/execute-run.js';
import { ExecuteTeamTask } from '../../src/application/tasks/execute-team-task.js';
import { transitionRun } from '../../src/domain/runs/run.js';
import { PostgresAdmissionRepository } from '../../src/infrastructure/postgres/postgres-admission-repository.js';
import { PostgresRunRepository } from '../../src/infrastructure/postgres/postgres-run-repository.js';
import { PostgresRunEventRepository } from '../../src/infrastructure/postgres/postgres-run-event-repository.js';
import { PostgresTaskRepository } from '../../src/infrastructure/postgres/postgres-task-repository.js';
import { createWorkChatWakeWorker } from '../../src/application/work-chat/work-chat-wake-worker.js';
import { PostgresWorkChatWakeWorkSource } from '../../src/infrastructure/postgres/postgres-work-chat-wake-work-source.js';
import { PostgresWorkChatWakeStateRepository } from '../../src/infrastructure/postgres/postgres-work-chat-wake-state-repository.js';
import { PostgresWorkChatConversationAgentResolver } from '../../src/infrastructure/postgres/postgres-work-chat-conversation-agent-resolver.js';
import { FakeAgentRuntime } from '../fixtures/fake-agent-runtime.js';
import { createLogger } from '../../src/shared/observability/logger.js';

const servers: RuntimeMcpServer[] = [];
afterEach(async () =>
  Promise.all(servers.splice(0).map((server) => server.stop())),
);

describe('North Star chat Work MVE', () => {
  it('B1 migrates the in-process product Work schema', async () => {
    const db = new PGlite();
    try {
      await applyDurableKernelMigrations(db);
      const result = await db.query<{ table: string | null }>(
        "SELECT to_regclass('public.works') AS table",
      );
      expect(result.rows[0]?.table).toBe('works');
    } finally {
      await db.close();
    }
  });

  it('B2a seeds the real Work-link foreign-key fixture in PGlite', async () => {
    const db = new PGlite();
    const ids = {
      workspace: '00000000-0000-4000-8000-000000000301',
      environmentDefinition: '00000000-0000-4000-8000-000000000302',
      environmentVersion: '00000000-0000-4000-8000-000000000303',
      teamDefinition: '00000000-0000-4000-8000-000000000304',
      teamVersion: '00000000-0000-4000-8000-000000000305',
      conversation: '00000000-0000-4000-8000-000000000306',
    };
    const tenant = 'tenant-b2a';
    const at = '2026-08-21T00:00:00.000Z';
    try {
      await applyDurableKernelMigrations(db);
      await db.query(
        `INSERT INTO workspaces (id,tenant_id,principal_type,principal_id,name,created_at,updated_at) VALUES($1,$2,'service_account','principal-b2a','B2a',$3,$3)`,
        [ids.workspace, tenant, at],
      );
      await db.query(
        `INSERT INTO environment_definitions (id,tenant_id,principal_type,principal_id,normalized_name,display_name,created_at,updated_at) VALUES($1,$2,'service_account','principal-b2a','b2a','B2a',$3,$3)`,
        [ids.environmentDefinition, tenant, at],
      );
      await db.query(
        `INSERT INTO environment_versions (id,definition_id,tenant_id,principal_type,principal_id,status,display_name,canonical_package,fingerprint,created_at,updated_at,published_at) VALUES($1,$2,$3,'service_account','principal-b2a','published','B2a','{}'::jsonb,'b2a',$4,$4,$4)`,
        [ids.environmentVersion, ids.environmentDefinition, tenant, at],
      );
      await db.query(
        `INSERT INTO team_definitions (id,tenant_id,workspace_id,principal_type,principal_id,name,description,created_at,updated_at) VALUES($1,$2,$3,'service_account','principal-b2a','B2a','fixture',$4,$4)`,
        [ids.teamDefinition, tenant, ids.workspace, at],
      );
      await db.query(
        `INSERT INTO team_versions (id,definition_id,tenant_id,workspace_id,principal_type,principal_id,status,name,description,spec,environment_version_id,created_at,updated_at,published_at) VALUES($1,$2,$3,$4,'service_account','principal-b2a','published','B2a','fixture',$5::jsonb,$6,$7,$7,$7)`,
        [
          ids.teamVersion,
          ids.teamDefinition,
          tenant,
          ids.workspace,
          JSON.stringify({
            lead: { name: 'lead', agentVersionId: 'agent-b2a' },
            roster: [{ name: 'reviewer', agentVersionId: 'agent-b2a' }],
            environmentVersionId: ids.environmentVersion,
          }),
          ids.environmentVersion,
          at,
        ],
      );
      await db.query(
        `INSERT INTO conversations (id,tenant_id,kind,created_at,updated_at) VALUES($1,$2,'direct',$3,$3)`,
        [ids.conversation, tenant, at],
      );
      for (const [table, id] of Object.entries({
        workspaces: ids.workspace,
        environment_definitions: ids.environmentDefinition,
        environment_versions: ids.environmentVersion,
        team_definitions: ids.teamDefinition,
        team_versions: ids.teamVersion,
        conversations: ids.conversation,
      })) {
        const result = await db.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM ${table} WHERE id=$1`,
          [id],
        );
        expect(result.rows[0]?.count).toBe(1);
      }
    } finally {
      await db.close();
    }
  });

  it('B2b-1 publishes a Product WorkDefinition in PGlite', async () => {
    const db = new PGlite();
    const definitionId = randomUUID();
    const versionId = randomUUID();
    const agentVersionId = randomUUID();
    const environmentVersionId = randomUUID();
    const owner = {
      tenantId: 'tenant-b2b',
      workspaceId: randomUUID(),
      principalType: 'service_account' as const,
      principalId: 'principal-b2b',
    };
    const source = {
      kind: 'single_agent' as const,
      agentVersionId,
      environmentVersionId,
      memoryVersionIds: [],
    };
    const parsed = validateProductWorkDefinition(`apiVersion: agentserver.dev/v1alpha1
kind: WorkDefinition
metadata:
  name: b2b-product-work
  description: B2b Product WorkDefinition
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
`);
    try {
      await applyDurableKernelMigrations(db);
      await db.query(
        `INSERT INTO workspaces (id,tenant_id,principal_type,principal_id,name,created_at,updated_at)
         VALUES($1,$2,$3,$4,'B2b',$5,$5)`,
        [
          owner.workspaceId,
          owner.tenantId,
          owner.principalType,
          owner.principalId,
          '2026-08-21T00:00:00.000Z',
        ],
      );
      if (!parsed.valid) throw new Error(JSON.stringify(parsed.diagnostics));
      await new PostgresWorkDefinitionSourceRepository(db).publish({
        definitionId,
        versionId,
        owner,
        name: 'B2b Product Work',
        description: 'B2b Product WorkDefinition',
        source,
        fingerprint: fingerprintWorkDefinitionSource(source),
        authorSource: parsed.document,
        authorFingerprint: parsed.fingerprint,
        now: '2026-08-21T00:00:00.000Z',
      });
      const result = await db.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM work_definition_source_versions WHERE id=$1',
        [versionId],
      );
      expect(result.rows[0]?.count).toBe(1);
    } finally {
      await db.close();
    }
  });

  it('rejects turn2 when the real start_work handler is outside the grant', async () => {
    const definitionId = '00000000-0000-4000-8000-000000000202';
    const versionId = '00000000-0000-4000-8000-000000000203';
    const definitions = {
      async listDefinitionsForAgent() {
        return [
          { id: definitionId, name: 'OpenAI analysis', description: null },
        ];
      },
      async listProductVersions() {
        return {
          items: [
            {
              version: {
                id: versionId,
                definitionId,
                source: {
                  inputSchema: {
                    type: 'object',
                    properties: { query: { type: 'string' } },
                    required: ['query'],
                  },
                },
              },
            },
          ],
          nextCursor: null,
        };
      },
      async findProductVersion() {
        return { version: { id: versionId, definitionId } };
      },
      async findDefinition() {
        return { id: definitionId, name: 'OpenAI analysis' };
      },
    };
    const mcp = new RuntimeMcpServer(
      new RuntimeToolRegistry([
        ({ server, grant, grants }) =>
          registerProductWorkMcpTools({
            server,
            grant,
            grants,
            definitions: definitions as any,
            workIdentity: {
              async createWork() {
                throw new Error('must not create');
              },
              async findWorkById() {
                return null;
              },
              async findLatestWorkRun() {
                return null;
              },
            },
            startWorkRun: {
              async execute() {
                throw new Error('must not start');
              },
            },
          }),
      ]),
    );
    servers.push(mcp);
    const receipt = mcp.grants.issue({
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      principalType: 'service_account',
      principalId: 'principal-1',
      scopeId: 'chat-runtime-2',
      allowedTools: [AGENT_SERVER_LIST_AGENT_WORKFLOWS_TOOL_REF],
      catalogTools: [
        AGENT_SERVER_LIST_AGENT_WORKFLOWS_TOOL_REF,
        AGENT_SERVER_PRODUCT_WORK_RUN_START_TOOL_REF,
      ],
    });
    const session = await new ScriptedExecutionPlane().createSession({
      runtimeSessionId: 'chat-runtime-2',
      workspace: { cwd: process.cwd() },
      systemPrompt: 'Agent definition ID: agent-1',
      extensions: {
        mcpServers: [
          {
            name: 'agent-server',
            url: await mcp.start(),
            headers: { Authorization: `Bearer ${receipt.token}` },
          },
        ],
      },
    });
    await expect(
      session.session.run({ runId: 'turn-2', prompt: '请做正式分析 OpenAI' }),
    ).rejects.toThrow('start_work');
  });

  it('turn2 invokes real work MCP handlers and creates a linked Work', async () => {
    const work = {
      id: '00000000-0000-4000-8000-000000000101',
      definitionId: '00000000-0000-4000-8000-000000000102',
      currentDefinitionVersionId: '00000000-0000-4000-8000-000000000103',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      title: 'OpenAI analysis',
      createdAt: '2026-08-21T00:00:00.000Z',
      updatedAt: '2026-08-21T00:00:00.000Z',
      archivedAt: null,
    };
    const created: unknown[] = [];
    const started: unknown[] = [];
    const links: unknown[] = [];
    const definitions = {
      async listDefinitionsForAgent() {
        return [
          {
            id: work.definitionId,
            name: 'OpenAI analysis',
            description: 'Analyze OpenAI',
            owner: {
              tenantId: 'tenant-1',
              workspaceId: 'workspace-1',
              principalType: 'service_account',
              principalId: 'principal-1',
            },
          },
        ];
      },
      async listProductVersions() {
        return {
          items: [
            {
              version: {
                id: work.currentDefinitionVersionId,
                definitionId: work.definitionId,
                source: {
                  inputSchema: {
                    type: 'object',
                    properties: { query: { type: 'string' } },
                    required: ['query'],
                  },
                },
              },
            },
          ],
          nextCursor: null,
        };
      },
      async findProductVersion() {
        return {
          version: {
            id: work.currentDefinitionVersionId,
            definitionId: work.definitionId,
          },
        };
      },
      async findDefinition() {
        return { id: work.definitionId, name: 'OpenAI analysis' };
      },
    };
    const mcp = new RuntimeMcpServer(
      new RuntimeToolRegistry([
        ({ server, grant, grants }) =>
          registerProductWorkMcpTools({
            server,
            grant,
            grants,
            ...(grant.chatContext ? { chatContext: grant.chatContext } : {}),
            definitions: definitions as any,
            workIdentity: {
              async createWork(input) {
                created.push(input);
                return work as any;
              },
              async findWorkById() {
                return null;
              },
              async findLatestWorkRun() {
                return null;
              },
            },
            startWorkRun: {
              async execute(input) {
                started.push(input);
                return {
                  workRun: {
                    id: '00000000-0000-4000-8000-000000000104',
                    workId: work.id,
                  },
                  executionReceipt: {
                    reused: false,
                    taskId: '00000000-0000-4000-8000-000000000105',
                  },
                } as any;
              },
            },
            conversationWorkLinks: {
              async linkWorkToConversation(input) {
                links.push(input);
                return input as any;
              },
              async findConversationIdByWork() {
                return null;
              },
              async findRecentWorkByConversation() {
                return [];
              },
            },
          }),
      ]),
    );
    servers.push(mcp);
    const receipt = mcp.grants.issue({
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      principalType: 'service_account',
      principalId: 'principal-1',
      scopeId: 'chat-runtime-1',
      chatContext: {
        conversationId: 'conversation-1',
        triggerMessageId: 'message-1',
      },
      allowedTools: [
        AGENT_SERVER_LIST_AGENT_WORKFLOWS_TOOL_REF,
        AGENT_SERVER_PRODUCT_WORK_RUN_START_TOOL_REF,
      ],
    });
    const createdSession = await new ScriptedExecutionPlane().createSession({
      runtimeSessionId: 'chat-runtime-1',
      workspace: { cwd: process.cwd() },
      systemPrompt: 'Agent definition ID: agent-1',
      extensions: {
        mcpServers: [
          {
            name: 'agent-server',
            url: await mcp.start(),
            headers: { Authorization: `Bearer ${receipt.token}` },
          },
        ],
      },
    });
    await expect(
      createdSession.session.run({
        runId: 'turn-2',
        prompt: '请做正式分析 OpenAI',
      }),
    ).resolves.toMatchObject({ status: 'completed' });
    expect(created).toHaveLength(1);
    expect(started).toHaveLength(1);
    expect(links).toEqual([
      {
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        workId: work.id,
        conversationId: 'conversation-1',
        triggerMessageId: 'message-1',
      },
    ]);
  });

  // B2b-2 · 端到端：真实 WorkModule 装配 + 真实产品 handler，在同一个 PGlite 上。
  // 🔴 works/work_runs/conversation_work_links 必须由【真实路径】建出，⛔ 不手写 INSERT INTO works。
  it('B2b-2 creates a durable Work through the real WorkModule contributor', async () => {
    const db = new PGlite();
    const at = '2026-08-21T00:00:00.000Z';
    const tenantId = 'tenant-b2b2';
    const workspaceId = randomUUID();
    const principalId = 'principal-b2b2';
    const conversationId = randomUUID();
    const triggerMessageId = randomUUID();
    const agentVersionId = randomUUID();
    const agentDefinitionId = randomUUID();
    const environmentVersionId = randomUUID();
    const definitionId = randomUUID();
    const versionId = randomUUID();
    const owner = {
      tenantId,
      workspaceId,
      principalType: 'service_account' as const,
      principalId,
    };
    // 🔴 source 必须带 inputSchema：list_agent_workflows 返回的 input_schema 取自
    // version.source.inputSchema（product-work-mcp-tools.ts:708），取不到就回落成空 schema，
    // 于是脚本化 start_work 会送 {}，被真实校验拒为 "input does not match"。
    // YAML 里写了 input_schema 不等于 source 对象里有 —— 两处都要给。
    const source = {
      kind: 'single_agent' as const,
      agentVersionId,
      environmentVersionId,
      memoryVersionIds: [],
      inputSchema: {
        type: 'object' as const,
        properties: { query: { type: 'string' as const } },
        required: ['query'],
        additional_properties: false,
      },
    };
    const parsed =
      validateProductWorkDefinition(`apiVersion: agentserver.dev/v1alpha1
kind: WorkDefinition
metadata:
  name: b2b2-product-work
  description: B2b-2 Product WorkDefinition
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
`);
    if (!parsed.valid) throw new Error(JSON.stringify(parsed.diagnostics));

    try {
      await applyDurableKernelMigrations(db);
      await db.query(
        `INSERT INTO workspaces (id,tenant_id,principal_type,principal_id,name,created_at,updated_at) VALUES($1,$2,'service_account',$3,'B2b2',$4,$4)`,
        [workspaceId, tenantId, principalId, at],
      );
      await db.query(
        `INSERT INTO conversations (id,tenant_id,kind,created_at,updated_at) VALUES($1,$2,'direct',$3,$3)`,
        [conversationId, tenantId, at],
      );

      const authoredDefinitions = new PostgresWorkDefinitionSourceRepository(
        db,
      );
      await authoredDefinitions.publish({
        definitionId,
        versionId,
        owner,
        name: 'B2b2 Product Work',
        description: 'B2b-2 Product WorkDefinition',
        source,
        fingerprint: fingerprintWorkDefinitionSource(source),
        authorSource: parsed.document,
        authorFingerprint: parsed.fingerprint,
        now: at,
      });

      // 🔴 list_agent_workflows 走 listDefinitionsForAgent，它 JOIN agent_workflow_associations
      // （postgres-work-definition-source-repository.ts:396-409）。没有这一行关联，真实 handler
      // 会返回"无可启动 workflow" —— 这不是 bug，是产品要求 workflow 必须显式关联到 agent。
      await authoredDefinitions.associateAgentWorkflow({
        tenantId,
        workspaceId,
        agentDefinitionId,
        definitionId,
        now: at,
      });

      const invokables = new PostgresInvokableRepository(db);
      const resolver = new ResolveWorkDefinition({
        agents: {
          async findDefinition() {
            return null;
          },
          async findVersion(_owner, id) {
            return id === agentVersionId
              ? ({
                  id: agentVersionId,
                  definitionId: randomUUID(),
                  tenantId,
                  workspaceId,
                  principalType: owner.principalType,
                  principalId,
                  status: 'published',
                  displayName: 'B2b2 Agent',
                  fingerprint: `sha256:${'a'.repeat(64)}`,
                } as any)
              : null;
          },
        },
        agentResolution: {
          async resolvePublished(id) {
            return id === agentVersionId
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
          async findVersion(_owner, id) {
            return id === environmentVersionId
              ? ({
                  id: environmentVersionId,
                  definitionId: randomUUID(),
                  tenantId,
                  workspaceId,
                  principalType: owner.principalType,
                  principalId,
                  status: 'published',
                  displayName: 'B2b2 Environment',
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
        database: db as any,
        definitions: invokables,
        definitionResolution: resolver,
        execution: {
          async admitRoot(request: any) {
            const taskId = randomUUID();
            await db.query(
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
                'b2b2',
                'b2b2',
                at,
              ],
            );
            return { taskId, reused: false };
          },
        } as any,
        // 🔴 真实 StartWorkRun 会校验运行时能力（start-work-run.ts:54-56, 278）。
        // 不传就用 NO_RUNTIME_CAPABILITIES ⇒ 报 "unsupported runtime capability: external_workspace"。
        // 这里用 ScriptedExecutionPlane 自己声明的能力集，保持与实际执行方一致。
        runtimeCapabilities: new ScriptedExecutionPlane(),
        executionFacts: new PostgresExecutionFactQuery(db as any),
        conversations: {
          async appendMessage() {
            return undefined as any;
          },
        } as any,
      } as any);

      const mcp = new RuntimeMcpServer(
        new RuntimeToolRegistry([
          (context: any) =>
            workModule.contributeRuntime({
              ...context,
              chatContext: { conversationId, triggerMessageId },
            }),
        ]),
      );
      servers.push(mcp);
      const receipt = mcp.grants.issue({
        tenantId,
        workspaceId,
        principalType: 'service_account',
        principalId,
        scopeId: 'chat-runtime-b2b2',
        allowedTools: [
          AGENT_SERVER_LIST_AGENT_WORKFLOWS_TOOL_REF,
          AGENT_SERVER_PRODUCT_WORK_RUN_START_TOOL_REF,
        ],
      });
      const created = await new ScriptedExecutionPlane().createSession({
        runtimeSessionId: 'chat-runtime-b2b2',
        workspace: { cwd: process.cwd() },
        systemPrompt: `Agent definition ID: ${agentDefinitionId}`,
        extensions: {
          mcpServers: [
            {
              name: 'agent-server',
              url: await mcp.start(),
              headers: { Authorization: `Bearer ${receipt.token}` },
            },
          ],
        },
      });
      await expect(
        created.session.run({ runId: 'turn-2', prompt: '请做正式分析 OpenAI' }),
      ).resolves.toMatchObject({ status: 'completed' });

      const works = await db.query<{ id: string; v: string }>(
        'SELECT id, current_definition_version_id AS v FROM works WHERE tenant_id=$1',
        [tenantId],
      );
      expect(works.rows).toHaveLength(1);
      expect(works.rows[0]?.v).toBe(versionId);
      const runs = await db.query<{ work_id: string }>(
        'SELECT work_id FROM work_runs WHERE tenant_id=$1',
        [tenantId],
      );
      expect(runs.rows).toHaveLength(1);
      expect(runs.rows[0]?.work_id).toBe(works.rows[0]?.id);
      const links = await db.query<{
        work_id: string;
        conversation_id: string;
        trigger_message_id: string;
      }>(
        'SELECT work_id, conversation_id, trigger_message_id FROM conversation_work_links WHERE tenant_id=$1',
        [tenantId],
      );
      expect(links.rows).toHaveLength(1);
      expect(links.rows[0]?.work_id).toBe(works.rows[0]?.id);
      expect(links.rows[0]?.conversation_id).toBe(conversationId);
      expect(links.rows[0]?.trigger_message_id).toBe(triggerMessageId);
    } finally {
      await db.close();
    }
  });

  it('B2b-3 continues an existing Work through the real WorkModule contributor', async () => {
    const db = new PGlite();
    const at = '2026-08-21T00:00:00.000Z';
    const tenantId = 'tenant-b2b3';
    const workspaceId = randomUUID();
    const principalId = 'principal-b2b3';
    const conversationId = randomUUID();
    const triggerMessageId = randomUUID();
    const agentVersionId = randomUUID();
    const agentDefinitionId = randomUUID();
    const environmentVersionId = randomUUID();
    const definitionId = randomUUID();
    const versionId = randomUUID();
    const owner = {
      tenantId,
      workspaceId,
      principalType: 'service_account' as const,
      principalId,
    };
    const source = {
      kind: 'single_agent' as const,
      agentVersionId,
      environmentVersionId,
      memoryVersionIds: [],
      inputSchema: {
        type: 'object' as const,
        properties: { feedback: { type: 'string' as const } },
        required: ['feedback'],
        additional_properties: false,
      },
    };
    const parsed =
      validateProductWorkDefinition(`apiVersion: agentserver.dev/v1alpha1
kind: WorkDefinition
metadata:
  name: b2b3-product-work
  description: B2b-3 Product WorkDefinition
spec:
  kind: single_agent
  agent_version_id: ${agentVersionId}
  environment_version_id: ${environmentVersionId}
  input_schema:
    type: object
    properties:
      feedback:
        type: string
    required: [feedback]
    additional_properties: false
`);
    if (!parsed.valid) throw new Error(JSON.stringify(parsed.diagnostics));

    try {
      await applyDurableKernelMigrations(db);
      await db.query(
        `INSERT INTO workspaces (id,tenant_id,principal_type,principal_id,name,created_at,updated_at) VALUES($1,$2,'service_account',$3,'B2b3',$4,$4)`,
        [workspaceId, tenantId, principalId, at],
      );
      await db.query(
        `INSERT INTO conversations (id,tenant_id,kind,created_at,updated_at) VALUES($1,$2,'direct',$3,$3)`,
        [conversationId, tenantId, at],
      );

      const authoredDefinitions = new PostgresWorkDefinitionSourceRepository(
        db,
      );
      await authoredDefinitions.publish({
        definitionId,
        versionId,
        owner,
        name: 'B2b3 Product Work',
        description: 'B2b-3 Product WorkDefinition',
        source,
        fingerprint: fingerprintWorkDefinitionSource(source),
        authorSource: parsed.document,
        authorFingerprint: parsed.fingerprint,
        now: at,
      });
      await authoredDefinitions.associateAgentWorkflow({
        tenantId,
        workspaceId,
        agentDefinitionId,
        definitionId,
        now: at,
      });

      const invokables = new PostgresInvokableRepository(db);
      const resolver = new ResolveWorkDefinition({
        agents: {
          async findDefinition() {
            return null;
          },
          async findVersion(_owner, id) {
            return id === agentVersionId
              ? ({
                  id: agentVersionId,
                  definitionId: randomUUID(),
                  tenantId,
                  workspaceId,
                  principalType: owner.principalType,
                  principalId,
                  status: 'published',
                  displayName: 'B2b3 Agent',
                  fingerprint: `sha256:${'a'.repeat(64)}`,
                } as any)
              : null;
          },
        },
        agentResolution: {
          async resolvePublished(id) {
            return id === agentVersionId
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
          async findVersion(_owner, id) {
            return id === environmentVersionId
              ? ({
                  id: environmentVersionId,
                  definitionId: randomUUID(),
                  tenantId,
                  workspaceId,
                  principalType: owner.principalType,
                  principalId,
                  status: 'published',
                  displayName: 'B2b3 Environment',
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
        database: db as any,
        definitions: invokables,
        definitionResolution: resolver,
        execution: {
          async admitRoot(request: any) {
            const taskId = randomUUID();
            await db.query(
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
                'b2b3',
                'b2b3',
                at,
              ],
            );
            return { taskId, reused: false };
          },
        } as any,
        runtimeCapabilities: new ScriptedExecutionPlane(),
        executionFacts: new PostgresExecutionFactQuery(db as any),
        conversations: {
          async appendMessage() {
            return undefined as any;
          },
        } as any,
      } as any);
      const mcp = new RuntimeMcpServer(
        new RuntimeToolRegistry([
          (context: any) =>
            workModule.contributeRuntime({
              ...context,
              chatContext: { conversationId, triggerMessageId },
            }),
        ]),
      );
      servers.push(mcp);
      const receipt = mcp.grants.issue({
        tenantId,
        workspaceId,
        principalType: 'service_account',
        principalId,
        scopeId: 'chat-runtime-b2b3',
        allowedTools: [
          AGENT_SERVER_LIST_AGENT_WORKFLOWS_TOOL_REF,
          AGENT_SERVER_PRODUCT_WORK_RUN_START_TOOL_REF,
        ],
      });
      const created = await new ScriptedExecutionPlane().createSession({
        runtimeSessionId: 'chat-runtime-b2b3',
        workspace: { cwd: process.cwd() },
        systemPrompt: `Agent definition ID: ${agentDefinitionId}`,
        extensions: {
          mcpServers: [
            {
              name: 'agent-server',
              url: await mcp.start(),
              headers: { Authorization: `Bearer ${receipt.token}` },
            },
          ],
        },
      });

      await created.session.run({
        runId: 'turn-2',
        prompt: '请做正式分析 OpenAI',
      });
      const before = await db.query<{ id: string }>(
        'SELECT id FROM works WHERE tenant_id=$1',
        [tenantId],
      );
      expect(before.rows).toHaveLength(1);
      const workId = before.rows[0]!.id;

      await created.session.run({
        runId: 'turn-3',
        prompt: `继续返工 Work ${workId}: 删除融资部分`,
      });

      const works = await db.query<{ id: string }>(
        'SELECT id FROM works WHERE tenant_id=$1',
        [tenantId],
      );
      expect(works.rows).toEqual([{ id: workId }]);
      const runs = await db.query<{ work_id: string }>(
        'SELECT work_id FROM work_runs WHERE tenant_id=$1 ORDER BY created_at,id',
        [tenantId],
      );
      expect(runs.rows).toHaveLength(2);
      expect(runs.rows.map((run) => run.work_id)).toEqual([workId, workId]);
    } finally {
      await db.close();
    }
  });

  it('B4 lets the real ChatDeliveryReconciler bind chat Work tools end to end', async () => {
    const db = new PGlite();
    const at = '2026-08-21T00:00:00.000Z';
    const tenantId = 'tenant-b4';
    const workspaceId = randomUUID();
    const principalId = 'principal-b4';
    const agentDefinitionId = randomUUID();
    const agentVersionId = randomUUID();
    const environmentVersionId = randomUUID();
    const definitionId = randomUUID();
    const versionId = randomUUID();
    const owner = {
      tenantId,
      workspaceId,
      principalType: 'service_account' as const,
      principalId,
    };
    const source = {
      kind: 'single_agent' as const,
      agentVersionId,
      environmentVersionId,
      memoryVersionIds: [],
      inputSchema: {
        type: 'object' as const,
        properties: { query: { type: 'string' as const } },
        required: ['query'],
        additional_properties: false,
      },
    };
    const parsed =
      validateProductWorkDefinition(`apiVersion: agentserver.dev/v1alpha1
kind: WorkDefinition
metadata:
  name: b4-product-work
  description: B4 Product WorkDefinition
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
`);
    if (!parsed.valid) throw new Error(JSON.stringify(parsed.diagnostics));

    try {
      await applyDurableKernelMigrations(db);
      await db.query(
        `INSERT INTO workspaces (id,tenant_id,principal_type,principal_id,name,created_at,updated_at) VALUES($1,$2,'service_account',$3,'B4',$4,$4)`,
        [workspaceId, tenantId, principalId, at],
      );
      const conversations = new PostgresConversationRepository(db as any);
      const dispatches = new PostgresChatDispatchRepository(db as any);
      const entitlements = new PostgresConversationWorkEntitlementRepository(
        db as any,
      );
      const conversationWorkLinks = new PostgresConversationWorkLinkRepository(
        db as any,
      );
      await conversations.ensureChatRuntime({
        tenantId,
        agentDefinitionId,
        activeAgentVersionId: agentVersionId,
      });
      const conversation = await conversations.findOrCreateDirect({
        tenantId,
        principalId,
        principalType: 'service_account',
        agentDefinitionId,
      });
      const message = await postConversationMessage(conversations, {
        author: {
          type: 'principal',
          tenantId,
          conversationId: conversation.id,
          principalType: 'service_account',
          principalId,
        },
        body: '请做正式分析 OpenAI',
      });
      await entitlements.enable({
        tenantId,
        conversationId: conversation.id,
        workspaceId,
        principalType: 'service_account',
        principalId,
      });
      await dispatches.enqueue({
        tenantId,
        agentDefinitionId,
        conversationId: conversation.id,
        throughSequence: message.sequence,
        dedupeKey: `b4:${message.id}`,
      });
      const dispatch = (await dispatches.listPending(10))[0];
      expect(dispatch).toBeDefined();

      const authoredDefinitions = new PostgresWorkDefinitionSourceRepository(
        db,
      );
      await authoredDefinitions.publish({
        definitionId,
        versionId,
        owner,
        name: 'B4 Product Work',
        description: 'B4 Product WorkDefinition',
        source,
        fingerprint: fingerprintWorkDefinitionSource(source),
        authorSource: parsed.document,
        authorFingerprint: parsed.fingerprint,
        now: at,
      });
      await authoredDefinitions.associateAgentWorkflow({
        tenantId,
        workspaceId,
        agentDefinitionId,
        definitionId,
        now: at,
      });

      const invokables = new PostgresInvokableRepository(db);
      const resolver = new ResolveWorkDefinition({
        agents: {
          async findDefinition() {
            return null;
          },
          async findVersion(_owner, id) {
            return id === agentVersionId
              ? ({
                  id: agentVersionId,
                  definitionId: randomUUID(),
                  tenantId,
                  workspaceId,
                  principalType: owner.principalType,
                  principalId,
                  status: 'published',
                  displayName: 'B4 Agent',
                  fingerprint: `sha256:${'a'.repeat(64)}`,
                } as any)
              : null;
          },
        },
        agentResolution: {
          async resolvePublished(id) {
            return id === agentVersionId
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
          async findVersion(_owner, id) {
            return id === environmentVersionId
              ? ({
                  id: environmentVersionId,
                  definitionId: randomUUID(),
                  tenantId,
                  workspaceId,
                  principalType: owner.principalType,
                  principalId,
                  status: 'published',
                  displayName: 'B4 Environment',
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
      const executionPlane = new ScriptedExecutionPlane();
      const workModule = createWorkModule({
        database: db as any,
        definitions: invokables,
        definitionResolution: resolver,
        execution: {
          async admitRoot(request: any) {
            const taskId = randomUUID();
            await db.query(
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
                'b4',
                'b4',
                at,
              ],
            );
            return { taskId, reused: false };
          },
        } as any,
        runtimeCapabilities: executionPlane,
        executionFacts: new PostgresExecutionFactQuery(db as any),
        conversations: {
          async appendMessage() {
            return undefined as any;
          },
        } as any,
      } as any);
      const mcp = new RuntimeMcpServer(
        new RuntimeToolRegistry([(context) => workModule.contributeRuntime(context)]),
      );
      servers.push(mcp);
      const binder = new LocalRuntimeExtensionBinder(
        process.cwd(),
        process.cwd(),
        mcp,
      );
      const runtime = {
        async executeTurn(input: any) {
          if (!input.extensions) throw new Error('reconciler did not bind extensions');
          const created = await executionPlane.createSession({
            runtimeSessionId: `chat-runtime-b4-${conversation.id}`,
            workspace: { cwd: process.cwd() },
            systemPrompt: input.systemPrompt ?? '',
            extensions: input.extensions,
          });
          const result = await created.session.run({
            runId: input.runId,
            prompt: input.prompt,
          });
          if (result.status !== 'completed') {
            throw new Error(`scripted execution did not complete: ${result.status}`);
          }
          return {
            provider: result.output.provider,
            model: result.output.model,
            text: result.output.text,
            workspaceBinding: created.workspaceBinding,
            sessionBinding: created.sessionBinding,
          };
        },
      };
      const provider = new ExecutionRuntimeChatTurnProvider(runtime);
      const reconciler = new ChatDeliveryReconciler(
        conversations,
        dispatches,
        provider,
        {
          async resolve() {
            return {
              instructions: 'B4 test brain',
              capabilitySummary: {},
              agentHome: {},
            } as any;
          },
        } as any,
        conversationWorkLinks,
        undefined,
        undefined,
        entitlements,
        binder,
      );
      await reconciler.reconcileOne(dispatch!);

      const works = await db.query<{ id: string; v: string }>(
        'SELECT id, current_definition_version_id AS v FROM works WHERE tenant_id=$1',
        [tenantId],
      );
      expect(works.rows).toHaveLength(1);
      expect(works.rows[0]?.v).toBe(versionId);
      const runs = await db.query<{ work_id: string }>(
        'SELECT work_id FROM work_runs WHERE tenant_id=$1',
        [tenantId],
      );
      expect(runs.rows).toHaveLength(1);
      expect(runs.rows[0]?.work_id).toBe(works.rows[0]?.id);
      const links = await db.query<{
        work_id: string;
        conversation_id: string;
        trigger_message_id: string;
      }>(
        'SELECT work_id, conversation_id, trigger_message_id FROM conversation_work_links WHERE tenant_id=$1',
        [tenantId],
      );
      expect(links.rows).toHaveLength(1);
      expect(links.rows[0]?.work_id).toBe(works.rows[0]?.id);
      expect(links.rows[0]?.conversation_id).toBe(conversation.id);
      expect(links.rows[0]?.trigger_message_id).toBe(message.id);
    } finally {
      await db.close();
    }
  });

  it('B3 trace persists WorkRun task, run, and run event rows', async () => {
    const db = new PGlite();
    const at = '2026-08-21T00:00:00.000Z';
    const tenantId = 'tenant-b3-trace';
    const workspaceId = randomUUID();
    const principalId = 'principal-b3-trace';
    const agentDefinitionId = randomUUID();
    const agentVersionId = randomUUID();
    const environmentVersionId = randomUUID();
    const definitionId = randomUUID();
    const versionId = randomUUID();
    const owner = {
      tenantId,
      workspaceId,
      principalType: 'service_account' as const,
      principalId,
    };
    const source = {
      kind: 'single_agent' as const,
      agentVersionId,
      environmentVersionId,
      memoryVersionIds: [],
      inputSchema: {
        type: 'object' as const,
        properties: { query: { type: 'string' as const } },
        required: ['query'],
        additional_properties: false,
      },
    };
    const parsed = validateProductWorkDefinition(`apiVersion: agentserver.dev/v1alpha1
kind: WorkDefinition
metadata:
  name: b3-trace-product-work
  description: B3 trace Product WorkDefinition
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
`);
    if (!parsed.valid) throw new Error(JSON.stringify(parsed.diagnostics));

    try {
      await applyDurableKernelMigrations(db);
      await db.query(
        `INSERT INTO workspaces (id,tenant_id,principal_type,principal_id,name,created_at,updated_at) VALUES($1,$2,'service_account',$3,'B3 trace',$4,$4)`,
        [workspaceId, tenantId, principalId, at],
      );
      const conversations = new PostgresConversationRepository(db as any);
      await conversations.ensureChatRuntime({
        tenantId,
        agentDefinitionId,
        activeAgentVersionId: agentVersionId,
      });
      const conversation = await conversations.findOrCreateDirect({
        tenantId,
        principalId,
        principalType: 'service_account',
        agentDefinitionId,
      });
      const trigger = await postConversationMessage(conversations, {
        author: {
          type: 'principal',
          tenantId,
          conversationId: conversation.id,
          principalType: 'service_account',
          principalId,
        },
        body: '请做正式分析 OpenAI',
      });
      const authoredDefinitions = new PostgresWorkDefinitionSourceRepository(
        db,
      );
      await authoredDefinitions.publish({
        definitionId,
        versionId,
        owner,
        name: 'B3 trace Product Work',
        description: 'B3 trace Product WorkDefinition',
        source,
        fingerprint: fingerprintWorkDefinitionSource(source),
        authorSource: parsed.document,
        authorFingerprint: parsed.fingerprint,
        now: at,
      });
      await authoredDefinitions.associateAgentWorkflow({
        tenantId,
        workspaceId,
        agentDefinitionId,
        definitionId,
        now: at,
      });
      const invokables = new PostgresInvokableRepository(db);
      const resolver = new ResolveWorkDefinition({
        agents: {
          async findDefinition() {
            return null;
          },
          async findVersion(_owner, id) {
            return id === agentVersionId
              ? ({
                  id: agentVersionId,
                  definitionId: randomUUID(),
                  tenantId,
                  workspaceId,
                  principalType: owner.principalType,
                  principalId,
                  status: 'published',
                  displayName: 'B3 trace Agent',
                  fingerprint: `sha256:${'a'.repeat(64)}`,
                } as any)
              : null;
          },
        },
        agentResolution: {
          async resolvePublished(id) {
            return id === agentVersionId
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
          async findVersion(_owner, id) {
            return id === environmentVersionId
              ? ({
                  id: environmentVersionId,
                  definitionId: randomUUID(),
                  tenantId,
                  workspaceId,
                  principalType: owner.principalType,
                  principalId,
                  status: 'published',
                  displayName: 'B3 trace Environment',
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
      const tasks = new PostgresTaskRepository(db as any);
      const runs = new PostgresRunRepository(db as any);
      const admissions = new PostgresAdmissionRepository(db as any);
      const admitRoot = new AdmitRootTask(
        tasks,
        runs,
        admissions,
        () => new Date(at),
      );
      const executionPlane = new ScriptedExecutionPlane();
      const workModule = createWorkModule({
        database: db as any,
        definitions: invokables,
        definitionResolution: resolver,
        execution: {
          async admitRoot(request: any) {
            const receipt = await admitRoot.execute({
              prompt: request.input.text,
              idempotencyKey: request.idempotencyKey,
              accessContext: request.accessContext,
            });
            return { taskId: receipt.taskId, reused: receipt.reused };
          },
        },
        runtimeCapabilities: executionPlane,
        executionFacts: new PostgresExecutionFactQuery(db as any),
        conversations,
      } as any);
      const mcp = new RuntimeMcpServer(
        new RuntimeToolRegistry([
          (context: any) =>
            workModule.contributeRuntime({
              ...context,
              chatContext: {
                conversationId: conversation.id,
                triggerMessageId: trigger.id,
              },
            }),
        ]),
      );
      servers.push(mcp);
      const receipt = mcp.grants.issue({
        tenantId,
        workspaceId,
        principalType: 'service_account',
        principalId,
        scopeId: 'chat-runtime-b3-trace',
        allowedTools: [
          AGENT_SERVER_LIST_AGENT_WORKFLOWS_TOOL_REF,
          AGENT_SERVER_PRODUCT_WORK_RUN_START_TOOL_REF,
        ],
      });
      const session = await executionPlane.createSession({
        runtimeSessionId: 'chat-runtime-b3-trace',
        workspace: { cwd: process.cwd() },
        systemPrompt: `Agent definition ID: ${agentDefinitionId}`,
        extensions: {
          mcpServers: [
            {
              name: 'agent-server',
              url: await mcp.start(),
              headers: { Authorization: `Bearer ${receipt.token}` },
            },
          ],
        },
      });
      await session.session.run({
        runId: 'turn-b3-trace',
        prompt: '请做正式分析 OpenAI',
      });

      const binding = await db.query<{
        work_id: string;
        root_task_id: string;
      }>(
        'SELECT work_id, root_task_id FROM work_runs WHERE tenant_id=$1 AND workspace_id=$2',
        [tenantId, workspaceId],
      );
      expect(binding.rows).toHaveLength(1);
      const bound = binding.rows[0]!;
      expect(bound.root_task_id).toBeTruthy();
      const admittedRun = await runs.findByTaskId(bound.root_task_id);
      if (!admittedRun)
        throw new Error('expected the admitted root Task to have a Run');
      const claim = await runs.claimQueuedById({
        runId: admittedRun.id,
        workerId: 'b3-trace-worker',
        activationId: randomUUID(),
        claimedAt: at,
        leaseExpiresAt: '2026-08-21T00:01:00.000Z',
      });
      if (!claim) throw new Error('expected the admitted Run to be claimable');
      const execute = new ExecuteRun(
        new CompleteRun(runs, tasks),
        tasks,
        invokables,
        new ExecuteTeamTask(invokables, {} as never),
        new FakeAgentRuntime(),
        createLogger({
          service: 'north-star-work-run-trace',
          minimumLevel: 'error',
          write: () => undefined,
        }),
        undefined,
        undefined,
        new PostgresRunEventRepository(db),
      );
      await execute.execute(claim);

      const trace = await db.query<{
        work_run_id: string;
        root_task_id: string;
        task_id: string;
        run_id: string;
        event_run_id: string;
        event_count: number;
        event_types: string[];
        tenant_id: string;
        workspace_id: string;
      }>(
        `SELECT wr.id AS work_run_id,
                wr.root_task_id,
                t.id AS task_id,
                r.id AS run_id,
                re.run_id AS event_run_id,
                count(re.id)::int AS event_count,
                array_agg(re.type ORDER BY re.sequence) AS event_types,
                t.tenant_id,
                t.workspace_id
           FROM work_runs wr
           JOIN tasks t ON t.id = wr.root_task_id
           JOIN runs r ON r.task_id = t.id
           JOIN run_events re ON re.run_id = r.id
          WHERE wr.tenant_id = $1 AND wr.workspace_id = $2
          GROUP BY wr.id, wr.root_task_id, t.id, r.id, re.run_id,
                   t.tenant_id, t.workspace_id`,
        [tenantId, workspaceId],
      );
      expect(trace.rows).toHaveLength(1);
      const row = trace.rows[0]!;
      expect(row.work_run_id).toBeTruthy();
      expect(row.root_task_id).toBe(row.task_id);
      expect(row.task_id).toBeTruthy();
      expect(row.run_id).toBeTruthy();
      expect(row.event_run_id).toBe(row.run_id);
      expect(row.event_count).toBeGreaterThanOrEqual(1);
      expect(row.event_types).toContain('started');
      expect(row.tenant_id).toBe(tenantId);
      expect(row.workspace_id).toBe(workspaceId);
    } finally {
      await db.close();
    }
  });

  it('B3 completes a Work task and wakes its linked Chat', async () => {
    const db = new PGlite();
    const at = '2026-08-21T00:00:00.000Z';
    const tenantId = 'tenant-b3';
    const workspaceId = randomUUID();
    const principalId = 'principal-b3';
    const agentDefinitionId = randomUUID();
    const agentVersionId = randomUUID();
    const environmentVersionId = randomUUID();
    const definitionId = randomUUID();
    const versionId = randomUUID();
    const owner = {
      tenantId,
      workspaceId,
      principalType: 'service_account' as const,
      principalId,
    };
    const source = {
      kind: 'single_agent' as const,
      agentVersionId,
      environmentVersionId,
      memoryVersionIds: [],
      inputSchema: {
        type: 'object' as const,
        properties: { query: { type: 'string' as const } },
        required: ['query'],
        additional_properties: false,
      },
    };
    const parsed =
      validateProductWorkDefinition(`apiVersion: agentserver.dev/v1alpha1
kind: WorkDefinition
metadata:
  name: b3-product-work
  description: B3 Product WorkDefinition
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
`);
    if (!parsed.valid) throw new Error(JSON.stringify(parsed.diagnostics));

    try {
      await applyDurableKernelMigrations(db);
      await db.query(
        `INSERT INTO workspaces (id,tenant_id,principal_type,principal_id,name,created_at,updated_at) VALUES($1,$2,'service_account',$3,'B3',$4,$4)`,
        [workspaceId, tenantId, principalId, at],
      );
      const conversations = new PostgresConversationRepository(db as any);
      await conversations.ensureChatRuntime({
        tenantId,
        agentDefinitionId,
        activeAgentVersionId: agentVersionId,
      });
      const conversation = await conversations.findOrCreateDirect({
        tenantId,
        principalId,
        principalType: 'service_account',
        agentDefinitionId,
      });
      const trigger = await postConversationMessage(conversations, {
        author: {
          type: 'principal',
          tenantId,
          conversationId: conversation.id,
          principalType: 'service_account',
          principalId,
        },
        body: '请做正式分析 OpenAI',
      });
      const authoredDefinitions = new PostgresWorkDefinitionSourceRepository(
        db,
      );
      await authoredDefinitions.publish({
        definitionId,
        versionId,
        owner,
        name: 'B3 Product Work',
        description: 'B3 Product WorkDefinition',
        source,
        fingerprint: fingerprintWorkDefinitionSource(source),
        authorSource: parsed.document,
        authorFingerprint: parsed.fingerprint,
        now: at,
      });
      await authoredDefinitions.associateAgentWorkflow({
        tenantId,
        workspaceId,
        agentDefinitionId,
        definitionId,
        now: at,
      });
      const invokables = new PostgresInvokableRepository(db);
      const resolver = new ResolveWorkDefinition({
        agents: {
          async findDefinition() {
            return null;
          },
          async findVersion(_owner, id) {
            return id === agentVersionId
              ? ({
                  id: agentVersionId,
                  definitionId: randomUUID(),
                  tenantId,
                  workspaceId,
                  principalType: owner.principalType,
                  principalId,
                  status: 'published',
                  displayName: 'B3 Agent',
                  fingerprint: `sha256:${'a'.repeat(64)}`,
                } as any)
              : null;
          },
        },
        agentResolution: {
          async resolvePublished(id) {
            return id === agentVersionId
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
          async findVersion(_owner, id) {
            return id === environmentVersionId
              ? ({
                  id: environmentVersionId,
                  definitionId: randomUUID(),
                  tenantId,
                  workspaceId,
                  principalType: owner.principalType,
                  principalId,
                  status: 'published',
                  displayName: 'B3 Environment',
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
      const tasks = new PostgresTaskRepository(db as any);
      const runs = new PostgresRunRepository(db as any);
      const admissions = new PostgresAdmissionRepository(db as any);
      const admitRoot = new AdmitRootTask(
        tasks,
        runs,
        admissions,
        () => new Date(at),
      );
      const executionPlane = new ScriptedExecutionPlane();
      const workModule = createWorkModule({
        database: db as any,
        definitions: invokables,
        definitionResolution: resolver,
        execution: {
          async admitRoot(request: any) {
            const receipt = await admitRoot.execute({
              prompt: request.input.text,
              idempotencyKey: request.idempotencyKey,
              accessContext: request.accessContext,
            });
            return { taskId: receipt.taskId, reused: receipt.reused };
          },
        },
        runtimeCapabilities: executionPlane,
        executionFacts: new PostgresExecutionFactQuery(db as any),
        conversations,
      } as any);
      const mcp = new RuntimeMcpServer(
        new RuntimeToolRegistry([
          (context: any) =>
            workModule.contributeRuntime({
              ...context,
              chatContext: {
                conversationId: conversation.id,
                triggerMessageId: trigger.id,
              },
            }),
        ]),
      );
      servers.push(mcp);
      const receipt = mcp.grants.issue({
        tenantId,
        workspaceId,
        principalType: 'service_account',
        principalId,
        scopeId: 'chat-runtime-b3',
        allowedTools: [
          AGENT_SERVER_LIST_AGENT_WORKFLOWS_TOOL_REF,
          AGENT_SERVER_PRODUCT_WORK_RUN_START_TOOL_REF,
        ],
      });
      const session = await executionPlane.createSession({
        runtimeSessionId: 'chat-runtime-b3',
        workspace: { cwd: process.cwd() },
        systemPrompt: `Agent definition ID: ${agentDefinitionId}`,
        extensions: {
          mcpServers: [
            {
              name: 'agent-server',
              url: await mcp.start(),
              headers: { Authorization: `Bearer ${receipt.token}` },
            },
          ],
        },
      });
      await session.session.run({
        runId: 'turn-b3',
        prompt: '请做正式分析 OpenAI',
      });

      const binding = await db.query<{ work_id: string; root_task_id: string }>(
        'SELECT work_id, root_task_id FROM work_runs WHERE tenant_id=$1',
        [tenantId],
      );
      expect(binding.rows).toHaveLength(1);
      const bound = binding.rows[0]!;
      expect(bound.root_task_id).toBeTruthy();
      const run = await runs.findByTaskId(bound.root_task_id);
      if (!run)
        throw new Error('expected the admitted root Task to have a Run');
      const claim = await runs.claimQueuedById({
        runId: run.id,
        workerId: 'b3-completion-worker',
        activationId: randomUUID(),
        claimedAt: at,
        leaseExpiresAt: '2026-08-21T00:01:00.000Z',
      });
      if (!claim) throw new Error('expected the admitted Run to be claimable');
      await new CompleteRun(runs, tasks).execute({
        claim,
        run: transitionRun(
          claim.run,
          'succeeded',
          { result: { text: 'B3 completed Work result' } },
          () => new Date('2026-08-21T00:00:01.000Z'),
        ),
      });
      const link = await db.query<{ work_id: string }>(
        'SELECT work_id FROM conversation_work_links WHERE tenant_id=$1',
        [tenantId],
      );
      expect(link.rows).toEqual([{ work_id: bound.work_id }]);
      const wakeDatabase = {
        query: db.query.bind(db),
        async connect() {
          return { query: db.query.bind(db), release() {} };
        },
      };
      const worker = createWorkChatWakeWorker(
        {
          workSource: new PostgresWorkChatWakeWorkSource(wakeDatabase),
          state: new PostgresWorkChatWakeStateRepository(wakeDatabase),
          projection: workModule.createChatWorkCardProjection(),
          conversationWorkLinks: new PostgresConversationWorkLinkRepository(
            db as any,
          ),
          conversations,
          conversationAgentDefinitions:
            new PostgresWorkChatConversationAgentResolver(db as any),
        },
        { workerId: 'b3-work-chat', leaseMs: 60_000, now: () => new Date(at) },
      );
      await worker.processOnce();

      const task = await db.query<{ status: string }>(
        'SELECT status FROM tasks WHERE id=$1',
        [bound.root_task_id],
      );
      expect(task.rows).toEqual([{ status: 'completed' }]);
      const terminalRun = await db.query<{ status: string }>(
        'SELECT status FROM runs WHERE task_id=$1',
        [bound.root_task_id],
      );
      expect(terminalRun.rows).toEqual([{ status: 'succeeded' }]);
      const messages = await db.query<{ work_ref: string }>(
        'SELECT work_ref FROM chat_messages WHERE tenant_id=$1 AND work_ref=$2',
        [tenantId, bound.work_id],
      );
      expect(messages.rows).toEqual([{ work_ref: bound.work_id }]);
    } finally {
      await db.close();
    }
  });
});
