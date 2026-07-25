import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChannelRepository } from '../../application/ports/channel-repository.js';
import type { ChannelIngress } from '../../domain/channels/channel-event.js';
import type { AppConfig } from '../../shared/config.js';
import type { Logger } from '../../shared/observability/logger.js';
import { loadConfig } from '../../shared/config.js';
import { createLogger } from '../../shared/observability/logger.js';

export type LarkIngressWorkerOptions = {
  readonly workerId: string;
  readonly leaseMs: number;
  readonly pollIntervalMs?: number;
  readonly onError?: (failure: {
    readonly phase: 'claim' | 'complete' | 'loop';
    readonly errorName: string;
  }) => void;
};

const DEFAULT_POLL_INTERVAL_MS = 50;

export class LarkIngressWorker {
  readonly #repository: Pick<
    ChannelRepository,
    'claimIngress' | 'completeIngress'
  >;
  readonly #processor: { execute(ingress: ChannelIngress): Promise<unknown> };
  readonly #options: LarkIngressWorkerOptions & {
    readonly pollIntervalMs: number;
  };
  #running = false;
  #stopping = false;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #resolveDelay: (() => void) | null = null;
  #loop: Promise<void> | null = null;

  public constructor(
    repository: Pick<ChannelRepository, 'claimIngress' | 'completeIngress'>,
    processor: { execute(ingress: ChannelIngress): Promise<unknown> },
    options: LarkIngressWorkerOptions,
  ) {
    this.#repository = repository;
    this.#processor = processor;
    this.#options = {
      ...options,
      pollIntervalMs: options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    };
  }

  public start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#stopping = false;
    this.#loop = this.runLoop().catch((error: unknown) => {
      this.fail('loop', error);
    });
  }

  public async stop(): Promise<void> {
    this.#stopping = true;
    this.#running = false;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    this.#resolveDelay?.();
    this.#resolveDelay = null;
    await this.#loop;
    this.#loop = null;
  }

  private async runLoop(): Promise<void> {
    while (!this.#stopping) {
      const processed = await this.processOnce();
      if (!processed && !this.#stopping)
        await this.delay(this.#options.pollIntervalMs);
    }
  }

  private async processOnce(): Promise<boolean> {
    let ingress: ChannelIngress | null;
    try {
      ingress = await this.#repository.claimIngress(
        this.#options.workerId,
        this.#options.leaseMs,
      );
    } catch (error: unknown) {
      this.fail('claim', error);
      return false;
    }
    if (!ingress) return false;
    try {
      await this.#processor.execute(ingress);
    } catch {
      try {
        await this.#repository.completeIngress({
          ingressId: ingress.id,
          status: 'failed',
          safeErrorCode: 'ingress_processing_failed',
          leaseOwner: ingress.leaseOwner!,
          attemptNumber: ingress.attemptCount,
        });
      } catch (error: unknown) {
        this.fail('complete', error);
      }
    }
    return true;
  }

  private fail(phase: 'claim' | 'complete' | 'loop', error: unknown): void {
    this.#stopping = true;
    this.#running = false;
    const failure = { phase, errorName: safeErrorName(error) } as const;
    try {
      this.#options.onError?.(failure);
    } catch {
      // Failure reporting must not reintroduce a detached rejection.
    }
  }

  private async delay(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      this.#resolveDelay = () => {
        this.#resolveDelay = null;
        resolve();
      };
      const timer = setTimeout(() => {
        if (this.#timer === timer) this.#timer = null;
        this.#resolveDelay?.();
      }, ms);
      timer.unref?.();
      this.#timer = timer;
    });
  }
}

function safeErrorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}

type LarkService = { close(): Promise<void> };

type EntrypointProcess = {
  once(signal: 'SIGINT' | 'SIGTERM', handler: () => void): unknown;
  removeListener(signal: 'SIGINT' | 'SIGTERM', handler: () => void): unknown;
};

export type LarkEntrypointOptions = {
  readonly loadConfig?: () => AppConfig;
  readonly createService?: (
    config: AppConfig,
    logger: Logger,
  ) => Promise<LarkService>;
  readonly createLogger?: (options: {
    readonly service: string;
    readonly minimumLevel: AppConfig['logLevel'];
  }) => Logger;
  readonly process?: EntrypointProcess;
};

export async function runLarkEntrypoint(
  options: LarkEntrypointOptions = {},
): Promise<void> {
  const config = (options.loadConfig ?? loadConfig)();
  if (!config.larkCanary?.enabled) {
    throw new Error('Lark worker requires enabled Lark configuration');
  }
  const logger = (options.createLogger ?? createLogger)({
    service: config.serviceName,
    minimumLevel: config.logLevel,
  });
  const createService =
    options.createService ??
    (async (serviceConfig: AppConfig, serviceLogger: Logger) =>
      (await import('../../bootstrap.js')).createService(
        serviceConfig,
        serviceLogger,
      ));
  const service = await createService(config, logger);
  const process = options.process ?? globalThis.process;

  await new Promise<void>((resolve, reject) => {
    let closed = false;
    const shutdown = (signal: 'SIGINT' | 'SIGTERM') => {
      if (closed) return;
      closed = true;
      process.removeListener('SIGINT', onSigint);
      process.removeListener('SIGTERM', onSigterm);
      logger.log('info', 'lark.worker.stopping', { signal });
      void service.close().then(resolve, () => {
        reject(new Error('Lark worker shutdown failed'));
      });
    };
    const onSigint = () => shutdown('SIGINT');
    const onSigterm = () => shutdown('SIGTERM');
    process.once('SIGINT', onSigint);
    process.once('SIGTERM', onSigterm);
  });
}

async function main(): Promise<void> {
  await runLarkEntrypoint();
}

if (
  resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? '')
) {
  void main().catch(() => {
    process.stderr.write('Lark worker failed to start\n');
    process.exitCode = 1;
  });
}
