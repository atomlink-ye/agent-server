import { AcceptMemoryFromBoundDocument } from '../application/channels/accept-memory-from-bound-document.js';
import { SynthesizeMemoryDocument } from '../application/channels/synthesize-memory-document.js';
import type { OneShotRuntimeCompletion } from '../application/ports/one-shot-runtime-completion.js';
import type { ExecutionRuntimeService } from '../application/ports/execution-runtime.js';
import type { MemoryReviewApi } from '../application/ports/memory-review-api.js';
import type { CreateChatCapabilitiesOptions, ChatCapabilities } from './create-chat-capabilities.js';
import { createChatCapabilities } from './create-chat-capabilities.js';
import { ExecuteRun, type ExecuteRunOptions } from '../application/runs/execute-run.js';

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

export interface MemoryChannelExecutionConsumers {
  readonly synthesizeMemoryDocument: SynthesizeMemoryDocument;
  readonly acceptMemoryFromDocument: AcceptMemoryFromBoundDocument;
}

export function createMemoryChannelExecutionConsumers(input: {
  readonly runtime: OneShotRuntimeCompletion;
  readonly acceptRuntime: Pick<ExecutionRuntimeService, 'executeTurn'>;
  readonly review: Pick<MemoryReviewApi['review'], 'execute'>;
  readonly managedMemory: Pick<MemoryReviewApi['managedMemory'], 'acceptEntry'>;
  readonly profile: string;
}): MemoryChannelExecutionConsumers {
  return {
    synthesizeMemoryDocument: new SynthesizeMemoryDocument(input.runtime),
    acceptMemoryFromDocument: new AcceptMemoryFromBoundDocument(
      input.acceptRuntime,
      input.review,
      input.managedMemory,
      input.profile,
    ),
  };
}
