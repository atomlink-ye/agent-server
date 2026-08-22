import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  ProductDeveloperClient,
  ProductDeveloperClientError,
} from '../../adapters/http/product-developer-client.js';

class ProductCliError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ProductCliError';
  }
}

const args = process.argv.slice(2);

try {
  await main(args);
} catch (error) {
  const payload =
    error instanceof ProductDeveloperClientError
      ? {
          code: error.code,
          message: error.message,
          status: error.status,
          ...(error.path ? { path: error.path } : {}),
        }
      : error instanceof ProductCliError
        ? { code: error.code, message: error.message }
        : { code: 'CLI_FAILURE', message: 'The command failed.' };
  process.stderr.write(`${JSON.stringify({ error: payload })}\n`);
  process.exitCode = 1;
}

async function main(argv: readonly string[]): Promise<void> {
  const [area, command, ...rest] = argv;
  if (area !== 'definition' && area !== 'work') throw usage();
  const parsed = parse(rest);
  const client = developerClient();

  if (area === 'definition') {
    if (command !== 'validate' && command !== 'plan' && command !== 'apply')
      throw usage();
    const sourcePath = parsed.positional[0] ?? 'work.yaml';
    if (parsed.positional.length > 1) throw usage();
    const source = await readFile(resolve(sourcePath), 'utf8');
    if (command === 'validate')
      return output(await client.validateDefinition(source));
    if (command === 'plan') return output(await client.planDefinition(source));
    const key =
      parsed.flags.get('--idempotency-key') ??
      `agentctl-definition-${createHash('sha256').update(source).digest('hex')}`;
    return output(await client.applyDefinition(source, key));
  }

  if (command === 'create') {
    if (parsed.positional.length) throw usage();
    const versionId = requiredFlag(parsed, '--definition-version');
    const title = requiredFlag(parsed, '--title');
    return output(
      await client.createWorkFromDefinitionVersion({
        definitionVersionId: versionId,
        title,
      }),
    );
  }

  if (command === 'run') {
    if (parsed.positional.length !== 1) throw usage();
    const input = await jsonInput(parsed.flags.get('--input'));
    return output(
      await client.startWorkRun({
        workId: parsed.positional[0]!,
        input,
        ...(parsed.flags.get('--trigger-ref')
          ? { triggerRef: parsed.flags.get('--trigger-ref')! }
          : {}),
      }),
    );
  }

  if (command === 'watch') {
    if (parsed.positional.length !== 2) throw usage();
    return output(
      await client.waitForWorkRun({
        workId: parsed.positional[0]!,
        workRunId: parsed.positional[1]!,
        pollMs: numericFlag(parsed, '--poll-ms', 500, 50, 10_000),
        timeoutMs: numericFlag(
          parsed,
          '--timeout-ms',
          10 * 60 * 1000,
          1_000,
          60 * 60 * 1000,
        ),
      }),
    );
  }

  if (command === 'trace') {
    if (parsed.positional.length !== 2) throw usage();
    return output(
      await client.getRunTrace(parsed.positional[0]!, parsed.positional[1]!),
    );
  }

  if (command === 'run-definition') {
    if (parsed.positional.length > 1) throw usage();
    const source = await readFile(
      resolve(parsed.positional[0] ?? 'work.yaml'),
      'utf8',
    );
    const title = requiredFlag(parsed, '--title');
    const input = await jsonInput(parsed.flags.get('--input'));
    return output(
      await client.runDefinition({
        source,
        title,
        input,
        ...(parsed.flags.get('--idempotency-key')
          ? { idempotencyKey: parsed.flags.get('--idempotency-key')! }
          : {}),
        ...(parsed.flags.get('--trigger-ref')
          ? { triggerRef: parsed.flags.get('--trigger-ref')! }
          : {}),
      }),
    );
  }

  throw usage();
}

function developerClient(): ProductDeveloperClient {
  const baseUrl = process.env.AGENT_SERVER_BASE_URL;
  const token = process.env.AGENT_SERVER_TOKEN;
  if (!baseUrl || !token || !/^https?:\/\//.test(baseUrl))
    throw new ProductCliError(
      'CLI_CONNECTION_NOT_CONFIGURED',
      'AGENT_SERVER_BASE_URL and AGENT_SERVER_TOKEN are required.',
    );
  return new ProductDeveloperClient({ baseUrl, token });
}

function parse(argv: readonly string[]): {
  readonly positional: string[];
  readonly flags: Map<string, string>;
} {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  const allowed = new Set([
    '--definition-version',
    '--title',
    '--input',
    '--idempotency-key',
    '--trigger-ref',
    '--poll-ms',
    '--timeout-ms',
  ]);
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index]!;
    if (!value.startsWith('--')) {
      positional.push(value);
      continue;
    }
    if (!allowed.has(value) || flags.has(value)) throw usage();
    const flagValue = argv[++index];
    if (!flagValue || flagValue.startsWith('--')) throw usage();
    flags.set(value, flagValue);
  }
  return { positional, flags };
}

async function jsonInput(
  path: string | undefined,
): Promise<Record<string, unknown>> {
  if (!path) return {};
  let value: unknown;
  try {
    value = JSON.parse(await readFile(resolve(path), 'utf8'));
  } catch {
    throw new ProductCliError('CLI_INVALID_INPUT', 'Input must be valid JSON.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ProductCliError(
      'CLI_INVALID_INPUT',
      'Input must be a JSON object.',
    );
  return value as Record<string, unknown>;
}

function requiredFlag(
  parsed: { readonly flags: Map<string, string> },
  name: string,
): string {
  const value = parsed.flags.get(name);
  if (!value) throw usage();
  return value;
}

function numericFlag(
  parsed: { readonly flags: Map<string, string> },
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = parsed.flags.get(name);
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) throw usage();
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw usage();
  return value;
}

function output(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function usage(): ProductCliError {
  return new ProductCliError(
    'CLI_INVALID_ARGUMENTS',
    'Use: agentctl definition validate|plan|apply [work.yaml] | work create|run|watch|trace|run-definition ...',
  );
}
