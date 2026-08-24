import type { RuntimeSessionGeneration } from '../../domain/runtime/runtime-session-generation.js';
import type { RuntimeSessionSpec } from '../../domain/runtime/runtime-session-spec.js';
import type { ProviderSessionBinding } from '../ports/runtime-execution-provider.js';

/** Builds the provider binding for one durable generation and applied spec. */
export function buildProviderSessionBinding(
  generation: RuntimeSessionGeneration,
  applied: RuntimeSessionSpec,
): ProviderSessionBinding {
  if (!generation.providerWorkspaceId || !generation.providerSessionId)
    throw new Error('runtime_provider_session_missing');
  if (
    generation.runtimeSessionId !== applied.runtimeSessionId ||
    generation.provider !== applied.provider ||
    generation.appliedSpecRevision !== applied.revision
  )
    throw new Error('runtime_provider_session_missing');

  return {
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
  };
}
