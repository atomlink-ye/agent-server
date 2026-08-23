import type { ExecutionSession } from './runtime-execution-session.js';
import type { RuntimeSessionGeneration } from '../../domain/runtime/runtime-session-generation.js';
import type { RuntimeSessionId } from '../../domain/runtime/runtime-session.js';

export interface ReadyRuntime {
  readonly generation: RuntimeSessionGeneration;
  readonly session: ExecutionSession;
  readonly resolution: 'reused' | 'reconfigured' | 'replaced';
}

/** Resolves a durable RuntimeSession to one ready provider generation. */
export interface EnsureRuntimeSession {
  execute(sessionId: RuntimeSessionId): Promise<ReadyRuntime>;
}
