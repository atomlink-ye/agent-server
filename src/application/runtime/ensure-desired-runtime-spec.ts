import type { EnsureDesiredRuntimeSpec } from '../ports/ensure-desired-runtime-spec.js';
import type { ResolveRuntimeSessionSpec } from '../ports/resolve-runtime-session-spec.js';
import type { RuntimeSessionStore } from '../ports/runtime-session-store.js';
import type { RuntimeSpecStore } from '../ports/runtime-spec-store.js';
import { runtimeSpecRevision } from '../../domain/runtime/runtime-session.js';
import { sameDesiredRuntimeSpec } from './reconciliation/compare-runtime-spec.js';

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
    let session = await this.sessions.findByScope(input.owner, input.scope);
    if (!session) {
      const initial = this.resolve(input, { kind: 'initial' });
      session = await this.sessions.createWithInitialSpec({
        owner: input.owner,
        scope: input.scope,
        spec: initial,
      });
    }
    if (session.status === 'closed') throw new Error('runtime_session_closed');

    let persisted = await this.specs.getDesired(session);
    let desired = this.resolve(input, {
      kind: 'revision',
      runtimeSessionId: session.id,
      revision: runtimeSpecRevision(session.desiredSpecRevision + 1),
    });
    if (sameDesiredRuntimeSpec(persisted, desired))
      return { session, spec: persisted };

    let appendError: unknown;
    for (
      let attempt = 0;
      attempt < 2 && !sameDesiredRuntimeSpec(persisted, desired);
      attempt += 1
    ) {
      try {
        await this.specs.append({
          spec: desired,
          expectedDesiredRevision: session.desiredSpecRevision,
        });
        appendError = undefined;
      } catch (error) {
        appendError = error;
      }

      session = await this.sessions.findById(session.id);
      if (!session) throw new Error('Runtime session could not be loaded.');
      persisted = await this.specs.getDesired(session);
      if (sameDesiredRuntimeSpec(persisted, desired))
        return { session, spec: persisted };
      if (appendError && attempt === 1) throw appendError;
      desired = this.resolve(input, {
        kind: 'revision',
        runtimeSessionId: session.id,
        revision: runtimeSpecRevision(session.desiredSpecRevision + 1),
      });
    }
    if (appendError) throw appendError;
    return { session, spec: persisted };
  }
  private resolve(
    input: Parameters<EnsureDesiredRuntimeSpec['execute']>[0],
    target: Parameters<ResolveRuntimeSessionSpec['execute']>[0]['target'],
  ) {
    return this.resolveSpec.execute({
      target,
      owner: input.owner,
      subject: input.subject ?? {
        kind: 'agent_chat' as const,
        agentVersionId: input.agentVersionId ?? '',
      },
      environmentVersionId: input.environmentVersionId,
      resolvedSkills: input.resolvedSkills,
      toolRefs: input.toolRefs,
      configuration: input.configuration,
    });
  }
}
