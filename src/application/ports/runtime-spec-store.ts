import type {
  RuntimeSession,
  RuntimeSessionId,
  RuntimeSpecRevision,
} from '../../domain/runtime/runtime-session.js';
import type {
  RuntimeSessionSpec,
  RuntimeSessionSpecInput,
} from '../../domain/runtime/runtime-session-spec.js';

export interface RuntimeSpecStore {
  get(
    sessionId: RuntimeSessionId,
    revision: RuntimeSpecRevision,
  ): Promise<RuntimeSessionSpec | null>;
  getDesired(session: RuntimeSession): Promise<RuntimeSessionSpec>;
  /** Implementations construct/validate the digest; callers provide no digest. */
  append(spec: RuntimeSessionSpecInput): Promise<void>;
}
