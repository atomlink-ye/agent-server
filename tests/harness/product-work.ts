import { AdmitRootTask } from '../../src/application/tasks/admit-root-task.js';
import { ResolveWorkDefinition } from '../../src/application/work/resolve-work-definition.js';
import { PostgresAdmissionRepository } from '../../src/infrastructure/postgres/postgres-admission-repository.js';
import { PostgresConversationRepository } from '../../src/infrastructure/postgres/postgres-conversation-repository.js';
import { PostgresExecutionFactQuery } from '../../src/infrastructure/postgres/postgres-execution-fact-query.js';
import { PostgresInvokableRepository } from '../../src/infrastructure/postgres/postgres-invokable-repository.js';
import { PostgresRunRepository } from '../../src/infrastructure/postgres/postgres-run-repository.js';
import { PostgresTaskRepository } from '../../src/infrastructure/postgres/postgres-task-repository.js';
import { PostgresWorkDefinitionSourceRepository } from '../../src/infrastructure/postgres/postgres-work-definition-source-repository.js';
import { createWorkModule } from '../../src/modules/work/work-module.js';
import type { ScriptedExecutionPlane } from '../../src/adapters/runtime/scripted-execution-plane.js';

import type { HarnessDatabase } from './database.js';
import type { HarnessOwner } from './seed/index.js';
import { HARNESS_NOW } from './seed/types.js';

export type HarnessGoldenPathWorld = Readonly<{
  owner: HarnessOwner;
  environment: Readonly<{ definitionId: string; versionId: string }>;
  agent: Readonly<{ definitionId: string; versionId: string }>;
  conversation: Readonly<{ id: string }>;
  workDefinition: Readonly<{ definitionId: string; versionId: string }>;
  triggerMessageId: string;
}>;

/**
 * Compose the real Product Work module around a semantic Golden Path world.
 * Agent/environment lookups are deterministic views over the already seeded
 * versions; all Product Work identity, admission, Task/Run, definition, link,
 * and projection behavior remains production code.
 */
export function createHarnessProductWork(input: {
  readonly db: HarnessDatabase;
  readonly runtime: ScriptedExecutionPlane;
  readonly world: HarnessGoldenPathWorld;
  readonly now?: string;
}) {
  const { db, runtime, world } = input;
  const now = input.now ?? HARNESS_NOW;
  const authoredDefinitions = new PostgresWorkDefinitionSourceRepository(db);
  const invokables = new PostgresInvokableRepository(db);
  const tasks = new PostgresTaskRepository(db as any);
  const runs = new PostgresRunRepository(db as any);
  const admissions = new PostgresAdmissionRepository(db as any);
  const conversations = new PostgresConversationRepository(db as any);
  const admitRoot = new AdmitRootTask(
    tasks,
    runs,
    admissions,
    () => new Date(now),
  );

  const definitionResolution = new ResolveWorkDefinition({
    agents: {
      async findDefinition() {
        return null;
      },
      async findVersion(_owner, id) {
        return id === world.agent.versionId
          ? ({
              id,
              definitionId: world.agent.definitionId,
              tenantId: world.owner.tenantId,
              workspaceId: world.owner.workspaceId,
              principalType: world.owner.principalType,
              principalId: world.owner.principalId,
              status: 'published',
              displayName: 'Harness Agent',
              fingerprint: 'a'.repeat(64),
            } as any)
          : null;
      },
      async findManagedDefinitionByTenant() {
        return null;
      },
      async findVersionByTenant() {
        return null;
      },
    },
    agentResolution: {
      async resolvePublished(id) {
        return id === world.agent.versionId
          ? {
              source: 'managed' as const,
              id,
              instructions: 'Handle deterministic Product Work.',
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
        return id === world.environment.versionId
          ? ({
              id,
              definitionId: world.environment.definitionId,
              tenantId: world.owner.tenantId,
              workspaceId: world.owner.workspaceId,
              principalType: world.owner.principalType,
              principalId: world.owner.principalId,
              status: 'published',
              displayName: 'Harness Environment',
              package: {},
              canonicalJson: '{}',
              fingerprint: 'e'.repeat(64),
              createdAt: now,
              updatedAt: now,
              publishedAt: now,
            } as any)
          : null;
      },
    },
  });

  const workModule = createWorkModule({
    database: db as any,
    definitions: invokables,
    definitionResolution,
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
    runtimeCapabilities: runtime,
    executionFacts: new PostgresExecutionFactQuery(db as any),
    conversations,
  } as any);

  return {
    authoredDefinitions,
    invokables,
    tasks,
    runs,
    admissions,
    admitRoot,
    conversations,
    definitionResolution,
    workModule,
  } as const;
}
