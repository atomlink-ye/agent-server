export type CoworkerRuntimeStatus = 'available' | 'draining' | 'unavailable';

export interface Coworker {
  readonly id: string;
  readonly displayName: string;
  readonly roleLabel: string | null;
  readonly summary: string | null;
  readonly activeAgentVersionId: string;
  readonly runtimeStatus: CoworkerRuntimeStatus;
}
