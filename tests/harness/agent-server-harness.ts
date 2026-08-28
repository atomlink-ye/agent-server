import type { StepWorker } from '../../src/shared/workers/step-worker.js';
import { postConversationMessage } from '../../src/application/chat/post-conversation-message.js';

import { createScriptedRuntimeHarness } from './scripted-runtime.js';
import { createTestApp } from '../fixtures/create-test-app.js';
import {
  FixtureRuntimeProvider,
  type FixtureReplayReport,
} from '../fixtures/provider/fixture-runtime-provider.js';
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

export interface AgentServerHarnessOptions {
  readonly fixtureId?: string;
}

export async function createAgentServerHarness(
  options: AgentServerHarnessOptions = {},
) {
  const runtime = createScriptedRuntimeHarness();
  const provider = new FixtureRuntimeProvider(
    options.fixtureId ?? 'baseline-completion',
  );
  const dispatcherControl: {
    dispatcher?: import('../../src/infrastructure/postgres/postgres-run-dispatcher.js').PostgresRunDispatcher;
  } = {};
  const databaseControl: {
    database?: import('../fixtures/create-test-app.js').TestDatabase;
  } = {};
  const applicationControl: { close?: () => Promise<void> } = {};
  // No FakeAgentRuntime: the fixture provider is injected explicitly, and the
  // application is composed by the real createApplication inside createTestApp.
  const app = await createTestApp(undefined, {
    startDispatcher: false,
    runtimeProvider: provider,
    dispatcherControl,
    databaseControl,
    applicationControl,
  });
  const closeApplication = applicationControl.close;
  if (
    !databaseControl.database ||
    !dispatcherControl.dispatcher ||
    !closeApplication
  )
    throw new Error(
      'Fixture harness composition did not expose required controls.',
    );
  const db = databaseControl.database;

  return {
    db,
    app,
    dispatcher: dispatcherControl.dispatcher,
    replayReport: provider.replayReport,
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
    // No `work.scenario` accessor here. `createHarnessProductWork` still passes
    // `agents`/`agentResolution` to ResolveWorkDefinition, which now requires
    // `workers`/`workerResolution` (renamed by the Coworker/Worker split); the
    // mismatch is hidden by an `as any` and throws at runtime. Exposing it from
    // the harness would present a broken route as a working one. It is left
    // untouched and unexercised until a journey actually needs it.
    workers: {
      step: <T>(worker: StepWorker<T>) => worker.step(),
    },
    async dispose() {
      await closeApplication();
      await db.close?.();
    },
  } as const;
}

export type AgentServerHarness = Awaited<
  ReturnType<typeof createAgentServerHarness>
>;
