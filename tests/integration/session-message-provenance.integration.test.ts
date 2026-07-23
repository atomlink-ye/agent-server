import { afterEach, describe, expect, it } from 'vitest';
import {
  createTestApp,
  defaultPublishedAgentVersionId,
} from '../fixtures/create-test-app.js';
import { FakeAgentRuntime } from '../fixtures/fake-agent-runtime.js';
import { PostgresTaskRepository } from '../../src/infrastructure/postgres/postgres-task-repository.js';

describe('Product Session message provenance on PGlite', () => {
  const databases: Array<{ close: () => Promise<void> }> = [];

  afterEach(async () => {
    for (const database of databases.splice(0)) await database.close();
  });

  it('preserves postMessage message identity when reloading its Task', async () => {
    const databaseControl: { database?: any } = {};
    const sessionControl: {
      repository?: {
        createSession: (input: any) => Promise<{ id: string }>;
        postMessage: (
          id: string,
          text: string,
          key: string,
          owner: any,
        ) => Promise<{ id: string; taskId: string }>;
      };
    } = {};
    await createTestApp(new FakeAgentRuntime(), {
      startDispatcher: false,
      workspaceId: '00000000-0000-4000-8000-00000000f011',
      databaseControl: databaseControl as never,
      sessionRepositoryControl: sessionControl as never,
    });
    databases.push(databaseControl.database!);
    const owner = {
      tenantId: 'tenant_alpha',
      workspaceId: '00000000-0000-4000-8000-00000000f011',
      principalType: 'service_account' as const,
      principalId: 'svc_enabled',
      policySnapshotVersion: 'policy-2026-07-22',
    };
    const session = await sessionControl.repository!.createSession({
      workspaceId: owner.workspaceId,
      agentVersionId: defaultPublishedAgentVersionId,
      owner,
    });
    const message = await sessionControl.repository!.postMessage(
      session.id,
      'provenance regression',
      'pglite-provenance',
      owner,
    );
    const task = await new PostgresTaskRepository(
      databaseControl.database!,
    ).findById(message.taskId);
    expect(task?.sourceMessageId).toBe(message.id);
  });
});
