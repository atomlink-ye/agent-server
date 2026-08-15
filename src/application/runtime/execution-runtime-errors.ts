export class RuntimeTimedOutError extends Error {
  public constructor(message = 'The runtime execution timed out.') {
    super(message);
    this.name = 'RuntimeTimedOutError';
  }
}

export class RuntimeExecutionError extends Error {
  public constructor(message = 'The runtime execution failed.') {
    super(message);
    this.name = 'RuntimeExecutionError';
  }
}
