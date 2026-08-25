import type { RuntimeSessionOwner } from '../../domain/runtime/runtime-session.js';
import type {
  RuntimeResolvedSkill,
  RuntimeSessionSpec,
} from '../../domain/runtime/runtime-session-spec.js';
import type { DesiredRuntimeSystemPrompt } from '../../domain/runtime/desired-runtime-system-prompt.js';
import type {
  RuntimeSessionId,
  RuntimeSpecRevision,
} from '../../domain/runtime/runtime-session.js';

/**
 * The only external desired runtime values. Digest components are assembled by
 * ResolveRuntimeSessionSpec and must never be supplied by its caller.
 */
export interface RuntimeSessionSpecConfiguration {
  readonly provider: string;
  readonly model: string | null;
  readonly cwd: string;
  readonly contextEpoch: number;
  readonly desiredSystemPrompt: DesiredRuntimeSystemPrompt;
}

/** Exact identity and desired inputs needed for one immutable spec revision. */
export interface ResolveRuntimeSessionSpecInput {
  readonly target:
    | Readonly<{ readonly kind: 'initial' }>
    | Readonly<{
        readonly kind: 'revision';
        readonly runtimeSessionId: RuntimeSessionId;
        readonly revision: RuntimeSpecRevision;
      }>;
  readonly owner: RuntimeSessionOwner;
  readonly subject?:
    | Readonly<{
        readonly kind: 'agent_chat' | 'legacy_agent_task';
        readonly agentVersionId: string;
      }>
    | Readonly<{ readonly kind: 'worker'; readonly workerVersionId: string }>;
  readonly agentVersionId?: string;
  readonly environmentVersionId: string | null;
  readonly resolvedSkills: readonly RuntimeResolvedSkill[];
  readonly toolRefs: readonly string[];
  readonly configuration: RuntimeSessionSpecConfiguration;
}

/** Assembles exactly one complete RuntimeSessionSpec; it has no fallback mode. */
export interface ResolveRuntimeSessionSpec {
  execute(input: ResolveRuntimeSessionSpecInput): RuntimeSessionSpec;
}
