#!/usr/bin/env node

import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { register as registerTsx, tsImport } from 'tsx/esm/api';

registerTsx();

function fail(code) {
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
  throw new Error(code);
}

function arg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function decoderFrom(module) {
  for (const name of [
    'decodeProductWorkRun',
    'ProductWorkRunConsumerDecoder',
    'ProductWorkRunConsumerSchema',
    'ProductWorkRunResponseConsumerSchema',
  ]) {
    const candidate = module[name];
    if (typeof candidate === 'function') return (value) => candidate(value);
    if (candidate && typeof candidate.parse === 'function')
      return (value) => candidate.parse(value);
  }
  return null;
}

async function loadDecoder() {
  const candidates = [
    'src/contracts/product-projection/consumer.ts',
    'src/contracts/product-projection/decoder.ts',
    'src/contracts/product-projection/index.ts',
  ];
  for (const relative of candidates) {
    const path = resolve(relative);
    try {
      await access(path);
      const module = await tsImport(path, import.meta.url);
      const decoder = decoderFrom(module);
      if (decoder) return decoder;
    } catch {
      // Try the next shared-contract export; a missing decoder is a hard failure below.
    }
  }
  fail('consumer_decoder_missing');
}

const recording = arg('--recording');
if (!recording) fail('recording_required');
const responsePath = resolve(recording, 'api/work-run.json');
const response = JSON.parse(await readFile(responsePath, 'utf8'));
const decode = await loadDecoder();

let additiveExit = 0;
try {
  decode({ ...response, future_optional_probe: { added_by_server: true } });
} catch {
  additiveExit = 1;
}
process.stdout.write(`ADDITIVE_FIELD_EXIT=${additiveExit}\n`);

let requiredExit = 0;
try {
  const missing = { ...response };
  delete missing.work_run;
  decode(missing);
} catch {
  requiredExit = 1;
}
process.stdout.write(`REQUIRED_FIELD_EXIT=${requiredExit}\n`);

if (additiveExit !== 0 || requiredExit !== 1) fail('consumer_compatibility_probe_failed');
process.stdout.write('EXIT=0\n');
