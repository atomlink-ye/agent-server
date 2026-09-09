import type {
  WorkPreparation,
  WorkPreparationStatus,
} from '../../domain/work/work-preparation.js';

export interface WorkPreparationOwner {
  readonly tenantId: string;
  readonly workspaceId: string;
}

export interface WorkPreparationRepository {
  findCurrent(input: {
    owner: WorkPreparationOwner;
    workId: string;
  }): Promise<WorkPreparation | null>;
  upsert(input: {
    readonly owner: WorkPreparationOwner;
    readonly workId: string;
    readonly definitionVersionId: string;
    readonly schemaFingerprint: string;
    readonly candidateInput: Readonly<Record<string, unknown>>;
    readonly missing: readonly string[];
    readonly ambiguities: readonly string[];
    readonly status: WorkPreparationStatus;
    readonly now: string;
    readonly sourceMessageId?: string;
  }): Promise<WorkPreparation>;
  beginConfirmation(input: {
    readonly owner: WorkPreparationOwner;
    readonly preparationId: string;
    readonly fingerprint: string;
    readonly startIntent: string;
    readonly workId: string;
    readonly expectedRevision: number;
    readonly now: string;
  }): Promise<WorkPreparation | null>;
  associateRun(input: {
    readonly owner: WorkPreparationOwner;
    readonly preparationId: string;
    readonly workRunId: string;
    readonly now: string;
  }): Promise<WorkPreparation>;
  findByStartIntent(input: {
    readonly owner: WorkPreparationOwner;
    readonly startIntent: string;
  }): Promise<WorkPreparation | null>;
  hasPendingUserMessages?(input: {
    readonly owner: WorkPreparationOwner;
    readonly workId: string;
  }): Promise<boolean>;
}
