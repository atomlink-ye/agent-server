import { RuntimeReadinessProbe } from '../../src/application/health/readiness.js';
import type { AgentRuntimePort } from '../../src/application/ports/agent-runtime.js';
import { ExecuteRun } from '../../src/application/runs/execute-run.js';
import { GetRun } from '../../src/application/runs/get-run.js';
import { SubmitRun } from '../../src/application/runs/submit-run.js';
import { createApp } from '../../src/entrypoints/api/app.js';
import { InMemoryRunRepository } from '../../src/infrastructure/memory/in-memory-run-repository.js';
import { createLogger } from '../../src/shared/observability/logger.js';

export const testConfig = {
  nodeEnv: 'test',
  host: '127.0.0.1',
  port: 3_000,
  logLevel: 'error',
  serviceName: 'agent-server-test',
  paseo: {
    wsUrl: 'ws://127.0.0.1:6767/ws',
    agentCwd: '/tmp/agent-server-test',
    workspaceTitle: 'Agent Server Test',
    connectTimeoutMs: 1_000,
    executionTimeoutMs: 1_000,
  },
} as const;

export function createTestApp(runtime: AgentRuntimePort) {
  const repository = new InMemoryRunRepository();
  const logger = createLogger({
    service: testConfig.serviceName,
    minimumLevel: 'error',
    write: () => undefined,
  });
  const submitRun = new SubmitRun(repository);
  const getRun = new GetRun(repository);
  const executeRun = new ExecuteRun(repository, runtime, logger);

  return createApp({
    config: testConfig,
    logger,
    readiness: new RuntimeReadinessProbe(runtime),
    runtime,
    submitRun,
    getRun,
    executeRun,
  });
}
