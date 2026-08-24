import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  applyDurableKernelMigrations,
  createPostgresPool,
} from '../../src/infrastructure/postgres/postgres.js';
import { PostgresAgentHomeRepository } from '../../src/infrastructure/postgres/postgres-agent-home-repository.js';
import { PostgresAgentHomeDefinitionSource } from '../../src/infrastructure/postgres/postgres-agent-home-definition-source.js';
import {
  ListAgentHomeEntries,
  ReadAgentHomeEntry,
  WriteAgentHomeEntry,
} from '../../src/application/agents/agent-home.js';
import type { AccessContext } from '../../src/domain/access-context.js';
import { AgentHomeNamespaceReadOnlyError } from '../../src/domain/agents/agent-home.js';

const tenantId = 'tenant_test';
const workspaceId = 'workspace_test';
const agentDefinitionId1 = randomUUID();
const agentDefinitionId2 = randomUUID();

const accessContext: AccessContext = {
  tenantId,
  workspaceId,
  principalType: 'service_account',
  principalId: 'principal_test',
  policySnapshotVersion: '1',
};

async function setupDatabase(): Promise<PGlite> {
  const db = new PGlite();
  await applyDurableKernelMigrations(db);
  return db;
}

async function insertAgentVersion(
  db: PGlite,
  agentDefinitionId: string,
  instructions: string,
  description: string | null,
): Promise<void> {
  // Insert definition
  await db.query(
    `INSERT INTO agent_definitions (id, tenant_id, workspace_id, principal_type, principal_id, name, created_at, updated_at)
     VALUES ($1, $2, $3, 'service_account', $4, 'Test Agent', NOW(), NOW())`,
    [agentDefinitionId, tenantId, workspaceId, 'principal_test'],
  );

  // Insert version
  await db.query(
    `INSERT INTO agent_versions (id, definition_id, tenant_id, workspace_id, principal_type, principal_id, status, name, description, instructions, created_at, updated_at, published_at)
     VALUES ($1, $2, $3, $4, 'service_account', $5, 'published', 'Test Agent', $6, $7, NOW(), NOW(), NOW())`,
    [
      randomUUID(),
      agentDefinitionId,
      tenantId,
      workspaceId,
      'principal_test',
      description,
      instructions,
    ],
  );
}

describe('Agent Home VFS Integration Tests', () => {
  let db: PGlite;
  let repository: PostgresAgentHomeRepository;
  let definitionSource: PostgresAgentHomeDefinitionSource;
  let listEntries: ListAgentHomeEntries;
  let readEntry: ReadAgentHomeEntry;
  let writeEntry: WriteAgentHomeEntry;

  beforeEach(async () => {
    db = await setupDatabase();
    repository = new PostgresAgentHomeRepository(db);
    definitionSource = new PostgresAgentHomeDefinitionSource(db);
    listEntries = new ListAgentHomeEntries(repository, definitionSource);
    readEntry = new ReadAgentHomeEntry(repository, definitionSource);
    writeEntry = new WriteAgentHomeEntry(repository);
  });

  afterAll(async () => {
    await db.close?.();
  });

  describe('Namespace isolation by agent_definition_id', () => {
    it('writes to same path with different agents do not cross-contaminate', async () => {
      const path = 'notes/plan.md';
      const content1 = 'Agent A notes';
      const content2 = 'Agent B notes';

      // Agent A writes to space namespace
      await writeEntry.execute({
        accessContext,
        agentDefinitionId: agentDefinitionId1,
        namespace: 'space',
        scopeParams: { workspaceId },
        path,
        content: content1,
      });

      // Agent B writes to same space/path
      await writeEntry.execute({
        accessContext,
        agentDefinitionId: agentDefinitionId2,
        namespace: 'space',
        scopeParams: { workspaceId },
        path,
        content: content2,
      });

      // List entries for Agent A
      const entriesA = await listEntries.execute({
        accessContext,
        agentDefinitionId: agentDefinitionId1,
        namespace: 'space',
        scopeParams: { workspaceId },
      });

      // List entries for Agent B
      const entriesB = await listEntries.execute({
        accessContext,
        agentDefinitionId: agentDefinitionId2,
        namespace: 'space',
        scopeParams: { workspaceId },
      });

      // Each agent should have exactly one entry
      expect(entriesA).not.toBeNull();
      expect(entriesB).not.toBeNull();
      expect(entriesA?.length).toBe(1);
      expect(entriesB?.length).toBe(1);

      // Content should not cross-contaminate
      const entryA = entriesA?.[0];
      expect(entryA).toBeDefined();
      expect(entryA?.content).toBe(content1);
      const entryB = entriesB?.[0];
      expect(entryB).toBeDefined();
      expect(entryB?.content).toBe(content2);
    });

    it('read operations return correct agent-specific content', async () => {
      const path = 'config.json';
      const contentA = '{"agent":"A"}';
      const contentB = '{"agent":"B"}';

      // Write for both agents
      await writeEntry.execute({
        accessContext,
        agentDefinitionId: agentDefinitionId1,
        namespace: 'organization',
        scopeParams: {},
        path,
        content: contentA,
      });

      await writeEntry.execute({
        accessContext,
        agentDefinitionId: agentDefinitionId2,
        namespace: 'organization',
        scopeParams: {},
        path,
        content: contentB,
      });

      // Read for each agent
      const entryA = await readEntry.execute({
        accessContext,
        agentDefinitionId: agentDefinitionId1,
        namespace: 'organization',
        scopeParams: {},
        path,
      });

      const entryB = await readEntry.execute({
        accessContext,
        agentDefinitionId: agentDefinitionId2,
        namespace: 'organization',
        scopeParams: {},
        path,
      });

      expect(entryA?.content).toBe(contentA);
      expect(entryB?.content).toBe(contentB);
    });
  });

  describe('Definition namespace', () => {
    it('read-only: throws when attempting write to definition namespace', async () => {
      await expect(
        writeEntry.execute({
          accessContext,
          agentDefinitionId: agentDefinitionId1,
          namespace: 'definition',
          scopeParams: {},
          path: 'anything.md',
          content: 'should fail',
        }),
      ).rejects.toThrow(AgentHomeNamespaceReadOnlyError);
    });

    it('list and read return synthetic entries from agent_versions', async () => {
      const instructions = 'Be helpful and harmless.';
      const description = 'A test agent for integration testing.';
      await insertAgentVersion(
        db,
        agentDefinitionId1,
        instructions,
        description,
      );

      // List definition namespace
      const entries = await listEntries.execute({
        accessContext,
        agentDefinitionId: agentDefinitionId1,
        namespace: 'definition',
        scopeParams: {},
      });

      expect(entries).not.toBeNull();
      expect(entries?.length).toBe(2);
      const entry0 = entries?.[0];
      expect(entry0).toBeDefined();
      expect(entry0?.path).toBe('instructions/README.md');
      expect(entry0?.content).toBe(instructions);
      const entry1 = entries?.[1];
      expect(entry1).toBeDefined();
      expect(entry1?.path).toBe('metadata.json');
      expect(JSON.parse(entry1?.content || '{}')).toEqual({
        description,
      });

      // Read specific entries
      const readmeEntry = await readEntry.execute({
        accessContext,
        agentDefinitionId: agentDefinitionId1,
        namespace: 'definition',
        scopeParams: {},
        path: 'instructions/README.md',
      });

      expect(readmeEntry?.content).toBe(instructions);

      const metadataEntry = await readEntry.execute({
        accessContext,
        agentDefinitionId: agentDefinitionId1,
        namespace: 'definition',
        scopeParams: {},
        path: 'metadata.json',
      });

      expect(JSON.parse(metadataEntry?.content || '{}')).toEqual({
        description,
      });
    });
  });

  describe('All namespaces have working paths', () => {
    it('organization namespace: write and read', async () => {
      const path = 'org/settings.yaml';
      const content = 'org_setting: value';

      await writeEntry.execute({
        accessContext,
        agentDefinitionId: agentDefinitionId1,
        namespace: 'organization',
        scopeParams: {},
        path,
        content,
      });

      const entry = await readEntry.execute({
        accessContext,
        agentDefinitionId: agentDefinitionId1,
        namespace: 'organization',
        scopeParams: {},
        path,
      });

      expect(entry?.content).toBe(content);
      expect(entry?.path).toBe(path);
    });

    it('space namespace: write and read', async () => {
      const path = 'space/data.txt';
      const content = 'space data';

      await writeEntry.execute({
        accessContext,
        agentDefinitionId: agentDefinitionId1,
        namespace: 'space',
        scopeParams: { workspaceId: 'workspace_abc' },
        path,
        content,
      });

      const entry = await readEntry.execute({
        accessContext,
        agentDefinitionId: agentDefinitionId1,
        namespace: 'space',
        scopeParams: { workspaceId: 'workspace_abc' },
        path,
      });

      expect(entry?.content).toBe(content);
    });

    it('agent-shared namespace: write and read', async () => {
      const path = 'shared/resource.json';
      const content = '{"shared": true}';

      await writeEntry.execute({
        accessContext,
        agentDefinitionId: agentDefinitionId1,
        namespace: 'agent-shared',
        scopeParams: { workspaceId: 'workspace_xyz' },
        path,
        content,
      });

      const entry = await readEntry.execute({
        accessContext,
        agentDefinitionId: agentDefinitionId1,
        namespace: 'agent-shared',
        scopeParams: { workspaceId: 'workspace_xyz' },
        path,
      });

      expect(entry?.content).toBe(content);
    });

    it('user namespace: write and read', async () => {
      const path = 'user/preferences.json';
      const content = '{"theme": "dark"}';

      await writeEntry.execute({
        accessContext,
        agentDefinitionId: agentDefinitionId1,
        namespace: 'user',
        scopeParams: {},
        path,
        content,
      });

      const entry = await readEntry.execute({
        accessContext,
        agentDefinitionId: agentDefinitionId1,
        namespace: 'user',
        scopeParams: {},
        path,
      });

      expect(entry?.content).toBe(content);
    });

    it('conversation namespace: write and read', async () => {
      const path = 'conversation/history.txt';
      const content = 'Message history here';

      await writeEntry.execute({
        accessContext,
        agentDefinitionId: agentDefinitionId1,
        namespace: 'conversation',
        scopeParams: { conversationId: 'conv_123' },
        path,
        content,
      });

      const entry = await readEntry.execute({
        accessContext,
        agentDefinitionId: agentDefinitionId1,
        namespace: 'conversation',
        scopeParams: { conversationId: 'conv_123' },
        path,
      });

      expect(entry?.content).toBe(content);
    });

    it('work namespace: write and read', async () => {
      const path = 'work/todo.md';
      const content = '- [ ] Task 1\n- [ ] Task 2';

      await writeEntry.execute({
        accessContext,
        agentDefinitionId: agentDefinitionId1,
        namespace: 'work',
        scopeParams: { workId: 'work_456' },
        path,
        content,
      });

      const entry = await readEntry.execute({
        accessContext,
        agentDefinitionId: agentDefinitionId1,
        namespace: 'work',
        scopeParams: { workId: 'work_456' },
        path,
      });

      expect(entry?.content).toBe(content);
    });

    it('scratch namespace: write and read', async () => {
      const path = 'scratch/temp.txt';
      const content = 'Temporary scratchpad';

      await writeEntry.execute({
        accessContext,
        agentDefinitionId: agentDefinitionId1,
        namespace: 'scratch',
        scopeParams: { runtimeSessionId: 'session_789' },
        path,
        content,
      });

      const entry = await readEntry.execute({
        accessContext,
        agentDefinitionId: agentDefinitionId1,
        namespace: 'scratch',
        scopeParams: { runtimeSessionId: 'session_789' },
        path,
      });

      expect(entry?.content).toBe(content);
    });
  });

  describe('List operation returns all entries in namespace', () => {
    it('returns all entries written to a namespace', async () => {
      const paths = ['file1.txt', 'file2.txt', 'file3.txt'];
      const contents = ['content1', 'content2', 'content3'];

      for (let i = 0; i < paths.length; i++) {
        await writeEntry.execute({
          accessContext,
          agentDefinitionId: agentDefinitionId1,
          namespace: 'organization',
          scopeParams: {},
          path: paths[i]!,
          content: contents[i]!,
        });
      }

      const entries = await listEntries.execute({
        accessContext,
        agentDefinitionId: agentDefinitionId1,
        namespace: 'organization',
        scopeParams: {},
      });

      expect(entries?.length).toBe(3);
      expect(entries?.map((e) => e.path).sort()).toEqual(paths.sort());
    });
  });

  describe('Version tracking', () => {
    it('updates version and creates snapshot on write', async () => {
      const path = 'versioned.txt';

      const entry1 = await writeEntry.execute({
        accessContext,
        agentDefinitionId: agentDefinitionId1,
        namespace: 'organization',
        scopeParams: {},
        path,
        content: 'Version 1',
      });

      expect(entry1?.currentVersion).toBe(1);

      const entry2 = await writeEntry.execute({
        accessContext,
        agentDefinitionId: agentDefinitionId1,
        namespace: 'organization',
        scopeParams: {},
        path,
        content: 'Version 2',
      });

      expect(entry2?.currentVersion).toBe(2);
      expect(entry2?.content).toBe('Version 2');
    });
  });
});
