import type { SubmitSessionTurn } from '../application/sessions/submit-session-turn.js';
import { createMemoryReviewActionTokenDeriver } from '../application/channels/memory-review-action-token.js';
import type { OneShotRuntimeCompletion } from '../application/ports/one-shot-runtime-completion.js';
import { createLarkMemoryDocumentAdapter } from '../adapters/lark/lark-memory-document.js';
import type { LarkReviewSurfaceRepository } from '../application/ports/lark-review-surface-repository.js';
import type { PostgresChannelRepository } from '../infrastructure/postgres/postgres-channel-repository.js';
import type { AppConfig } from '../shared/config.js';
import type { Logger } from '../shared/observability/logger.js';
import { createMemoryChannelExecutionConsumers } from './create-execution-consumers.js';
import {
  createLarkChannelWorkers,
  type LarkChannelWorkers,
} from './create-lark-channel-workers.js';
import { createMemoryReviewSurface } from './create-memory-capabilities.js';
import type { MemoryModule } from './create-memory-capabilities.js';

export interface ChannelComposition {
  readonly memoryReviewSurface?: ReturnType<typeof createMemoryReviewSurface>;
  readonly workers: Partial<LarkChannelWorkers>;
}

export function createChannelComposition(input: {
  readonly config: Pick<AppConfig, 'larkCanary'>;
  readonly repository: PostgresChannelRepository;
  readonly reviewSurface: LarkReviewSurfaceRepository;
  readonly submitSessionTurn: SubmitSessionTurn;
  readonly memory: Pick<MemoryModule, 'reviewApi'>;
  readonly oneShotCompletion: OneShotRuntimeCompletion;
  readonly workerId: string;
  readonly leaseMs: number;
  readonly logger: Logger;
}): ChannelComposition {
  const config = input.config.larkCanary;
  if (!config?.enabled) return { workers: {} };

  const reviewTokenDeriver = createMemoryReviewActionTokenDeriver(
    config.appSecret,
  );
  const memoryDocument = createLarkMemoryDocumentAdapter(config);
  const memoryReviewSurface = createMemoryReviewSurface({
    module: input.memory,
    channels: input.repository,
    reviewSurface: input.reviewSurface,
    config,
    tokenDeriver: reviewTokenDeriver,
    document: memoryDocument,
  });
  const { synthesizeMemoryDocument, acceptMemoryFromDocument } =
    createMemoryChannelExecutionConsumers({
      runtime: input.oneShotCompletion,
      review: input.memory.reviewApi.review,
      managedMemory: input.memory.reviewApi.managedMemory,
      profile: process.env.LARK_CLI_PROFILE ?? 'agent-test',
    });

  return {
    memoryReviewSurface,
    workers: createLarkChannelWorkers({
      config,
      repository: input.repository,
      submitSessionTurn: input.submitSessionTurn,
      reviewSurface: input.reviewSurface,
      review: input.memory.reviewApi.review,
      managedMemory: input.memory.reviewApi.managedMemory,
      memoryDocument,
      synthesizeMemoryDocument,
      acceptMemoryFromDocument,
      reviewTokenDeriver,
      workerId: input.workerId,
      leaseMs: input.leaseMs,
      logger: input.logger,
    }),
  };
}
