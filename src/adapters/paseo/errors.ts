export class PaseoConnectionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'PaseoConnectionError';
  }
}

export interface PaseoErrorEvidence {
  readonly errorName: string;
  readonly errorMessage: string;
}

/** The client cannot inspect a session at this SDK boundary. */
export class PaseoClientInspectionUnavailableError extends Error {
  readonly code = 'paseo_client_inspection_unavailable';

  public constructor() {
    super('Paseo session inspection is unavailable at the client boundary.');
    this.name = 'PaseoClientInspectionUnavailableError';
  }
}

/**
 * The provider rejected an operation, but the current client boundary did not
 * expose a structured discriminant that allows a more specific conclusion.
 */
export class PaseoProviderErrorIndistinguishableAtBoundaryError extends Error {
  readonly code = 'provider_error_indistinguishable_at_boundary';
  readonly reason = 'provider_error_indistinguishable_at_boundary';
  readonly evidence: PaseoErrorEvidence;

  public constructor(error: unknown) {
    super(
      'Paseo provider operation failed without a structured boundary discriminant.',
    );
    this.name = 'PaseoProviderErrorIndistinguishableAtBoundaryError';
    this.evidence = sanitizePaseoErrorEvidence(error);
  }
}

/** A provider explicitly identified the requested session as absent. */
export class PaseoProviderBindingStaleError extends Error {
  readonly code = 'provider_binding_stale';

  public constructor() {
    super('Paseo explicitly reported that the bound session is absent.');
    this.name = 'PaseoProviderBindingStaleError';
  }
}

export function sanitizePaseoErrorEvidence(error: unknown): PaseoErrorEvidence {
  const source = error instanceof Error ? error : undefined;
  return {
    errorName: sanitizePaseoErrorText(source?.name ?? 'UnknownError', 120),
    errorMessage: sanitizePaseoErrorText(
      source?.message ?? 'Non-Error rejection at the Paseo boundary.',
      512,
    ),
  };
}

export function sanitizePaseoErrorText(value: string, max: number): string {
  let sanitized = value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '')
    .replace(/[\r\n\t ]+/gu, ' ')
    .trim();
  sanitized = sanitized
    .replace(
      /((?:^|[^\w])(?:authorization|cookie|password|secret|token|credential|access[_-]?key|session[_-]?key|api[_-]?key|private[ _-]?key)\s*[:=]\s*)(?:bearer\s+)?[^\s,;]+/giu,
      '$1[REDACTED]',
    )
    .replace(/\b(?:bearer|basic)\s+[A-Za-z0-9+/._~=-]+/giu, '[REDACTED]')
    .replace(/((?:https?|ftp):\/\/)[^/?#\s]+@/giu, '$1[REDACTED]@');
  return Array.from(sanitized).slice(0, max).join('');
}

/**
 * Only these structured codes prove that the bound provider session is
 * absent. In particular, this deliberately does not inspect error text.
 */
export function isPaseoExplicitMissingSessionError(error: unknown): boolean {
  if (!isRecord(error)) return false;
  const code = error.code;
  return (
    code === 'agent_not_found' ||
    code === 'session_not_found' ||
    code === 'binding_not_found'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export class OpenCodeModelUnavailableError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'OpenCodeModelUnavailableError';
  }
}
