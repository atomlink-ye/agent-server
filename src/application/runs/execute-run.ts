import {
  transitionRun,
  type Run,
  type RunFailure,
} from '../../domain/runs/run.js';
import type { Logger } from '../../shared/observability/logger.js';
import {
  type AgentRuntimePort,
  RuntimeTimedOutError,
} from '../ports/agent-runtime.js';
import type { RunRepository } from '../ports/run-repository.js';

export class ExecuteRun {
  public constructor(
    private readonly repository: RunRepository,
    private readonly runtime: AgentRuntimePort,
    private readonly logger: Logger,
  ) {}

  public async execute(id: string): Promise<Run | null> {
    const queued = await this.repository.findById(id);
    if (!queued || queued.status !== 'queued') {
      return queued;
    }

    const running = transitionRun(queued, 'running');
    await this.repository.save(running);
    this.logger.log('info', 'run.started', { run_id: id });

    try {
      const execution = await this.runtime.execute({
        runId: running.id,
        prompt: running.prompt,
      });
      const succeeded = transitionRun(running, 'succeeded', {
        runtime: {
          provider: execution.provider,
          model: execution.model,
        },
        result: { text: execution.text },
        ...(execution.usage ? { usage: execution.usage } : {}),
      });
      await this.repository.save(succeeded);
      this.logger.log('info', 'run.succeeded', {
        run_id: id,
        provider: execution.provider,
        model: execution.model,
      });
      return succeeded;
    } catch (error) {
      const timedOut = error instanceof RuntimeTimedOutError;
      const failure: RunFailure = timedOut
        ? {
            code: 'runtime_timed_out',
            message: 'The runtime exceeded the configured timeout.',
          }
        : {
            code: 'runtime_execution_failed',
            message: 'The runtime could not complete the run.',
          };
      const failed = transitionRun(running, timedOut ? 'timed_out' : 'failed', {
        error: failure,
      });
      await this.repository.save(failed);
      this.logger.log('error', 'run.failed', {
        run_id: id,
        failure_code: failure.code,
        error_name: error instanceof Error ? error.name : 'UnknownError',
      });
      return failed;
    }
  }
}
