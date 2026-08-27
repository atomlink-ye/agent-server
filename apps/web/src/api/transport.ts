export class ApiTransportError extends Error {
  readonly status: number;
  readonly code: string;
  readonly payload: unknown;
  readonly requestPath: string | null;

  constructor(
    status: number,
    code: string,
    message: string,
    payload: unknown = null,
    requestPath: string | null = null,
  ) {
    super(message);
    this.name = 'ApiTransportError';
    this.status = status;
    this.code = code;
    this.payload = payload;
    this.requestPath = requestPath;
  }
}

export class ApiTransport {
  async request(path: string, init: RequestInit = {}): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(path, {
        ...init,
        credentials: 'same-origin',
        headers: {
          accept: 'application/json',
          ...(init.body === undefined
            ? {}
            : { 'content-type': 'application/json' }),
          ...init.headers,
        },
      });
    } catch {
      throw new ApiTransportError(
        0,
        'network_error',
        'The service is unavailable.',
        null,
        path,
      );
    }

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const error = asRecord(asRecord(payload)?.error);
      throw new ApiTransportError(
        response.status,
        stringValue(error?.code) ?? 'request_failed',
        stringValue(error?.message) ?? 'The request could not be completed.',
        payload,
        path,
      );
    }
    if (payload === null) {
      throw new ApiTransportError(
        502,
        'invalid_response',
        'The service returned an invalid response.',
        null,
        path,
      );
    }
    return payload;
  }
}

export const apiTransport = new ApiTransport();

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}
