import type { RunDispatcher } from '../../application/ports/run-dispatcher.js';
import { ClaimNextRun } from '../../application/runs/claim-next-run.js';
import { ExecuteRun } from '../../application/runs/execute-run.js';
import type { Logger } from '../../shared/observability/logger.js';

export interface PostgresRunDispatcherOptions {
  readonly pollIntervalMs?: number;
  readonly concurrency?: number;
  readonly idleMaintenanceIntervalMs?: number;
  readonly onIdleMaintenance?: () => Promise<void>;
}

const DEFAULT_POLL_INTERVAL_MS = 50;
const DEFAULT_IDLE_MAINTENANCE_INTERVAL_MS = 5_000;

export class PostgresRunDispatcher implements RunDispatcher {
  readonly #pollIntervalMs: number;
  readonly #concurrency: number;
  readonly #idleMaintenanceIntervalMs: number;
  readonly #onIdleMaintenance: (() => Promise<void>) | undefined;
  readonly #timers = new Set<ReturnType<typeof setTimeout>>();
  readonly #resolveDelays = new Set<() => void>();
  #running = false;
  #stopping = false;
  #loops: Promise<void>[] = [];
  #maintenanceAt = 0;
  #maintenanceInFlight: Promise<void> | null = null;

  public constructor(
    private readonly claimNextRun: ClaimNextRun,
    private readonly executeRun: ExecuteRun,
    private readonly logger: Logger,
    options: PostgresRunDispatcherOptions = {},
  ) {
    this.#pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.#concurrency = options.concurrency ?? 1;
    this.#idleMaintenanceIntervalMs =
      options.idleMaintenanceIntervalMs ?? DEFAULT_IDLE_MAINTENANCE_INTERVAL_MS;
    this.#onIdleMaintenance = options.onIdleMaintenance;
    if (!Number.isInteger(this.#concurrency) || this.#concurrency < 1) {
      throw new Error('Dispatcher concurrency must be a positive integer');
    }
    if (
      !Number.isFinite(this.#idleMaintenanceIntervalMs) ||
      this.#idleMaintenanceIntervalMs <= 0
    ) {
      throw new Error(
        'Dispatcher idle maintenance interval must be a positive number',
      );
    }
  }

  public start(): void {
    if (this.#running) {
      return;
    }

    this.#running = true;
    this.logger.log('info', 'run.dispatch.started', {
      concurrency: this.#concurrency,
    });
    this.#stopping = false;
    this.#maintenanceAt = Date.now();
    this.#loops = Array.from({ length: this.#concurrency }, () =>
      this.runLoop(),
    );
  }

  public async stop(): Promise<void> {
    this.#stopping = true;
    this.#running = false;
    for (const timer of this.#timers) clearTimeout(timer);
    this.#timers.clear();
    for (const resolve of this.#resolveDelays) resolve();
    this.#resolveDelays.clear();

    await Promise.all(this.#loops);
    if (this.#maintenanceInFlight) await this.#maintenanceInFlight;
    this.#loops = [];
  }

  private async runLoop(): Promise<void> {
    while (!this.#stopping) {
      const dispatched = await this.dispatchOnce();

      if (!dispatched && !this.#stopping) {
        await this.runIdleMaintenance();
        await this.delay(this.#pollIntervalMs);
      }
    }
  }

  private async runIdleMaintenance(): Promise<void> {
    if (!this.#onIdleMaintenance) return;
    const now = Date.now();
    if (
      this.#maintenanceInFlight ||
      now - this.#maintenanceAt < this.#idleMaintenanceIntervalMs
    )
      return;
    this.#maintenanceAt = now;
    const maintenance = (async () => {
      try {
        await this.#onIdleMaintenance!();
      } catch (error) {
        this.logger.log('error', 'run.dispatch.idle_maintenance_failed', {
          error_name: error instanceof Error ? error.name : 'UnknownError',
        });
      }
    })();
    this.#maintenanceInFlight = maintenance;
    try {
      await maintenance;
    } finally {
      if (this.#maintenanceInFlight === maintenance)
        this.#maintenanceInFlight = null;
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
      const resolveDelay = () => {
        this.#resolveDelays.delete(resolveDelay);
        resolve();
      };
      this.#resolveDelays.add(resolveDelay);
      const timer = setTimeout(() => {
        this.#timers.delete(timer);
        resolveDelay();
      }, ms);
      timer.unref?.();
      this.#timers.add(timer);
    });
  }
}
