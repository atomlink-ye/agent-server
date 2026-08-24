import type { EnsureDesiredRuntimeSpec } from '../ports/ensure-desired-runtime-spec.js';
import type { ResolveRuntimeSessionSpec } from '../ports/resolve-runtime-session-spec.js';
import type { RuntimeSessionStore } from '../ports/runtime-session-store.js';
import type { RuntimeSpecStore } from '../ports/runtime-spec-store.js';
import { runtimeSpecRevision } from '../../domain/runtime/runtime-session.js';
import { createRuntimeSessionSpec } from '../../domain/runtime/runtime-session-spec.js';

/** Owns the complete desired-state transition before provider reconciliation. */
export class EnsureDesiredRuntimeSpecService implements EnsureDesiredRuntimeSpec {
  public constructor(
    private readonly sessions: RuntimeSessionStore,
    private readonly specs: RuntimeSpecStore,
    private readonly resolveSpec: ResolveRuntimeSessionSpec,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async execute(
    input: Parameters<EnsureDesiredRuntimeSpec['execute']>[0],
  ) {
    const desired = this.resolveSpec.execute({
      owner: input.owner,
      agentVersionId: input.agentVersionId,
      environmentVersionId: input.environmentVersionId,
      resolvedSkills: input.resolvedSkills,
      toolRefs: input.toolRefs,
      configuration: input.configuration,
    });

    let session = await this.sessions.findByScope(input.owner, input.scope);
    if (!session) {
      session = await this.sessions.createWithInitialSpec({
        owner: input.owner,
        scope: input.scope,
        spec: desired,
      });
    }
    if (session.status === 'closed') throw new Error('runtime_session_closed');

    let persisted = await this.specs.getDesired(session);
    let appendError: unknown;
    for (
      let attempt = 0;
      attempt < 2 && !sameDesiredSpec(persisted, desired);
      attempt += 1
    ) {
      const next = createRuntimeSessionSpec({
        ...desired,
        runtimeSessionId: session.id,
        revision: runtimeSpecRevision(session.desiredSpecRevision + 1),
        createdAt: this.now().toISOString(),
      });
      try {
        await this.specs.append({
          spec: next,
          expectedDesiredRevision: session.desiredSpecRevision,
        });
      } catch (error) {
        appendError = error;
      }

      session = await this.sessions.findById(session.id);
      if (!session) throw new Error('Runtime session could not be loaded.');
      persisted = await this.specs.getDesired(session);
      if (sameDesiredSpec(persisted, desired))
        return { session, spec: persisted };
      if (appendError && attempt === 1) throw appendError;
    }
    if (appendError) throw appendError;
    return { session, spec: persisted };
  }
}

function sameDesiredSpec(
  persisted: Awaited<ReturnType<RuntimeSpecStore['getDesired']>>,
  desired: Awaited<ReturnType<ResolveRuntimeSessionSpec['execute']>>,
): boolean {
  return (
    persisted.workspaceId === desired.workspaceId &&
    persisted.agentVersionId === desired.agentVersionId &&
    persisted.environmentVersionId === desired.environmentVersionId &&
    sameSkills(persisted.resolvedSkills, desired.resolvedSkills) &&
    sameStrings(persisted.toolRefs, desired.toolRefs) &&
    persisted.provider === desired.provider &&
    persisted.model === desired.model &&
    persisted.cwd === desired.cwd &&
    persisted.systemPromptDigest === desired.systemPromptDigest &&
    persisted.skillSetDigest === desired.skillSetDigest &&
    persisted.toolCatalogDigest === desired.toolCatalogDigest &&
    persisted.extensionSetDigest === desired.extensionSetDigest &&
    persisted.contextEpoch === desired.contextEpoch &&
    persisted.bootstrapDigest === desired.bootstrapDigest
  );
}

function sameSkills(
  left: readonly { readonly ref: string; readonly digest: string }[],
  right: readonly { readonly ref: string; readonly digest: string }[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (skill, index) =>
        skill.ref === right[index]?.ref &&
        skill.digest === right[index]?.digest,
    )
  );
}

function sameStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}
