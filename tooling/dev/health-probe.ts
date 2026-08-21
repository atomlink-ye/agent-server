import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultUrl = `http://127.0.0.1:${process.env.PORT?.trim() || '3000'}/health/live`;
const defaultTimeoutValue = '2000';

function timeoutMs(): number {
  const rawValue =
    process.env.HEALTH_PROBE_TIMEOUT_MS?.trim() || defaultTimeoutValue;
  if (!/^\d+$/.test(rawValue)) {
    throw new Error(
      `invalid HEALTH_PROBE_TIMEOUT_MS: ${JSON.stringify(rawValue)}; expected decimal milliseconds`,
    );
  }

  const value = Number.parseInt(rawValue, 10);
  return Number.isInteger(value) && value > 0
    ? value
    : Number.parseInt(defaultTimeoutValue, 10);
}

export async function runHealthProbe(
  url = process.argv[2]?.trim() || defaultUrl,
): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (error) {
    throw new Error(`invalid URL: ${url}`, { cause: error });
  }

  try {
    const response = await fetch(parsed, {
      signal: AbortSignal.timeout(timeoutMs()),
    });
    process.stdout.write(
      `health probe: url=${parsed.href} status=${response.status} statusText=${JSON.stringify(response.statusText)}\n`,
    );
    if (response.status !== 200) {
      throw new Error(`expected HTTP 200, received HTTP ${response.status}`);
    }
  } catch (error) {
    process.stderr.write(
      `health probe failed: url=${parsed.href} error=${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  runHealthProbe().catch((error: unknown) => {
    process.stderr.write(
      `health probe failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
