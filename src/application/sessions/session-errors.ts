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
