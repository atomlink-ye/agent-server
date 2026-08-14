import { afterAll, beforeAll } from 'vitest';

import {
  createTestRunDirectory,
  removeTestRunDirectory,
  type TestRunDirectory,
} from '../../../tooling/environment/run-directory.js';
import {
  startLocalEnvironment,
  type LocalEnvironmentHandle,
} from '../../../tooling/environment/lifecycle.js';
import type { CommandExecutor } from '../../../tooling/environment/compose.js';
import type {
  LocalEnvironmentName,
  LocalEnvironmentUrls,
  RuntimeOverrides,
} from '../../../tooling/environment/types.js';

export interface TestEnvironmentOptions {
  readonly profile: LocalEnvironmentName;
  readonly runtimeOverrides?: RuntimeOverrides;
  readonly keepFailed?: boolean;
  readonly executor?: CommandExecutor;
}

export interface TestEnvironmentHandle {
  readonly run: TestRunDirectory;
  readonly urls: LocalEnvironmentUrls;
  readonly projectName: string;
  stop(outcome?: 'passed' | 'failed'): Promise<void>;
}

export async function startTestEnvironment(
  options: TestEnvironmentOptions,
): Promise<TestEnvironmentHandle> {
  const run = await createTestRunDirectory();
  let local: LocalEnvironmentHandle | undefined;
  try {
    local = await startLocalEnvironment({
      profile: options.profile,
      testMode: true,
      projectName: `agent-server-test-${run.id}`,
      runDirectory: run.path,
      ...(options.runtimeOverrides
        ? { runtimeOverrides: options.runtimeOverrides }
        : {}),
      ...(options.executor ? { executor: options.executor } : {}),
      inheritOutput: false,
    });
  } catch (error) {
    if (!options.keepFailed) await removeTestRunDirectory(run);
    throw error;
  }
  return {
    run,
    urls: local.urls,
    projectName: local.state.projectName,
    stop: async (outcome = 'passed') => {
      let stopError: unknown;
      try {
        await local?.stop();
      } catch (error) {
        stopError = error;
      }
      if (outcome === 'passed' || !options.keepFailed) {
        await removeTestRunDirectory(run);
      }
      if (stopError) throw stopError;
    },
  };
}

export function useTestEnvironment(options: TestEnvironmentOptions): {
  readonly current: () => TestEnvironmentHandle;
  readonly markFailed: () => void;
} {
  let environment: TestEnvironmentHandle | undefined;
  let failed = false;
  beforeAll(async () => {
    environment = await startTestEnvironment(options);
  });
  afterAll(async () => {
    await environment?.stop(failed ? 'failed' : 'passed');
  });
  return {
    current: () => {
      if (!environment) throw new Error('test environment has not started');
      return environment;
    },
    markFailed: () => {
      failed = true;
    },
  };
}
