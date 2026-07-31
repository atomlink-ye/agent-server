export class SessionCreationError extends Error {
  constructor(
    readonly code:
      | 'workspace_not_found'
      | 'agent_version_not_found'
      | 'environment_version_not_found'
      | 'environment_required',
  ) {
    super(code);
    this.name = 'SessionCreationError';
  }
}

export class SessionListQueryError extends Error {
  constructor(readonly code: 'invalid_limit' | 'invalid_cursor') {
    super(code);
    this.name = 'SessionListQueryError';
  }
}
