export class InvalidIdempotencyKeyError extends Error {
  readonly code = 'invalid_idempotency_key';
  constructor() {
    super('A valid idempotency key is required.');
    this.name = 'InvalidIdempotencyKeyError';
  }
}
export class IdempotencyConflictError extends Error {
  readonly code = 'idempotency_conflict';
  constructor() {
    super('The idempotency key was already used for a different request.');
    this.name = 'IdempotencyConflictError';
  }
}
export class AgentNotFoundError extends Error {
  readonly code = 'agent_not_found';
  constructor() {
    super('The requested agent was not found.');
    this.name = 'AgentNotFoundError';
  }
}
export class AgentPackageValidationError extends Error {
  readonly code = 'invalid_agent_package';
  constructor() {
    super('The agent package is invalid.');
    this.name = 'AgentPackageValidationError';
  }
}
