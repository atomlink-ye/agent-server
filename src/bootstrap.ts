import { RuntimeReadinessProbe } from './application/health/readiness.js';
import { ExecuteRun } from './application/runs/execute-run.js';
import { GetRun } from './application/runs/get-run.js';
import { SubmitRun } from './application/runs/submit-run.js';
import { PaseoRuntimeAdapter } from './adapters/paseo/paseo-runtime-adapter.js';
import { createApp } from './entrypoints/api/app.js';
import { InMemoryRunRepository } from './infrastructure/memory/in-memory-run-repository.js';
import type { AppConfig } from './shared/config.js';
import type { Logger } from './shared/observability/logger.js';

export function createService(config: AppConfig, logger: Logger) {
  const repository = new InMemoryRunRepository();
  const runtime = new PaseoRuntimeAdapter(
    {
      wsUrl: config.paseo.wsUrl,
      cwd: config.paseo.agentCwd,
      workspaceTitle: config.paseo.workspaceTitle,
      ...(config.paseo.model ? { requestedModel: config.paseo.model } : {}),
      connectTimeoutMs: config.paseo.connectTimeoutMs,
      executionTimeoutMs: config.paseo.executionTimeoutMs,
    },
    logger,
  );
  const submitRun = new SubmitRun(repository);
  const getRun = new GetRun(repository);
  const executeRun = new ExecuteRun(repository, runtime, logger);
  const readiness = new RuntimeReadinessProbe(runtime);
  const app = createApp({
    config,
    logger,
    readiness,
    runtime,
    submitRun,
    getRun,
    executeRun,
  });

  return { app, runtime };
}
