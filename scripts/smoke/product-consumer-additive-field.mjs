#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { register as registerTsx, tsImport } from 'tsx/esm/api';

// Keep this smoke as a plain .mjs entry point while importing the actual web
// decoder and shared TypeScript contract through tsx's ESM loader API.
registerTsx();

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function readWorkRun(recording) {
  const path = join(resolve(recording), 'api/work-run.json');
  return JSON.parse(await readFile(path, 'utf8'));
}

async function main() {
  const recording = option('--recording');
  if (!recording) throw new Error('recording_required: use --recording <dir>');

  const raw = await readWorkRun(recording);
  if (!isRecord(raw) || !Object.hasOwn(raw, 'work_run'))
    throw new Error('baseline_work_run_required');

  const contract = await tsImport(
    join(root, 'src/contracts/product-projection/index.ts'),
    import.meta.url,
  );
  const webDecoder = await tsImport(
    join(root, 'apps/web/lib/product-api-decoder.ts'),
    import.meta.url,
  );
  const schema = contract.ProductWorkRunResponseSchema;
  const decodeProductResponse = webDecoder.decodeProductResponse;

  const baselineStrict = schema.safeParse(raw);
  const baselineDecoded = decodeProductResponse(raw, schema);
  const additiveRaw = {
    ...raw,
    future_optional_probe: { added_by_server: true },
  };
  const additiveStrict = schema.safeParse(additiveRaw);
  const additiveDecoded = decodeProductResponse(additiveRaw, schema);
  const missingRequiredRaw = { ...raw };
  delete missingRequiredRaw.work_run;
  const missingRequiredDecoded = decodeProductResponse(
    missingRequiredRaw,
    schema,
  );

  const baselineOk = baselineStrict.success && baselineDecoded.success;
  const additiveOk =
    !additiveStrict.success &&
    additiveDecoded.success &&
    baselineDecoded.success &&
    isDeepStrictEqual(additiveDecoded.data, baselineDecoded.data);
  const requiredOk = !missingRequiredDecoded.success;

  const strictExit = additiveStrict.success ? 0 : 1;
  const additiveExit = additiveOk ? 0 : 1;
  const requiredExit = requiredOk ? 1 : 0;
  const overallOk =
    baselineOk && strictExit === 1 && additiveExit === 0 && requiredExit === 1;

  process.stdout.write(`STRICT_ADDITIVE_EXIT=${strictExit}\n`);
  process.stdout.write(`ADDITIVE_FIELD_EXIT=${additiveExit}\n`);
  process.stdout.write(`REQUIRED_FIELD_EXIT=${requiredExit}\n`);
  process.stdout.write(`EXIT=${overallOk ? 0 : 1}\n`);
  if (!overallOk) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(
    `ERROR=${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.stdout.write('EXIT=1\n');
  process.exitCode = 1;
});
