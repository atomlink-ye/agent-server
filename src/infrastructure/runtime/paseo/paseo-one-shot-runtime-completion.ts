import { randomUUID } from 'node:crypto';
import type { OneShotRuntimeCompletion } from '../../../application/ports/one-shot-runtime-completion.js';
import type { RuntimeExecutionProvider } from '../../../application/ports/runtime-execution-provider.js';
import type { ProviderRuntimeSpec } from '../../../application/ports/runtime-execution-provider.js';
import type { RuntimeSessionId } from '../../../domain/runtime/runtime-session.js';

/** Provider-only completion for bounded channel synthesis; it owns no Agent Server state. */
export class PaseoOneShotRuntimeCompletion implements OneShotRuntimeCompletion {
  public constructor(
    private readonly provider: RuntimeExecutionProvider,
    private readonly spec: Omit<ProviderRuntimeSpec, 'runtimeSessionId' | 'systemPrompt'>,
  ) {}

  public async complete(input: {
    readonly systemPrompt: string;
    readonly prompt: string;
  }) {
    const created = await this.provider.create({
      ...this.spec,
      runtimeSessionId: randomUUID() as RuntimeSessionId,
      systemPrompt: input.systemPrompt,
    });
    try {
      const result = await created.session.run({
        runId: randomUUID(),
        prompt: input.prompt,
      });
      if (result.status === 'failed') throw new Error('runtime_provider_unavailable');
      if (result.status === 'cancelled') throw new Error('runtime_turn_cancelled');
      return result.output;
    } finally {
      await created.session.close().catch(() => undefined);
    }
  }
}
