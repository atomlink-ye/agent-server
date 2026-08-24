import type { RuntimeExecutionProvider } from '../ports/runtime-execution-provider.js';
import type { RuntimeGenerationStore } from '../ports/runtime-generation-store.js';
import type { RuntimeSpecStore } from '../ports/runtime-spec-store.js';
import type { RuntimeTurnStore } from '../ports/runtime-turn-store.js';
import type { ReleaseRuntimeGrant } from '../ports/release-runtime-grant.js';
import type { RuntimeTurnId } from '../../domain/runtime/runtime-turn.js';

export interface CancelRuntimeTurnInput {
  readonly turnId: RuntimeTurnId;
}

/** Cancels one durable turn against the generation that actually ran it. */
export class CancelRuntimeTurn {
  public constructor(
    private readonly turns: RuntimeTurnStore,
    private readonly generations: RuntimeGenerationStore,
    private readonly specs: RuntimeSpecStore,
    private readonly provider: Pick<RuntimeExecutionProvider, 'cancelTurn'>,
    private readonly releaseRuntimeGrant: ReleaseRuntimeGrant,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async execute(input: CancelRuntimeTurnInput): Promise<void> {
    const turn = await this.turns.findById(input.turnId);
    if (
      !turn ||
      turn.status === 'succeeded' ||
      turn.status === 'failed' ||
      turn.status === 'cancelled'
    )
      return;

    if (turn.status === 'pending' || turn.status === 'preparing') {
      const cancelled = await this.turns.cancelBeforeRun({
        id: turn.id,
        completedAt: this.now().toISOString(),
      });
      if (cancelled) await this.releaseRuntimeGrant.releaseForTurn(turn.id);
      return;
    }

    if (!turn.generationId) throw new Error('runtime_provider_session_missing');
    const generation = await this.generations.findById(turn.generationId);
    if (!generation) throw new Error('runtime_provider_session_missing');
    if (generation.runtimeSessionId !== turn.runtimeSessionId)
      throw new Error('runtime_provider_session_missing');
    if (!generation.providerWorkspaceId || !generation.providerSessionId)
      throw new Error('runtime_provider_session_missing');
    const applied = await this.specs.get(
      turn.runtimeSessionId,
      generation.appliedSpecRevision,
    );
    if (!applied) throw new Error('runtime_spec_not_found');

    await this.provider.cancelTurn(
      {
        generation: {
          id: generation.id,
          runtimeSessionId: generation.runtimeSessionId,
          provider: generation.provider,
          providerWorkspaceId: generation.providerWorkspaceId,
          providerSessionId: generation.providerSessionId,
          appliedSpecRevision: generation.appliedSpecRevision,
        },
        applied: {
          runtimeSessionId: applied.runtimeSessionId,
          provider: applied.provider,
          model: applied.model,
          cwd: applied.cwd,
          workspaceId: applied.workspaceId,
          revision: applied.revision,
          desiredRevision: applied.revision,
          systemPromptDigest: applied.systemPromptDigest,
          bootstrapSpecDigest: applied.bootstrapDigest,
          endpointEpoch: applied.extensionSetDigest,
        },
      },
      turn.id,
    );
    const cancelled = await this.turns.cancelRunning({
      id: turn.id,
      completedAt: this.now().toISOString(),
    });
    if (cancelled) await this.releaseRuntimeGrant.releaseForTurn(turn.id);
  }
}
