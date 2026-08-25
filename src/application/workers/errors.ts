export class WorkerPackageValidationError extends Error {
  public readonly code = 'invalid_worker_package';
  public constructor() {
    super('The Worker package is invalid.');
    this.name = 'WorkerPackageValidationError';
  }
}

export class WorkerNotFoundError extends Error {
  public readonly code = 'worker_not_found';
  public constructor() {
    super('The Worker does not exist.');
    this.name = 'WorkerNotFoundError';
  }
}

export class WorkerIdempotencyConflictError extends Error {
  public readonly code = 'worker_idempotency_conflict';
  public constructor() {
    super('The Worker idempotency key was reused with different input.');
    this.name = 'WorkerIdempotencyConflictError';
  }
}
