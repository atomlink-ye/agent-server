import type { AccessContext } from '../../platform/access-context.js';
import type { RunRepository } from './run-repository.js';
import type { TaskRepository } from './task-repository.js';
import type { TeamExecutionRepository } from './team-execution-repository.js';
import type { TeamMessageRepository } from './team-message-repository.js';
import type { AdmissionIngress } from '../sessions/session-turn-origin.js';
import type { CollaborationActivationPriority } from '../../domain/collaboration/collaboration.js';

export type AdmissionOwnerScope = Pick<
  AccessContext,
  'tenantId' | 'workspaceId' | 'principalType' | 'principalId'
>;

interface AdmissionRecordFields {
  readonly sessionId?: string | null;
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

export type AdmissionRecord = AdmissionRecordFields &
  (
    | {
        readonly ingress: Extract<AdmissionIngress, 'api'>;
        readonly originRef: null;
      }
    | {
        readonly ingress: Extract<AdmissionIngress, 'lark'>;
        readonly originRef: string;
      }
  );

export interface AdmissionTransaction {
  readonly tasks: TaskRepository;
  readonly runs: RunRepository;
  readonly teamExecutions?: TeamExecutionRepository;
  readonly teamMessages?: TeamMessageRepository;
  findByIngressAndIdempotencyKey(
    ingress: AdmissionIngress,
    idempotencyKey: string,
    scope: AdmissionOwnerScope,
  ): Promise<AdmissionRecord | null>;
  save(record: AdmissionRecord): Promise<void>;
  enqueueRunDispatch(
    runId: string,
    createdAt: string,
    priority?: CollaborationActivationPriority,
  ): Promise<void>;
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
