#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

function fail(code) {
  throw new Error(code);
}

const [bundleArgument, outputArgument] = process.argv.slice(2);
if (!bundleArgument || !outputArgument || process.argv.length !== 4)
  fail('usage: package-product-recording.mjs BUNDLE OUTPUT');

const bundle = resolve(bundleArgument);
const output = resolve(outputArgument);
const readJson = async (relativePath) =>
  JSON.parse(await readFile(resolve(bundle, relativePath), 'utf8'));

const trace = await readJson('api/trace.json');
const workRunResponse = await readJson('api/work-run.json');
if (!workRunResponse?.work_run) fail('work_run_response_missing_detail');

const databaseDocuments = await Promise.all(
  [
    'run_events',
    'team_messages',
    'team_runs',
    'team_work_item_attempts',
    'team_work_items',
    'work_run_resource_manifest',
    'work_runs',
    'works',
  ].map((name) => readJson(`db/${name}.json`)),
);
const manifest = await readJson('manifest.json');

const envelope = {
  scenario: manifest.scenario,
  candidate_sha: manifest.git_sha,
  recording_documents: [
    trace,
    workRunResponse.work_run,
    await readJson('api/work.json'),
    ...databaseDocuments,
    manifest,
  ],
};
if (envelope.recording_documents.length !== 12)
  fail('recording_document_count_invalid');

await writeFile(output, `${JSON.stringify(envelope, null, 2)}\n`, { mode: 0o600 });
console.log(
  JSON.stringify({
    output,
    scenario: envelope.scenario,
    candidate_sha: envelope.candidate_sha,
    recording_documents: envelope.recording_documents.length,
  }),
);
