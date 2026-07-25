import type { RunStatus } from '../../domain/runs/run-status.js';

export const runEventTypes = [
  'started',
  'output',
  'succeeded',
  'failed',
  'cancelled',
] as const;
export type RunEventType = (typeof runEventTypes)[number];
export interface RunEvent {
  readonly id: string;
  readonly runId: string;
  readonly sequence: number;
  readonly type: RunEventType;
  readonly payload: Readonly<Record<string, string | number | boolean | null>>;
  readonly createdAt: string;
}
export interface RuntimeSessionBinding {
  readonly runId: string;
  readonly sessionId?: string | null;
  readonly providerAgentId?: string;
  readonly createdAt: string;
}
export interface RunEventRepository {
  bind(input: RuntimeSessionBinding): Promise<void>;
  getBinding(runId: string): Promise<RuntimeSessionBinding | null>;
  findLatestProviderAgentBySessionId(sessionId: string): Promise<string | null>;
  getProviderBindingForRunInSession(
    runId: string,
    sessionId: string,
  ): Promise<{
    readonly runId: string;
    readonly sessionId: string;
    readonly providerAgentId: string;
  } | null>;
  append(
    runId: string,
    type: RunEventType,
    payload: RunEvent['payload'],
  ): Promise<RunEvent>;
  list(
    runId: string,
    after: number,
    limit?: number,
  ): Promise<{ events: readonly RunEvent[]; nextCursor: number | null }>;
}
export function terminalEventForStatus(status: RunStatus): RunEventType | null {
  return status === 'succeeded'
    ? 'succeeded'
    : status === 'cancelled'
      ? 'cancelled'
      : status === 'failed' || status === 'timed_out'
        ? 'failed'
        : null;
}
