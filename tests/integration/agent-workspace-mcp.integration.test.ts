import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';

import {
  ListAgentHomeEntries,
  ReadAgentHomeEntry,
  WriteAgentHomeEntry,
} from '../../src/application/agents/agent-home.js';
import {
  AGENT_SERVER_WORKSPACE_LIST_TOOL_REF,
  AGENT_SERVER_WORKSPACE_READ_TOOL_REF,
  AGENT_SERVER_WORKSPACE_WRITE_TOOL_REF,
} from '../../src/application/agents/built-in-skills.js';
import type { AuthorizedRuntimeToolContext } from '../../src/application/runtime/authorize-runtime-tool.js';
import { registerAgentWorkspaceMcpTools } from '../../src/entrypoints/mcp/agent-workspace-mcp-tools.js';
import { PostgresAgentHomeDefinitionSource } from '../../src/infrastructure/postgres/postgres-agent-home-definition-source.js';
import { PostgresAgentHomeRepository } from '../../src/infrastructure/postgres/postgres-agent-home-repository.js';
import { PostgresLogicalFileStore } from '../../src/infrastructure/postgres/postgres-logical-file-store.js';
import { applyDurableKernelMigrations } from '../../src/infrastructure/postgres/postgres.js';
import { agentContextScope } from '../../src/domain/context/context-fs.js';

type Handler = (args: Record<string, unknown>) => Promise<{
  isError?: boolean;
  content: { text: string }[];
}>;

let database: PGlite | undefined;

afterEach(async () => {
  await database?.close();
  database = undefined;
});

describe('Coworker workspace MCP persistence', () => {
  it('round-trips through MCP and persists in the canonical agent ContextFS scope', async () => {
    const a = await createClient('tenant-a', 'agent-a');

    const write = await a.handlers.get('workspace_write')!({
      path: 'notes/conclusion.md',
      content: 'Conclusion text',
    });
    expect(write.isError).toBeUndefined();
    expect(JSON.parse(write.content[0]!.text)).toMatchObject({
      path: 'notes/conclusion.md',
      current_version: 1,
      content_size_bytes: 15,
    });

    const listed = await a.handlers.get('workspace_list')!({});
    expect(JSON.parse(listed.content[0]!.text).entries).toHaveLength(1);
    expect(JSON.parse(listed.content[0]!.text).entries[0]).not.toHaveProperty(
      'content',
    );

    const read = await a.handlers.get('workspace_read')!({
      path: 'notes/conclusion.md',
    });
    expect(JSON.parse(read.content[0]!.text).content).toBe('Conclusion text');

    const updated = await a.handlers.get('workspace_write')!({
      path: 'notes/conclusion.md',
      content: 'Updated conclusion',
    });
    expect(JSON.parse(updated.content[0]!.text).current_version).toBe(2);

    const rows = await database!.query<{
      tenant_id: string;
      scope_kind: string;
      scope_key: string;
      path: string;
      current_version: number;
      content: string;
    }>(
      `SELECT tenant_id,scope_kind,scope_key,path,current_version,content
       FROM context_entries`,
    );
    expect(rows.rows).toEqual([
      {
        tenant_id: 'tenant-a',
        scope_kind: 'agent',
        scope_key: 'agent-a',
        path: 'notes/conclusion.md',
        current_version: 2,
        content: 'Updated conclusion',
      },
    ]);
    const snapshots = await database!.query<{
      version: number;
      content: string;
    }>(`SELECT version,content FROM context_entry_snapshots ORDER BY version`);
    expect(snapshots.rows).toEqual([
      { version: 1, content: 'Conclusion text' },
      { version: 2, content: 'Updated conclusion' },
    ]);
    const files = new PostgresLogicalFileStore(database!);
    const canonical = await files.read(
      agentContextScope({ tenantId: 'tenant-a', agentDefinitionId: 'agent-a' }),
      'notes/conclusion.md',
    );
    expect(canonical?.content).toBe('Updated conclusion');
  });

  it('keeps agents and tenants isolated without caller scope controls', async () => {
    const a = await createClient('tenant-a', 'agent-a');
    const otherAgent = await createClient('tenant-a', 'agent-b');
    const otherTenant = await createClient('tenant-b', 'agent-a');

    await a.handlers.get('workspace_write')!({
      path: 'notes/shared-name.md',
      content: 'only agent a',
    });

    expect(
      JSON.parse(
        (await otherAgent.handlers.get('workspace_list')!({})).content[0]!.text,
      ).entries,
    ).toEqual([]);
    expect(
      JSON.parse(
        (await otherTenant.handlers.get('workspace_list')!({})).content[0]!
          .text,
      ).entries,
    ).toEqual([]);

    for (const client of [otherAgent, otherTenant]) {
      const foreignRead = await client.handlers.get('workspace_read')!({
        path: 'notes/shared-name.md',
      });
      expect(foreignRead.isError).toBe(true);
      expect(foreignRead.content[0]!.text).toBe('not_found');

      const foreignWrite = await client.handlers.get('workspace_write')!({
        path: 'notes/shared-name.md',
        content: 'must stay isolated',
      });
      expect(foreignWrite.isError).toBeUndefined();
      const foreignReadAfterWrite = await client.handlers.get(
        'workspace_read',
      )!({ path: 'notes/shared-name.md' });
      expect(JSON.parse(foreignReadAfterWrite.content[0]!.text).content).toBe(
        'must stay isolated',
      );
    }

    const original = await a.handlers.get('workspace_read')!({
      path: 'notes/shared-name.md',
    });
    expect(JSON.parse(original.content[0]!.text).content).toBe('only agent a');

    const forged = await a.handlers.get('workspace_write')!({
      path: 'notes/forged.md',
      content: 'must reject',
      agent_id: 'agent-b',
      namespace: 'agent-shared',
      scope: 'tenant-b',
    });
    expect(forged.isError).toBe(true);
    expect(forged.content[0]!.text).toBe('invalid_request');
    expect(
      JSON.parse((await a.handlers.get('workspace_list')!({})).content[0]!.text)
        .entries,
    ).toHaveLength(1);
  });
});

async function createClient(tenantId: string, agentDefinitionId: string) {
  if (!database) {
    database = new PGlite();
    await applyDurableKernelMigrations(database);
  }
  const repository = new PostgresAgentHomeRepository(database);
  const definitionSource = new PostgresAgentHomeDefinitionSource(database);
  const list = new ListAgentHomeEntries(repository, definitionSource);
  const read = new ReadAgentHomeEntry(repository, definitionSource);
  const write = new WriteAgentHomeEntry(repository);
  const handlers = new Map<string, Handler>();
  const current = grant(tenantId);
  const server = {
    registerTool(
      name: string,
      _config: Record<string, unknown>,
      handler: Handler,
    ) {
      handlers.set(name, handler);
    },
  };
  registerAgentWorkspaceMcpTools({
    server: server as never,
    grant: current,
    async authorize() {
      return current;
    },
    agentHome: { list, read, write },
    agentIdentities: {
      async resolve() {
        return agentDefinitionId;
      },
    },
  });
  return { handlers };
}

function grant(tenantId: string): AuthorizedRuntimeToolContext {
  return {
    grantId: `grant-${tenantId}`,
    tenantId,
    workspaceId: `workspace-${tenantId}`,
    principalType: 'service_account',
    principalId: `service-${tenantId}`,
    scopeId: `runtime-${tenantId}`,
    allowedTools: [
      AGENT_SERVER_WORKSPACE_LIST_TOOL_REF,
      AGENT_SERVER_WORKSPACE_READ_TOOL_REF,
      AGENT_SERVER_WORKSPACE_WRITE_TOOL_REF,
    ],
    catalogTools: [
      AGENT_SERVER_WORKSPACE_LIST_TOOL_REF,
      AGENT_SERVER_WORKSPACE_READ_TOOL_REF,
      AGENT_SERVER_WORKSPACE_WRITE_TOOL_REF,
    ],
    runtimeSession: {} as never,
    generation: {} as never,
    chatContext: {
      conversationId: `conversation-${tenantId}`,
      triggerMessageId: `message-${tenantId}`,
    },
  };
}
