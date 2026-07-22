import type { AccessContext } from '../control-plane/access-context.js';
import type { RunRepository } from './run-repository.js';
import type { TaskRepository } from './task-repository.js';

export type AdmissionOwnerScope = Pick<
  AccessContext,
  'tenantId' | 'workspaceId' | 'principalType' | 'principalId'
>;

export interface AdmissionRecord {
  readonly ingress: 'api';
  readonly idempotencyKey: string;
  readonly requestFingerprint: string;
  readonly taskId: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly principalType: string;
  readonly principalId: string;
  readonly policySnapshotVersion: string;
  readonly createdAt: string;
}

export interface AdmissionTransaction {
  readonly tasks: TaskRepository;
  readonly runs: RunRepository;
  findByIngressAndIdempotencyKey(
    ingress: 'api',
    idempotencyKey: string,
    scope: AdmissionOwnerScope,
  ): Promise<AdmissionRecord | null>;
  save(record: AdmissionRecord): Promise<void>;
  enqueueRunDispatch(runId: string, createdAt: string): Promise<void>;
}

export interface AdmissionRepository {
  withTransaction<T>(
    work: (transaction: AdmissionTransaction) => Promise<T>,
  ): Promise<T>;
}

export class AdmissionAlreadyExistsError extends Error {
  public constructor() {
    super('The idempotency key was admitted concurrently.');
    this.name = 'AdmissionAlreadyExistsError';
  }
}
