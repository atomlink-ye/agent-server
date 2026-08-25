import type {
  RuntimeScope,
  RuntimeSession,
  RuntimeSessionOwner,
} from '../../domain/runtime/runtime-session.js';
import type { RuntimeSessionSpec } from '../../domain/runtime/runtime-session-spec.js';
import type { RuntimeSessionSpecConfiguration } from './resolve-runtime-session-spec.js';
import type { RuntimeSessionSpecInput } from '../../domain/runtime/runtime-session-spec.js';

export interface EnsureDesiredRuntimeSpecInput {
  readonly owner: RuntimeSessionOwner;
  readonly scope: RuntimeScope;
  readonly subject?:
    | Readonly<{ readonly kind: 'agent_chat' | 'legacy_agent_task'; readonly agentVersionId: string }>
    | Readonly<{ readonly kind: 'worker'; readonly workerVersionId: string }>;
  /** Compatibility for Chat callers. Formal Work must supply Worker subject. */
  readonly agentVersionId?: string;
  readonly environmentVersionId: string | null;
  readonly resolvedSkills: RuntimeSessionSpecInput['resolvedSkills'];
  readonly toolRefs: RuntimeSessionSpecInput['toolRefs'];
  readonly configuration: RuntimeSessionSpecConfiguration;
}

export interface EnsuredDesiredRuntimeSpec {
  readonly session: RuntimeSession;
  readonly spec: RuntimeSessionSpec;
}

export interface EnsureDesiredRuntimeSpec {
  execute(
    input: EnsureDesiredRuntimeSpecInput,
  ): Promise<EnsuredDesiredRuntimeSpec>;
}
