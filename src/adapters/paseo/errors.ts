export class PaseoConnectionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'PaseoConnectionError';
  }
}

export class OpenCodeModelUnavailableError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'OpenCodeModelUnavailableError';
  }
}
