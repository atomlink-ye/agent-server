import type { RuntimeInvocationContext } from '../../domain/runtime/runtime-invocation-context.js';

export interface WorkerRuntimeInvocationResolver {
  resolve(runtimeSessionId: string): Promise<RuntimeInvocationContext | null>;
}
