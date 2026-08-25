import type { AppConfig } from '../../../shared/config.js';

const NO_STORE_HEADERS = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
} as const;

const MAX_UPSTREAM_JSON_BYTES = 1 * 1024 * 1024;

/**
 * Returned by `readJson` when the upstream body was rejected only because it
 * was too large to safely buffer, never because it failed to parse. Callers
 * that need to tell "too large" apart from "failed to decode" (rather than
 * collapsing both into a generic decode failure) check for this shape
 * instead of a bare `undefined`. `declaredBytes` is the upstream
 * `content-length` when the cap was hit before any body was read, or the
 * number of bytes actually streamed when it was hit mid-stream (e.g. a
 * chunked response with no declared length).
 */
export interface UpstreamOversizeResponse {
  readonly upstreamOversize: true;
  readonly declaredBytes: number;
}

export function isUpstreamOversizeResponse(
  value: unknown,
): value is UpstreamOversizeResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>).upstreamOversize === true
  );
}

function upstreamUrl(config: AppConfig, path: string): string {
  const configured = process.env.AGENT_SERVER_BASE_URL?.trim();
  const base = configured || `http://127.0.0.1:${config.port}`;
  return `${base.replace(/\/$/u, '')}${path}`;
}

function browserServiceToken(config: AppConfig): string {
  const configured = process.env.AGENT_SERVER_SERVICE_TOKEN?.trim();
  if (configured) return configured;
  const active = (config.serviceAccounts ?? []).filter(
    (account) => !account.disabled,
  );
  if (active.length === 1) return active[0]!.token;
  throw new Error('browser_web_service_token_missing');
}

export function fetchAuthenticated(
  config: AppConfig,
  path: string,
  init: RequestInit,
): Promise<Response> {
  return fetch(upstreamUrl(config, path), {
    ...init,
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${browserServiceToken(config)}`,
      ...init.headers,
    },
  });
}

export async function readJson(
  response: Response,
  options: { readonly emptyValue?: unknown } = {},
): Promise<unknown> {
  const declared = Number.parseInt(
    response.headers.get('content-length') ?? '0',
    10,
  );
  if (Number.isFinite(declared) && declared > MAX_UPSTREAM_JSON_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    return { upstreamOversize: true, declaredBytes: declared };
  }

  const reader = response.body?.getReader();
  if (!reader) {
    if (options.emptyValue !== undefined && declared === 0)
      return options.emptyValue;
    try {
      return await response.json();
    } catch {
      return undefined;
    }
  }

  let cancelled = false;
  const cancel = async (): Promise<void> => {
    if (cancelled) return;
    cancelled = true;
    try {
      await reader.cancel();
    } catch {
      // Preserve the invalid upstream response when cancellation fails.
    }
  };

  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_UPSTREAM_JSON_BYTES) {
        await cancel();
        return { upstreamOversize: true, declaredBytes: size };
      }
      chunks.push(chunk.value);
    }

    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    if (bytes.byteLength === 0) return options.emptyValue;

    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return JSON.parse(text) as unknown;
  } catch {
    await cancel();
    return undefined;
  } finally {
    reader.releaseLock();
  }
}

export function jsonResponse(
  body: unknown,
  status: number,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...NO_STORE_HEADERS, ...extraHeaders },
  });
}

export function safeStatus(status: number, minimum = 400): number {
  return status >= minimum && status < 600 ? status : 502;
}
