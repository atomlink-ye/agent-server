import { HttpError } from '../../contracts/http.js';

export async function readBoundedJson(
  request: Request,
  maxBytes: number,
): Promise<unknown> {
  const declared = Number.parseInt(
    request.headers.get('content-length') ?? '0',
    10,
  );
  const reader = request.body?.getReader();
  if (!reader) {
    if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge();
    return {};
  }
  let cancelled = false;
  const cancel = async (): Promise<void> => {
    if (cancelled) return;
    cancelled = true;
    try {
      await reader.cancel();
    } catch {
      // Preserve the public request error if the stream refuses cancellation.
    }
  };
  try {
    if (Number.isFinite(declared) && declared > maxBytes) {
      await cancel();
      throw tooLarge();
    }

    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBytes) {
        await cancel();
        throw tooLarge();
      }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    if (bytes.byteLength === 0) return {};

    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      await cancel();
      throw invalidJson();
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      await cancel();
      throw invalidJson();
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    await cancel();
    throw invalidJson();
  } finally {
    reader.releaseLock();
  }
}

function tooLarge(): HttpError {
  return new HttpError(
    413,
    'request_too_large',
    'The request body exceeds the configured limit.',
  );
}

function invalidJson(): HttpError {
  return new HttpError(
    400,
    'invalid_json',
    'The request body is not valid JSON.',
  );
}
