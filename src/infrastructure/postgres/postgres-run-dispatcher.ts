import type { RunDispatcher } from '../../application/ports/run-dispatcher.js';
import { ClaimNextRun } from '../../application/runs/claim-next-run.js';
import { ExecuteRun } from '../../application/runs/execute-run.js';
import type { Logger } from '../../shared/observability/logger.js';

export interface PostgresRunDispatcherOptions {
  readonly pollIntervalMs?: number;
}

const DEFAULT_POLL_INTERVAL_MS = 50;

export class PostgresRunDispatcher implements RunDispatcher {
  readonly #pollIntervalMs: number;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #resolveDelay: (() => void) | null = null;
  #running = false;
  #stopping = false;
  #loop: Promise<void> | null = null;

  public constructor(
    private readonly claimNextRun: ClaimNextRun,
    private readonly executeRun: ExecuteRun,
    private readonly logger: Logger,
    options: PostgresRunDispatcherOptions = {},
  ) {
    this.#pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  }

  public start(): void {
    if (this.#running) {
      return;
    }

    this.#running = true;
    this.#stopping = false;
    this.#loop = this.runLoop();
  }

  public async stop(): Promise<void> {
    this.#stopping = true;
    this.#running = false;
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    this.#resolveDelay?.();
    this.#resolveDelay = null;

    await this.#loop;
    this.#loop = null;
  }

  private async runLoop(): Promise<void> {
    while (!this.#stopping) {
      const dispatched = await this.dispatchOnce();

      if (!dispatched && !this.#stopping) {
        await this.delay(this.#pollIntervalMs);
      }
    }
  }

  private async dispatchOnce(): Promise<boolean> {
    try {
      if (!(await this.executeRun.ensureRuntimeReady())) {
        return false;
      }

      const claim = await this.claimNextRun.execute();
      if (!claim) {
        return false;
      }

      await this.executeRun.execute(claim);
      return true;
    } catch (error) {
      this.logger.log('error', 'run.dispatch.failed', {
        error_name: error instanceof Error ? error.name : 'UnknownError',
      });
      await this.delay(this.#pollIntervalMs);
      return false;
    }
  }

  private async delay(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      this.#resolveDelay = () => {
        this.#resolveDelay = null;
        resolve();
      };
      const timer = setTimeout(() => {
        if (this.#timer === timer) {
          this.#timer = null;
        }
        this.#resolveDelay?.();
      }, ms);
      timer.unref?.();
      this.#timer = timer;
    });
  }
}
