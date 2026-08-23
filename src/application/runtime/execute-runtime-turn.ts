import { createHash } from 'node:crypto';

import type {
  ExecutionObservationSink,
  ExecutionOutput,
  ExecutionResult,
} from '../ports/execution-plane.js';
import type { EnsureRuntimeSession } from '../ports/ensure-runtime-session.js';
import type { RotateRuntimeGrant } from '../ports/rotate-runtime-grant.js';
import type { RuntimeTurnStore } from '../ports/runtime-turn-store.js';
import type {
  RuntimeFailureCode,
  RuntimeTurnId,
  RuntimeTurnSource,
} from '../../domain/runtime/runtime-turn.js';
import type { RuntimeSessionId } from '../../domain/runtime/runtime-session.js';

export interface ExecuteRuntimeTurnInput {
  readonly runtimeSessionId: RuntimeSessionId;
  readonly source: RuntimeTurnSource;
  readonly prompt: string;
  readonly recoveryPrompt?: string;
  readonly observer?: ExecutionObservationSink;
  /** Supplying this makes retries reuse the same durable turn identity. */
  readonly turnId?: RuntimeTurnId;
}

export class RuntimeTurnExecutionError extends Error {
  public constructor(public readonly code: RuntimeFailureCode) {
    super(code);
    this.name = 'RuntimeTurnExecutionError';
  }
}

export class ExecuteRuntimeTurn {
  public constructor(
    private readonly turns: RuntimeTurnStore,
    private readonly ensureRuntimeSession: EnsureRuntimeSession,
    private readonly rotateRuntimeGrant: RotateRuntimeGrant,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async execute(
    input: ExecuteRuntimeTurnInput,
  ): Promise<ExecutionOutput> {
    const created = await this.turns.createPending({
      ...(input.turnId ? { id: input.turnId } : {}),
      runtimeSessionId: input.runtimeSessionId,
      source: input.source,
      promptDigest: null,
      createdAt: this.now().toISOString(),
    });

    let ready: Awaited<ReturnType<EnsureRuntimeSession['execute']>>;
    try {
      ready = await this.ensureRuntimeSession.execute(input.runtimeSessionId);
    } catch (error) {
      const code = mapFailureCode(error);
      await this.fail(created.id, code);
      throw new RuntimeTurnExecutionError(code);
    }

    const actualPrompt =
      ready.resolution === 'reused' ? input.prompt : input.recoveryPrompt;
    if (actualPrompt === undefined) {
      await ready.session.close().catch(() => undefined);
      const code =
        ready.resolution === 'replaced'
          ? 'runtime_replacement_failed'
          : 'runtime_reconfigure_failed';
      await this.fail(created.id, code);
      throw new RuntimeTurnExecutionError(code);
    }

    const promptDigest = createHash('sha256')
      .update(actualPrompt)
      .digest('hex');

    let prepared;
    try {
      prepared = await this.turns.bindGenerationAndPrepare({
        id: created.id,
        generationId: ready.generation.id,
        promptDigest,
      });
    } catch (error) {
      await ready.session.close().catch(() => undefined);
      const code = mapFailureCode(error);
      await this.fail(created.id, code);
      throw new RuntimeTurnExecutionError(code);
    }
    if (!prepared) {
      await ready.session.close().catch(() => undefined);
      const current = await this.turns.findById(created.id);
      if (current?.status === 'cancelled')
        throw new RuntimeTurnExecutionError('runtime_turn_cancelled');
      throw new RuntimeTurnExecutionError('runtime_provider_unavailable');
    }

    let grantRotation: Awaited<ReturnType<RotateRuntimeGrant['execute']>>;
    try {
      grantRotation = await this.rotateRuntimeGrant.execute({
        runtimeSessionId: input.runtimeSessionId,
        generationId: ready.generation.id,
        runtimeTurnId: created.id,
      });
    } catch {
      await ready.session.close().catch(() => undefined);
      await this.fail(created.id, 'runtime_grant_denied');
      throw new RuntimeTurnExecutionError('runtime_grant_denied');
    }
    if (grantRotation.kind === 'denied') {
      await ready.session.close().catch(() => undefined);
      await this.fail(created.id, 'runtime_grant_denied');
      throw new RuntimeTurnExecutionError('runtime_grant_denied');
    }

    let started;
    try {
      started = await this.turns.start({
        id: created.id,
        startedAt: this.now().toISOString(),
      });
    } catch (error) {
      await ready.session.close().catch(() => undefined);
      const code = mapFailureCode(error);
      await this.fail(created.id, code);
      throw new RuntimeTurnExecutionError(code);
    }
    if (!started) {
      await ready.session.close().catch(() => undefined);
      throw new RuntimeTurnExecutionError('runtime_turn_cancelled');
    }

    try {
      const result = await ready.session.run(
        { runId: created.id, prompt: actualPrompt },
        input.observer,
      );
      return await this.complete(created.id, result);
    } catch (error) {
      const code = mapFailureCode(error);
      const failed = await this.fail(created.id, code);
      if (!failed) {
        const current = await this.turns.findById(created.id);
        if (current?.status === 'cancelled')
          throw new RuntimeTurnExecutionError('runtime_turn_cancelled');
      }
      throw new RuntimeTurnExecutionError(code);
    } finally {
      await ready.session.close().catch(() => undefined);
    }
  }

  private async complete(
    id: RuntimeTurnId,
    result: ExecutionResult,
  ): Promise<ExecutionOutput> {
    if (result.status === 'cancelled') {
      await this.turns.cancelRunning({
        id,
        completedAt: this.now().toISOString(),
      });
      throw new RuntimeTurnExecutionError('runtime_turn_cancelled');
    }
    if (result.status === 'failed') {
      const code = mapProviderFailure(result.failure.code);
      const failed =
        code === 'runtime_turn_cancelled'
          ? Boolean(
              await this.turns.cancelRunning({
                id,
                completedAt: this.now().toISOString(),
              }),
            )
          : await this.fail(id, code);
      if (!failed) {
        const current = await this.turns.findById(id);
        if (current?.status === 'cancelled')
          throw new RuntimeTurnExecutionError('runtime_turn_cancelled');
      }
      throw new RuntimeTurnExecutionError(code);
    }
    const succeeded = await this.turns.succeed({
      id,
      completedAt: this.now().toISOString(),
    });
    if (!succeeded) {
      const current = await this.turns.findById(id);
      if (current?.status === 'cancelled')
        throw new RuntimeTurnExecutionError('runtime_turn_cancelled');
      throw new RuntimeTurnExecutionError('runtime_provider_unavailable');
    }
    return result.output;
  }

  private async fail(
    id: RuntimeTurnId,
    failureCode: RuntimeFailureCode,
  ): Promise<boolean> {
    return Boolean(
      await this.turns.fail({
        id,
        failureCode,
        completedAt: this.now().toISOString(),
      }),
    );
  }
}

function mapFailureCode(error: unknown): RuntimeFailureCode {
  if (error instanceof RuntimeTurnExecutionError) return error.code;
  if (
    error instanceof Error &&
    error.message === 'runtime_reconfigure_deferred'
  )
    return 'runtime_reconfigure_failed';
  if (isFailureCode(error)) return error.code;
  return 'runtime_provider_unavailable';
}

function mapProviderFailure(code: string): RuntimeFailureCode {
  if (code === 'runtime_timeout' || code === 'timeout')
    return 'runtime_turn_timed_out';
  if (code === 'runtime_turn_cancelled' || code === 'cancelled')
    return 'runtime_turn_cancelled';
  return 'runtime_provider_unavailable';
}

function isFailureCode(
  value: unknown,
): value is { readonly code: RuntimeFailureCode } {
  if (!value || typeof value !== 'object') return false;
  const code = (value as { readonly code?: unknown }).code;
  return (
    typeof code === 'string' && FAILURE_CODES.has(code as RuntimeFailureCode)
  );
}

const FAILURE_CODES = new Set<RuntimeFailureCode>([
  'runtime_session_not_found',
  'runtime_spec_not_found',
  'runtime_provider_unavailable',
  'runtime_provider_session_missing',
  'runtime_reconfigure_failed',
  'runtime_replacement_failed',
  'runtime_turn_cancelled',
  'runtime_turn_timed_out',
  'runtime_grant_denied',
]);
