import type {
  RuntimeGenerationId,
  RuntimeSessionId,
  RuntimeSpecRevision,
} from './runtime-session.js';

export type RuntimeSessionGenerationStatus =
  'provisioning' | 'ready' | 'superseded' | 'failed' | 'closed';

/** The sole owner of external provider/session binding facts. */
export interface RuntimeSessionGeneration {
  readonly id: RuntimeGenerationId;
  readonly runtimeSessionId: RuntimeSessionId;
  readonly generation: number;

  readonly provider: string;
  readonly providerWorkspaceId: string | null;
  readonly providerSessionId: string;

  readonly appliedSpecRevision: RuntimeSpecRevision;
  readonly appliedBootstrapDigest: string;

  readonly endpointEpoch: string;

  readonly status: RuntimeSessionGenerationStatus;

  readonly createdAt: string;
  readonly readyAt: string | null;
  readonly supersededAt: string | null;
  readonly closedAt: string | null;
}
