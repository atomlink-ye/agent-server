import type {
  ExecutionObservationSink,
  ExecutionResult,
  ExecutionRunInput,
} from '../../application/ports/execution-plane.js';
import { ExecutionPlaneUnavailableError } from '../../application/ports/execution-plane.js';
import type { Logger } from '../../shared/observability/logger.js';
import {
  hasPositiveModelUsage,
  mapPaseoFinishStatus,
} from './status-mapper.js';
import { PaseoGateway } from './paseo-gateway.js';
import { PaseoObservationProjector } from './paseo-observation-projector.js';

export interface PaseoTurnRunnerOptions {
  readonly executionTimeoutMs: number;
  readonly executionTimeoutSource?: 'env' | 'default';
  readonly additionalProjectionRoots?: readonly string[];
}

/** Owns exactly one Agent Server Run / Paseo Turn lifetime. */
export class PaseoTurnRunner {
  public constructor(
    private readonly gateway: PaseoGateway,
    private readonly logger: Logger,
    private readonly options: PaseoTurnRunnerOptions,
  ) {}

  public async run(input: {
    readonly run: ExecutionRunInput;
    readonly agentId: string;
    readonly provider: string;
    readonly model: string;
    readonly cwd: string;
    readonly systemPromptBytes?: number | null;
    readonly observer?: ExecutionObservationSink;
  }): Promise<ExecutionResult> {
    const turnPromptBytes = Buffer.byteLength(input.run.prompt, 'utf8');
    const systemPromptBytes = input.systemPromptBytes ?? null;
    const projector = new PaseoObservationProjector({
      agentId: input.agentId,
      provider: input.provider,
      executionCwd: input.cwd,
      additionalRoots: this.options.additionalProjectionRoots,
      ...(input.observer ? { sink: input.observer } : {}),
    });

    const baseline = await this.#bestEffortTimeline(input.agentId);
    const baselineSubagents = await this.#bestEffortSubagents(input.agentId);
    projector.setBaseline(baseline, baselineSubagents);
    projector.emitTurnStarted(input.run.runId);

    let accepting = true;
    let polling = true;
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
    let wakeFallback: (() => void) | undefined;
    const waitForFallback = async (): Promise<void> => {
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          if (fallbackTimer) {
            clearTimeout(fallbackTimer);
            fallbackTimer = undefined;
          }
          if (wakeFallback === finish) wakeFallback = undefined;
          resolve();
        };
        wakeFallback = finish;
        fallbackTimer = setTimeout(finish, 5_000);
        fallbackTimer.unref?.();
      });
    };
    const reconcileNested = async (final: boolean): Promise<void> => {
      const timeline = await this.#bestEffortTimeline(input.agentId);
      if (timeline) projector.consumeParentTimeline(timeline);
      const descriptors = await this.#bestEffortSubagents(input.agentId);
      for (const descriptor of descriptors) {
        const bound = projector.consumeProviderSubagentDescriptor(descriptor);
        if (bound || projector.hasProviderSubagent(descriptor.id)) {
          const childTimeline = await this.#bestEffortChildTimeline(
            input.agentId,
            descriptor.id,
          );
          if (childTimeline)
            projector.consumeChildTimeline(descriptor, childTimeline);
        }
        if (final && descriptor.status !== 'running')
          projector.finalizeProviderSubagent(descriptor);
      }
    };
    const pollNested = async (): Promise<void> => {
      while (polling && accepting) {
        await waitForFallback();
        if (!polling || !accepting) break;
        await reconcileNested(false);
      }
    };

    const unsubscribe = this.gateway.subscribeAgent((event) => {
      if (accepting) projector.consumeStreamEvent(event);
    });
    const unsubscribeSubagents = this.gateway.subscribeProviderSubagents(
      (update) => {
        if (accepting) projector.consumeProviderSubagentUpdate(update);
      },
    );
    let nestedPoll: Promise<void> | null = null;

    try {
      const sendStartedAt = Date.now();
      this.logger.log('info', 'runtime.message.send.started', {
        run_id: input.run.runId,
        elapsed_ms: 0,
        status: 'started',
      });
      await this.gateway.send(input.agentId, input.run.prompt);
      this.logger.log('info', 'runtime.message.send.completed', {
        run_id: input.run.runId,
        elapsed_ms: Date.now() - sendStartedAt,
        status: 'completed',
      });
      nestedPoll = pollNested();

      const waitStartedAt = Date.now();
      this.logger.log('info', 'runtime.wait.started', {
        run_id: input.run.runId,
        elapsed_ms: 0,
        status: 'started',
      });
      this.logger.log('info', 'runtime.execution_budget.effective', {
        marker: 'EXECUTION_BUDGET_EFFECTIVE',
        run_id: input.run.runId,
        source: this.options.executionTimeoutSource ?? 'default',
        value_ms: this.options.executionTimeoutMs,
      });

      let finished;
      let providerWaitStatus: string = 'unknown';
      try {
        finished = await this.gateway.wait(
          input.agentId,
          this.options.executionTimeoutMs,
        );
        providerWaitStatus = finished.status;
      } catch (error) {
        providerWaitStatus = 'error';
        this.logger.log('info', 'runtime.wait.completed', {
          run_id: input.run.runId,
          elapsed_ms: Date.now() - waitStartedAt,
          status: 'error',
        });
        throw new ExecutionPlaneUnavailableError(
          error instanceof Error
            ? `Paseo turn settlement failed: ${error.name}`
            : 'Paseo turn settlement failed.',
        );
      } finally {
        this.logger.log('info', 'runtime.provider.wait.completed', {
          run_id: input.run.runId,
          provider_wait_ms: Date.now() - waitStartedAt,
          system_prompt_bytes: systemPromptBytes,
          turn_prompt_bytes: turnPromptBytes,
          status: providerWaitStatus,
        });
      }
      this.logger.log('info', 'runtime.wait.completed', {
        run_id: input.run.runId,
        elapsed_ms: Date.now() - waitStartedAt,
        status: finished.status,
      });

      accepting = false;
      polling = false;
      wakeFallback?.();
      if (nestedPoll) await nestedPoll;
      await reconcileNested(true);
      const finalTimeline = await this.#bestEffortTimeline(input.agentId);
      await projector.finalize({
        ...(finalTimeline ? { finalTimeline } : {}),
        finalMessage: finished.lastMessage,
        ...(finished.usage ? { usage: finished.usage } : {}),
      });

      const mapped = mapPaseoFinishStatus(finished.status);
      let result: ExecutionResult;
      if (mapped === 'timed_out') {
        const finalEntry = finalTimeline?.entries.at(-1);
        this.logger.log('warn', 'runtime.timeout.timeline_diagnostics', {
          run_id: input.run.runId,
          timeline_available: finalTimeline !== null,
          timeline_entry_count: finalTimeline?.entries.length ?? 0,
          timeline_start_seq: finalTimeline?.startCursor?.seq ?? null,
          timeline_end_seq: finalTimeline?.endCursor?.seq ?? null,
          timeline_last_item_type: finalEntry?.timelineItemType ?? null,
          timeline_last_item_seq: finalEntry?.seqEnd ?? null,
        });
        result = {
          status: 'failed',
          failure: {
            code: 'runtime_timeout',
            message: 'The runtime execution timed out.',
          },
        };
      } else if (mapped === 'failed') {
        result = {
          status: 'failed',
          failure: {
            code: 'runtime_execution_failed',
            message: finished.error ?? 'The runtime execution failed.',
          },
        };
      } else if (finished.lastMessage === null) {
        result = {
          status: 'failed',
          failure: {
            code: 'runtime_execution_failed',
            message: 'Paseo completed without a final assistant message.',
          },
        };
      } else if (!hasPositiveModelUsage(finished.usage)) {
        result = {
          status: 'failed',
          failure: {
            code: 'runtime_execution_failed',
            message: 'Paseo completed without positive model usage evidence.',
          },
        };
      } else {
        result = {
          status: 'completed',
          output: {
            provider: input.provider,
            model: input.model,
            text: finished.lastMessage,
            ...(finished.usage ? { usage: finished.usage } : {}),
          },
        };
      }

      if (input.observer) {
        if (result.status === 'completed')
          await input.observer.emit({
            kind: 'turn_completed',
            provider: result.output.provider,
            model: result.output.model,
          });
        else if (result.status === 'failed')
          await input.observer.emit({
            kind: 'turn_failed',
            failure: result.failure,
          });
      }
      return result;
    } finally {
      accepting = false;
      polling = false;
      wakeFallback?.();
      if (nestedPoll) await nestedPoll.catch(() => undefined);
      await projector.drain().catch(() => undefined);
      unsubscribe?.();
      unsubscribeSubagents?.();
    }
  }

  async #bestEffortTimeline(agentId: string) {
    try {
      return await this.gateway.fetchTimeline(agentId);
    } catch {
      return null;
    }
  }

  async #bestEffortSubagents(agentId: string) {
    try {
      return (await this.gateway.listProviderSubagents(agentId)) ?? [];
    } catch {
      return [];
    }
  }

  async #bestEffortChildTimeline(parentAgentId: string, subagentId: string) {
    try {
      return await this.gateway.fetchProviderSubagentTimeline(
        parentAgentId,
        subagentId,
      );
    } catch {
      return null;
    }
  }
}
