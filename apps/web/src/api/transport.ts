const USER_ID_HEADER = 'x-agent-server-user-id';
const USER_ID_STORAGE_KEY = 'agent-server.user-id';

/**
 * There is no real login/session mechanism yet -- this is a stable
 * per-browser identifier so writes made through the UI can be attributed to
 * a human principal (`principalType: 'user'`) instead of the shared
 * service-account token every browser request otherwise authenticates as.
 * Falls back to a fixed dev id when `localStorage` is unavailable (SSR,
 * private-mode restrictions).
 */
function resolveUserId(): string {
  try {
    const existing = window.localStorage.getItem(USER_ID_STORAGE_KEY);
    if (existing) return existing;
    const generated = `local-dev-user-${crypto.randomUUID()}`;
    window.localStorage.setItem(USER_ID_STORAGE_KEY, generated);
    return generated;
  } catch {
    return 'local-dev-user';
  }
}

export class ApiTransportError extends Error {
  readonly status: number;
  readonly code: string;
  readonly payload: unknown;

  constructor(
    status: number,
    code: string,
    message: string,
    payload: unknown = null,
  ) {
    super(message);
    this.name = 'ApiTransportError';
    this.status = status;
    this.code = code;
    this.payload = payload;
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
          [USER_ID_HEADER]: resolveUserId(),
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
      );
    }
    if (payload === null) {
      throw new ApiTransportError(
        502,
        'invalid_response',
        'The service returned an invalid response.',
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
