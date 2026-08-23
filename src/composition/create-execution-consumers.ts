import { AcceptMemoryFromBoundDocument } from '../application/channels/accept-memory-from-bound-document.js';
import { SynthesizeMemoryDocument } from '../application/channels/synthesize-memory-document.js';
import type { OneShotRuntimeCompletion } from '../application/ports/one-shot-runtime-completion.js';
import type { MemoryReviewApi } from '../application/ports/memory-review-api.js';
import type { CreateChatCapabilitiesOptions, ChatCapabilities } from './create-chat-capabilities.js';
import { createChatCapabilities } from './create-chat-capabilities.js';
import { ExecuteRun, type ExecuteRunOptions } from '../application/runs/execute-run.js';
import { ExecutionRunRegistry } from '../application/runtime/execution-run-registry.js';
import { ClaimNextRun } from '../application/runs/claim-next-run.js';
import { PostgresRunDispatcher } from '../infrastructure/postgres/postgres-run-dispatcher.js';
import type { RunRepository } from '../application/ports/run-repository.js';
import type { Logger } from '../shared/observability/logger.js';

export function createChatExecutionConsumer(
  options: CreateChatCapabilitiesOptions,
): ChatCapabilities {
  return createChatCapabilities(options);
}

export function createRunExecutionConsumer(
  options: ExecuteRunOptions,
): ExecuteRun {
  return new ExecuteRun(options);
}

export function createRunExecutionRegistry(): ExecutionRunRegistry {
  return new ExecutionRunRegistry();
}

export function createRunDispatcher(input: {
  readonly runs: RunRepository;
  readonly executeRun: ExecuteRun;
  readonly workerId: string;
  readonly leaseDurationMs: number;
  readonly concurrency: number;
  readonly logger: Logger;
  readonly onIdleMaintenance: () => Promise<void>;
}): PostgresRunDispatcher {
  return new PostgresRunDispatcher(
    new ClaimNextRun(input.runs, {
      workerId: input.workerId,
      leaseDurationMs: input.leaseDurationMs,
    }),
    input.executeRun,
    input.logger,
    {
      concurrency: input.concurrency,
      onIdleMaintenance: input.onIdleMaintenance,
    },
  );
}

export interface MemoryChannelExecutionConsumers {
  readonly synthesizeMemoryDocument: SynthesizeMemoryDocument;
  readonly acceptMemoryFromDocument: AcceptMemoryFromBoundDocument;
}

export function createMemoryChannelExecutionConsumers(input: {
  readonly runtime: OneShotRuntimeCompletion;
  readonly review: Pick<MemoryReviewApi['review'], 'execute'>;
  readonly managedMemory: Pick<MemoryReviewApi['managedMemory'], 'acceptEntry'>;
  readonly profile: string;
}): MemoryChannelExecutionConsumers {
  return {
    synthesizeMemoryDocument: new SynthesizeMemoryDocument(input.runtime),
    acceptMemoryFromDocument: new AcceptMemoryFromBoundDocument(
      input.review,
      input.managedMemory,
      input.profile,
    ),
  };
}
