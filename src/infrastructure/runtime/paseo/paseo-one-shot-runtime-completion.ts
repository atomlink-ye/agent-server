import type { OneShotRuntimeCompletion } from '../../../application/ports/one-shot-runtime-completion.js';
/** Provider-only completion for bounded channel synthesis; it owns no Agent Server state. */
export class PaseoOneShotRuntimeCompletion implements OneShotRuntimeCompletion {
  public constructor(
    private readonly provider: Pick<import('../../../application/ports/runtime-execution-provider.js').RuntimeExecutionProvider, 'completeOneShot'>,
  ) {}

  public async complete(input: {
    readonly systemPrompt: string;
    readonly prompt: string;
  }) {
    return this.provider.completeOneShot(input);
  }
}
