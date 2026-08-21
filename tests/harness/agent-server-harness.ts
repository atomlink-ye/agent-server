import type { RuntimeMcpServer } from '../../src/infrastructure/extensions/runtime-mcp-server.js';
import type { StepWorker } from '../../src/shared/workers/step-worker.js';
import { postConversationMessage } from '../../src/application/chat/post-conversation-message.js';

import { createPgliteTestDatabase } from './database.js';
import { createHarnessProductWork } from './product-work.js';
import { createScriptedRuntimeHarness } from './scripted-runtime.js';
import {
  seedConversation,
  seedEnvironmentVersion,
  seedGoldenPathWorld,
  seedPublishedAgentVersion,
  seedPublishedTeamVersion,
  seedPublishedWorkDefinition,
  seedWorkEntitlement,
  seedWorkspace,
} from './seed/index.js';

export async function createAgentServerHarness() {
  const database = await createPgliteTestDatabase();
  const servers: RuntimeMcpServer[] = [];
  const runtime = createScriptedRuntimeHarness();
  const db = database.db;

  return {
    db,
    runtime,
    seed: {
      workspace: (options?: Parameters<typeof seedWorkspace>[1]) =>
        seedWorkspace(db, options),
      environmentVersion: (
        owner: Parameters<typeof seedEnvironmentVersion>[1],
        options?: Parameters<typeof seedEnvironmentVersion>[2],
      ) => seedEnvironmentVersion(db, owner, options),
      agentVersion: (
        owner: Parameters<typeof seedPublishedAgentVersion>[1],
        options?: Parameters<typeof seedPublishedAgentVersion>[2],
      ) => seedPublishedAgentVersion(db, owner, options),
      teamVersion: (
        owner: Parameters<typeof seedPublishedTeamVersion>[1],
        options: Parameters<typeof seedPublishedTeamVersion>[2],
      ) => seedPublishedTeamVersion(db, owner, options),
      conversation: (
        owner: Parameters<typeof seedConversation>[1],
        options?: Parameters<typeof seedConversation>[2],
      ) => seedConversation(db, owner, options),
      workEntitlement: (
        owner: Parameters<typeof seedWorkEntitlement>[1],
        input: Parameters<typeof seedWorkEntitlement>[2],
      ) => seedWorkEntitlement(db, owner, input),
      workDefinition: (
        owner: Parameters<typeof seedPublishedWorkDefinition>[1],
        options: Parameters<typeof seedPublishedWorkDefinition>[2],
      ) => seedPublishedWorkDefinition(db, owner, options),
      goldenPath: (options?: Parameters<typeof seedGoldenPathWorld>[1]) =>
        seedGoldenPathWorld(db, options),
    },
    chat: {
      postConversationMessage,
    },
    work: {
      scenario(world: Parameters<typeof createHarnessProductWork>[0]['world']) {
        return createHarnessProductWork({ db, runtime: runtime.plane, world });
      },
    },
    workers: {
      step: <T>(worker: StepWorker<T>) => worker.step(),
    },
    mcp: {
      track(server: RuntimeMcpServer): RuntimeMcpServer {
        servers.push(server);
        return server;
      },
    },
    async dispose() {
      await Promise.allSettled(servers.splice(0).map((server) => server.stop()));
      await database.dispose();
    },
  } as const;
}

export type AgentServerHarness = Awaited<ReturnType<typeof createAgentServerHarness>>;
