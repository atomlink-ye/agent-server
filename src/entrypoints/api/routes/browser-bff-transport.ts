import type { AppConfig } from '../../../shared/config.js';

const NO_STORE_HEADERS = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
} as const;

const MAX_UPSTREAM_JSON_BYTES = 1 * 1024 * 1024;

export function upstreamUrl(config: AppConfig, path: string): string {
  const configured = process.env.AGENT_SERVER_BASE_URL?.trim();
  const base = configured || `http://127.0.0.1:${config.port}`;
  return `${base.replace(/\/$/u, '')}${path}`;
}

export function browserServiceToken(config: AppConfig): string {
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

export async function readJson(response: Response): Promise<unknown> {
  const declared = Number.parseInt(
    response.headers.get('content-length') ?? '0',
    10,
  );
  if (Number.isFinite(declared) && declared > MAX_UPSTREAM_JSON_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    return undefined;
  }

  const reader = response.body?.getReader();
  if (!reader) {
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
        return undefined;
      }
      chunks.push(chunk.value);
    }

    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    if (bytes.byteLength === 0) return undefined;

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

export function safeStatus(status: number): number {
  return status >= 400 && status < 600 ? status : 502;
}
