#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PASS = 0;
const FAIL = 1;
const MISSING = 2;
const OH2_DECISION =
  'rounds/2026-08-13-refactor-and-web-rebuild/DECISIONS-2026-08-13-owner-handover.md#O-H2';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const sourceRoot = resolve(
  repoRoot,
  '../../../../tasks/active/agent-server-implementation-20260722/rounds/2026-08-12-product-api-v1-protect-acceptance/evidence/recordings',
);
const fixtureRoot = resolve(
  repoRoot,
  'apps/web/lib/__fixtures__/product-recordings',
);
const legacyRoot = resolve(repoRoot, 'fixtures/product-projection/recordings');

const recorderFiles = [
  {
    name: 'parallel-success-fa77ba9.json',
    sha256:
      'b06faa143617da2c834dc8ab8836ff1770f6618c65884ff1db0f0aed2c04f736',
  },
  {
    name: 'rework-once-fa77ba9.json',
    sha256:
      '219d8a74138c277f9fae3046eac00543605cc4afeb97bbc19e2b4431cfc95aef',
  },
] as const;
const negativeControl = {
  name: 'oi38-negative-39210cab.json',
  sha256:
    '9efe44bfbfb3e67111172c9b8589c0436f053f764004c9e9944a9b97825f2796',
} as const;
const expectedFiles = [...recorderFiles, negativeControl];

const legacyFiles = {
  '.gitkeep': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  'README.md': 'fa75d7774097c7ef670ec9f0171740165bb2fd4723c6023ac25c6aab13b02944',
} as const;

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function filesUnder(root: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(resolve(root, prefix), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...(await filesUnder(root, relative)));
    else files.push(relative);
  }
  return files.sort();
}

async function readHash(path: string): Promise<string> {
  return sha256(await readFile(path));
}

export async function checkProductRecordingProvenance(): Promise<number> {
  let fixtureFiles: string[];
  let legacyFilesOnDisk: string[];
  try {
    fixtureFiles = await filesUnder(fixtureRoot);
    legacyFilesOnDisk = await filesUnder(legacyRoot);
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    )
      return MISSING;
    return FAIL;
  }

  const expectedFixtureFiles = expectedFiles.map(({ name }) => name).sort();
  if (expectedFixtureFiles.some((file) => !fixtureFiles.includes(file)))
    return MISSING;
  if (
    fixtureFiles.length !== expectedFixtureFiles.length ||
    fixtureFiles.some((file, index) => file !== expectedFixtureFiles[index])
  )
    return FAIL;

  const expectedLegacyFiles = Object.keys(legacyFiles).sort();
  if (
    legacyFilesOnDisk.length !== expectedLegacyFiles.length ||
    legacyFilesOnDisk.some((file, index) => file !== expectedLegacyFiles[index])
  )
    return FAIL;

  for (const [name, expectedSha] of Object.entries(legacyFiles)) {
    if ((await readHash(resolve(legacyRoot, name))) !== expectedSha) return FAIL;
  }

  for (const recording of expectedFiles) {
    const source = resolve(sourceRoot, recording.name);
    const fixture = resolve(fixtureRoot, recording.name);
    let sourceSha: string;
    let fixtureSha: string;
    try {
      sourceSha = await readHash(source);
      fixtureSha = await readHash(fixture);
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code === 'ENOENT'
      )
        return MISSING;
      return FAIL;
    }
    if (sourceSha !== recording.sha256 || fixtureSha !== recording.sha256)
      return FAIL;
  }

  // O-H2 authorizes C1 to proceed with two complete recorders plus one
  // independent negative control, but the third complete-recorder slot is
  // still genuinely missing and must never be reported as PASS.
  return MISSING;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  checkProductRecordingProvenance()
    .then((code) => {
      console.log(`recorder_count=${recorderFiles.length}`);
      console.log('negative_control_count=1');
      console.log('third_recorder_slot=MISSING');
      console.log(`o_h2_decision=${OH2_DECISION}`);
      console.log(`product_recording_provenance_exit=${code}`);
      console.log(
        'known_limitation=oi38-negative-39210cab.json is provenance/count only and does not establish D10/D12 recorder eligibility or PASS',
      );
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(`checker_error=${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = FAIL;
    });
}
