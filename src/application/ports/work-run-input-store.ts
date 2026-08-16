import type { WorkInputSnapshot } from '../../domain/work/work-input-schema.js';
import type { WorkIdentityOwnerScope } from './work-identity-repository.js';

export interface WorkRunInputRecord {
  readonly workRunId: string;
  readonly input: WorkInputSnapshot;
  readonly fingerprint: string;
}

/** Internal durable input fact. Product WorkRun responses deliberately omit it. */
export interface WorkRunInputStore {
  record(input: {
    readonly workRunId: string;
    readonly owner: WorkIdentityOwnerScope;
    readonly snapshot: WorkInputSnapshot;
    readonly fingerprint: string;
  }): Promise<WorkRunInputRecord>;
  find(
    workRunId: string,
    owner: WorkIdentityOwnerScope,
  ): Promise<WorkRunInputRecord | null>;
}
