export type WorkPreparationStatus =
  'collecting' | 'ready' | 'starting' | 'started' | 'abandoned';

export interface WorkPreparation {
  readonly id: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly workId: string;
  readonly revision: number;
  readonly status: WorkPreparationStatus;
  readonly definitionVersionId: string;
  readonly schemaFingerprint: string;
  readonly candidateInput: Readonly<Record<string, unknown>>;
  readonly confirmedFingerprint: string | null;
  readonly startIntent: string | null;
  readonly workRunId: string | null;
  readonly sourceMessageId?: string | null;
  readonly missing: readonly string[];
  readonly ambiguities: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}
