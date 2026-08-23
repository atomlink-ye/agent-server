import type { PostgresChannelRepository } from '../infrastructure/postgres/postgres-channel-repository.js';
import type { LarkCanaryEnabledConfig } from '../shared/config.js';
import type { Logger } from '../shared/observability/logger.js';
import type { SubmitSessionTurn } from '../application/sessions/submit-session-turn.js';
import type { MemoryCapabilities } from './create-memory-capabilities.js';
import type { LarkReviewSurfaceRepository } from '../application/ports/lark-review-surface-repository.js';
import type { SynthesizeMemoryDocument } from '../application/channels/synthesize-memory-document.js';
import type { AcceptMemoryFromBoundDocument } from '../application/channels/accept-memory-from-bound-document.js';
import type { MemoryReviewActionTokenDeriver } from '../application/channels/memory-review-action-token.js';
import type { MemoryDocumentPort } from '../application/ports/lark-memory-document.js';
import { ResolveLarkBinding } from '../application/channels/resolve-lark-binding.js';
import { ProcessChannelIngress } from '../application/channels/process-channel-ingress.js';
import { ProcessLarkIngress } from '../application/channels/process-lark-ingress.js';
import { ApplyMemoryReviewCommand } from '../application/channels/apply-memory-review-command.js';
import { ApplyMemoryReviewControl } from '../application/channels/apply-memory-review-control.js';
import { createLarkWebsocketReceiver } from '../adapters/lark/lark-websocket-receiver.js';
import { createLarkDeliveryAdapter } from '../adapters/lark/lark-delivery-adapter.js';
import { larkMemoryReviewCardRenderer } from '../adapters/lark/lark-memory-card.js';
import { DeliverChannelOutbox } from '../application/channels/deliver-channel-outbox.js';
import { LarkIngressWorker } from '../entrypoints/lark/worker.js';
import { LarkOutboxWorker } from '../entrypoints/lark/outbox-worker.js';

export interface LarkChannelWorkers {
  readonly larkWorker: LarkIngressWorker;
  readonly larkOutboxWorker: LarkOutboxWorker;
  readonly larkReceiver: ReturnType<typeof createLarkWebsocketReceiver>;
}

export function createLarkChannelWorkers(input: {
  readonly config: LarkCanaryEnabledConfig;
  readonly repository: PostgresChannelRepository;
  readonly submitSessionTurn: SubmitSessionTurn;
  readonly reviewSurface: LarkReviewSurfaceRepository;
  readonly review: MemoryCapabilities['reviewApi']['review'];
  readonly managedMemory: MemoryCapabilities['reviewApi']['managedMemory'];
  readonly memoryDocument: MemoryDocumentPort | undefined;
  readonly synthesizeMemoryDocument: SynthesizeMemoryDocument;
  readonly acceptMemoryFromDocument: AcceptMemoryFromBoundDocument;
  readonly reviewTokenDeriver: MemoryReviewActionTokenDeriver;
  readonly workerId: string;
  readonly leaseMs: number;
  readonly logger: Logger;
}): LarkChannelWorkers {
  const processMessages = new ProcessChannelIngress(
    new ResolveLarkBinding(input.repository, input.config),
    input.submitSessionTurn,
    input.repository,
    input.config,
  );
  const processIngress = new ProcessLarkIngress(
    processMessages,
    new ApplyMemoryReviewCommand(
      input.repository,
      input.review,
      input.managedMemory,
      input.config,
    ),
    new ApplyMemoryReviewControl(
      input.repository,
      input.reviewSurface,
      input.review,
      input.managedMemory,
      input.config,
      larkMemoryReviewCardRenderer,
      input.memoryDocument,
      input.synthesizeMemoryDocument,
      input.acceptMemoryFromDocument,
    ),
  );
  const larkWorker = new LarkIngressWorker(
    input.repository,
    processIngress,
    {
      workerId: `${input.workerId}:lark`,
      leaseMs: input.leaseMs,
      onError: ({ phase, errorName }) =>
        input.logger.log('error', 'lark.ingress_worker.failed', {
          phase,
          error_name: errorName,
        }),
    },
  );
  const larkOutboxWorker = new LarkOutboxWorker(
    input.repository,
    new DeliverChannelOutbox(
      createLarkDeliveryAdapter(input.config),
      input.repository,
      {
        cards: larkMemoryReviewCardRenderer,
        tokenDeriver: input.reviewTokenDeriver,
        validateCardPublication: (value) =>
          input.reviewSurface.validateCardPublication(value),
        finalizeCardDelivery: (value) =>
          input.reviewSurface.finalizeCardDelivery(value),
        ...(input.config.docWebBaseUrl
          ? { docWebBaseUrl: input.config.docWebBaseUrl }
          : {}),
      },
    ),
    {
      workerId: `${input.workerId}:lark-outbox`,
      leaseMs: input.leaseMs,
      onError: ({ phase, errorName }) =>
        input.logger.log('error', 'lark.outbox_worker.failed', {
          phase,
          error_name: errorName,
        }),
    },
  );
  return {
    larkWorker,
    larkOutboxWorker,
    larkReceiver: createLarkWebsocketReceiver({
      config: input.config,
      repository: input.repository,
    }),
  };
}
