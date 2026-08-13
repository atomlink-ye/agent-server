#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  ProductRunTraceResponseSchema,
  ProductWorkRunResponseSchema,
  WorkResponseSchema,
} from '../../src/contracts/product-accepted-subset/index.js';

const PASS = 0;
const FAIL = 1;
const MISSING = 2;
const WREC_DIRECTORY = 'wrec-third-oi38-20260813';
const WREC_WORK_ID = '315df1a1-2a2f-4e10-a8ba-9f310bc42aed';
const WREC_WORK_RUN_ID = 'cdeecf2b-b8c8-4929-ae48-8522768605af';
const OH2_DECISION =
  '/Volumes/AgentsWorkspace/orgs/0xdtech/tasks/active/agent-server-implementation-20260722/rounds/2026-08-13-refactor-and-web-rebuild/DECISIONS-2026-08-13-owner-handover.md#O-H2';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const fixtureRoot = resolve(
  repoRoot,
  'apps/web/lib/__fixtures__/product-recordings',
);
const legacyRoot = resolve(
  repoRoot,
  'fixtures/product-projection/recordings',
);
const legacySourceRoot = resolve(
  repoRoot,
  '../../../../tasks/active/agent-server-implementation-20260722/rounds/2026-08-12-product-api-v1-protect-acceptance/evidence/recordings',
);

const oldRecorders = [
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
const legacyNegativeControl = {
  name: 'oi38-negative-39210cab.json',
  sha256:
    '9efe44bfbfb3e67111172c9b8589c0436f053f764004c9e9944a9b97825f2796',
} as const;

// These are the 12 source files listed by the verified W-REC SHA256SUMS.
// SHA256SUMS itself is provenance input, not one of the recorder files.
const wrecFiles = {
  'manifest.json':
    '8d09afabbe5fc52002e15d0201feed46fe25692dd4f9f2eace03f0542b284af6',
  'api/work.json':
    '137e0f2a8abf1e0579d582835572b46f62b8354613a9c61d3232a61c9cab2d6f',
  'api/work-run.json':
    '2df634f24efbfc605c39a5a1f7b69c6923b8b15eb542526c27b1333e8986438a',
  'api/trace.json':
    '56839fe746933b822b3587bc3415724480b86079ad6c4a1d10f00caf0bacaa64',
  'db/team_runs.json':
    'd70cac1a550c818902ae43335b0dfb18915e7d08a44d6b9b18d7883b5e4da656',
  'db/team_work_items.json':
    'b77810a734bf784ea73f513d8cb0d8b13a3ed03278fbed6e7f4ebb4fe97232db',
  'db/team_work_item_attempts.json':
    '7341bba9f99cea60214a091b24b4a46f146d24ef69c3e20d4ba8f9b18bfb7808',
  'db/team_messages.json':
    'c049c79649b0893d873d3745f318828deab9397168efcdcd0d6d534d6a305c4e',
  'db/run_events.json':
    'aa732493265a87cf83edf95b167f4781e174c71346cbaeb08023b773c28bdfb7',
  'db/works.json':
    '561a30fa03d255e51bd03e88543613c50345e8c0ec02b0a01dab61ffa5426035',
  'db/work_runs.json':
    '85449cf7f31030a3455907d1eb67db2e8f86e646c27a5826f7ce4a6b8de36354',
  'db/work_run_resource_manifest.json':
    'd09ea2192e44db53560db3b27014e2402a48174be4d02cea8b7f2056dbf94da6',
} as const;

const legacyFiles = {
  '.gitkeep':
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  'README.md':
    'fa75d7774097c7ef670ec9f0171740165bb2fd4723c6023ac25c6aab13b02944',
} as const;

type Status = 'PASS' | 'FAIL' | 'MISSING';
type ParseStatus = Status;

type ParseResult = {
  readonly status: ParseStatus;
  readonly value?: unknown;
};

type ProvenanceCheckResult = {
  readonly code: number;
  readonly parse: {
    readonly trace: ParseStatus;
    readonly workRun: ParseStatus;
    readonly work: ParseStatus;
  };
  readonly inputsVerified: boolean;
  readonly sourceStatus?: Status;
  readonly fixtureStatus?: Status;
  readonly boundaryStatus?: Status;
  readonly boundaryScanScope?: readonly string[];
  readonly boundaryScanFileCount?: number;
  readonly boundaryScanHits?: readonly string[];
  readonly oi38Status?: Status;
};

type BoundaryScanResult = {
  readonly status: Status;
  readonly scope: readonly string[];
  readonly fileCount: number;
  readonly hits: readonly string[];
};

type CheckerOptions = {
  readonly bundleRoot: string;
  readonly sourceRoot: string;
};

function statusForCode(code: number): Status {
  return code === PASS ? 'PASS' : code === MISSING ? 'MISSING' : 'FAIL';
}

function usageError(message: string): never {
  throw new Error(
    `${message}; usage: check-product-recording-provenance.ts [--bundle-root <path>] [--source-root <path>]`,
  );
}

function checkerOptions(): CheckerOptions {
  let bundleRoot: string | undefined;
  let sourceRoot: string | undefined;
  for (let index = 2; index < process.argv.length; index += 1) {
    const argument = process.argv[index];
    if (argument === '--bundle-root' || argument === '--source-root') {
      const value = process.argv[index + 1];
      if (!value || value.startsWith('--'))
        usageError(`${argument} requires a non-option value`);
      if (argument === '--bundle-root') {
        if (bundleRoot !== undefined) usageError('duplicate --bundle-root');
        bundleRoot = value;
      } else {
        if (sourceRoot !== undefined) usageError('duplicate --source-root');
        sourceRoot = value;
      }
      index += 1;
      continue;
    }
    if (argument.startsWith('--bundle-root=') || argument.startsWith('--source-root=')) {
      const [name, value] = argument.split('=', 2);
      if (!value || value.startsWith('--')) usageError(`${name} requires a non-option value`);
      if (name === '--bundle-root') {
        if (bundleRoot !== undefined) usageError('duplicate --bundle-root');
        bundleRoot = value;
      } else {
        if (sourceRoot !== undefined) usageError('duplicate --source-root');
        sourceRoot = value;
      }
      continue;
    }
    usageError(`unknown or malformed argument: ${argument}`);
  }

  const resolvedBundleRoot = resolve(
    bundleRoot ?? process.env.PRODUCT_RECORDING_BUNDLE_ROOT ?? resolve(fixtureRoot, WREC_DIRECTORY),
  );
  const sourceOverride = sourceRoot ?? process.env.PRODUCT_RECORDING_SOURCE_ROOT;
  if (!sourceOverride)
    usageError('PRODUCT_RECORDING_SOURCE_ROOT or --source-root is required');
  return { bundleRoot: resolvedBundleRoot, sourceRoot: resolve(sourceOverride) };
}

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

async function verifyWrecTree(
  root: string,
  options: { readonly allowChecksumFile?: boolean } = {},
): Promise<Status> {
  let files: string[];
  try {
    files = await filesUnder(root);
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    )
      return 'MISSING';
    return 'FAIL';
  }

  // The immutable dispatch source also carries SHA256SUMS as its checksum
  // manifest. It is metadata for these 12 files, not a thirteenth recorder
  // input and is intentionally not copied into the product fixture.
  if (
    !options.allowChecksumFile &&
    files.some((file) => file === 'SHA256SUMS')
  )
    return 'FAIL';
  const comparableFiles = options.allowChecksumFile
    ? files.filter((file) => file !== 'SHA256SUMS')
    : files;
  const expectedFiles = Object.keys(wrecFiles).sort();
  if (comparableFiles.some((file) => !expectedFiles.includes(file)))
    return 'FAIL';
  if (
    comparableFiles.length !== expectedFiles.length ||
    comparableFiles.some((file, index) => file !== expectedFiles[index])
  )
    return 'MISSING';

  for (const [relative, expectedSha] of Object.entries(wrecFiles)) {
    try {
      if ((await readHash(resolve(root, relative))) !== expectedSha) return 'FAIL';
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code === 'ENOENT'
      )
        return 'MISSING';
      return 'FAIL';
    }
  }
  return 'PASS';
}

async function parseJsonDocument(
  path: string,
  schema: { safeParse(value: unknown): { success: boolean; data?: unknown } },
): Promise<ParseResult> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as unknown;
    const parsed = schema.safeParse(value);
    return parsed.success
      ? { status: 'PASS', value: parsed.data }
      : { status: 'FAIL' };
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    )
      return { status: 'MISSING' };
    return { status: 'FAIL' };
  }
}

function hasFlatTargetRunId(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasFlatTargetRunId);
  if (value === null || typeof value !== 'object') return false;
  for (const [key, child] of Object.entries(value)) {
    if (
      key === 'target' &&
      child !== null &&
      typeof child === 'object' &&
      !Array.isArray(child) &&
      Object.prototype.hasOwnProperty.call(child, 'run_id')
    )
      return true;
    if (hasFlatTargetRunId(child)) return true;
  }
  return false;
}

function errorBodyWithoutRequestId(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return value;
  const copy = { ...(value as Record<string, unknown>) };
  if ('request_id' in copy) delete copy.request_id;
  for (const key of Object.keys(copy))
    copy[key] = errorBodyWithoutRequestId(copy[key]);
  return copy;
}

async function checkOi38Predicate(bundleRoot: string): Promise<Status> {
  try {
    const manifest = JSON.parse(
      await readFile(resolve(bundleRoot, 'manifest.json'), 'utf8'),
    ) as {
      predicate_evidence?: {
        oi38?: {
          foreign?: { status?: number; body?: unknown };
          missing?: { status?: number; body?: unknown };
        };
      };
    };
    const foreign = manifest.predicate_evidence?.oi38?.foreign;
    const missing = manifest.predicate_evidence?.oi38?.missing;
    if (!foreign || !missing || foreign.status !== 404 || missing.status !== 404)
      return 'FAIL';
    return JSON.stringify(errorBodyWithoutRequestId(foreign.body)) ===
      JSON.stringify(errorBodyWithoutRequestId(missing.body))
      ? 'PASS'
      : 'FAIL';
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    )
      return 'MISSING';
    return 'FAIL';
  }
}

const boundaryScanRoots = [
  'apps/web/lib',
  'apps/web/features/run-trace',
  'apps/web/components/work',
] as const;

async function scanBoundaryFiles(root: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(resolve(root, prefix), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolutePath = resolve(root, relativePath);
    if (
      entry.isDirectory() &&
      absolutePath === resolve(fixtureRoot)
    )
      continue;
    if (entry.isDirectory())
      files.push(...(await scanBoundaryFiles(root, relativePath)));
    else files.push(relativePath);
  }
  return files.sort();
}

async function checkProjectionBoundary(): Promise<BoundaryScanResult> {
  try {
    const files = (
      await Promise.all(
        boundaryScanRoots.map(async (root) => {
          const absoluteRoot = resolve(repoRoot, root);
          const relativeFiles = await scanBoundaryFiles(absoluteRoot);
          return relativeFiles.map((file) => join(root, file));
        }),
      )
    ).flat();
    const needles = [WREC_DIRECTORY, WREC_WORK_ID, WREC_WORK_RUN_ID];
    const hits: string[] = [];
    for (const file of files) {
      const contents = await readFile(resolve(repoRoot, file), 'utf8');
      for (const needle of needles)
        if (contents.includes(needle)) hits.push(`${file}:${needle}`);
    }
    return {
      status: files.length === 0 ? 'MISSING' : hits.length === 0 ? 'PASS' : 'FAIL',
      scope: boundaryScanRoots,
      fileCount: files.length,
      hits,
    };
  } catch {
    return {
      status: 'MISSING',
      scope: boundaryScanRoots,
      fileCount: 0,
      hits: [],
    };
  }
}

async function checkLegacyInputs(): Promise<boolean> {
  const fixtureFiles = await filesUnder(fixtureRoot);
  const legacyFilesOnDisk = await filesUnder(legacyRoot);
  const expectedFixtureFiles = [
    ...oldRecorders.map(({ name }) => name),
    legacyNegativeControl.name,
    ...Object.keys(wrecFiles).map((file) => `${WREC_DIRECTORY}/${file}`),
  ].sort();
  if (
    fixtureFiles.length !== expectedFixtureFiles.length ||
    fixtureFiles.some((file, index) => file !== expectedFixtureFiles[index])
  )
    return false;

  const expectedLegacyFiles = Object.keys(legacyFiles).sort();
  if (
    legacyFilesOnDisk.length !== expectedLegacyFiles.length ||
    legacyFilesOnDisk.some((file, index) => file !== expectedLegacyFiles[index])
  )
    return false;
  for (const [name, expectedSha] of Object.entries(legacyFiles)) {
    if ((await readHash(resolve(legacyRoot, name))) !== expectedSha) return false;
  }

  for (const recording of [...oldRecorders, legacyNegativeControl]) {
    const expected = recording.sha256;
    if ((await readHash(resolve(fixtureRoot, recording.name))) !== expected)
      return false;
    if ((await readHash(resolve(legacySourceRoot, recording.name))) !== expected)
      return false;
  }

  const negative = JSON.parse(
    await readFile(resolve(fixtureRoot, legacyNegativeControl.name), 'utf8'),
  ) as Record<string, unknown>;
  return (
    negative.scenario === 'oi38-negative' &&
    !Object.prototype.hasOwnProperty.call(negative, 'recording_documents')
  );
}

async function evaluateProductRecordingProvenance(): Promise<ProvenanceCheckResult> {
  const { bundleRoot, sourceRoot } = checkerOptions();

  // O-H14: parse the complete current schemas before any path/hash/count check.
  const tracePath = resolve(bundleRoot, 'api/trace.json');
  const workRunPath = resolve(bundleRoot, 'api/work-run.json');
  const workPath = resolve(bundleRoot, 'api/work.json');
  const [trace, workRun, work] = await Promise.all([
    parseJsonDocument(tracePath, ProductRunTraceResponseSchema),
    parseJsonDocument(workRunPath, ProductWorkRunResponseSchema),
    parseJsonDocument(workPath, WorkResponseSchema),
  ]);
  const traceFlatTarget =
    trace.status === 'PASS' && hasFlatTargetRunId(trace.value);
  const parse = {
    trace: traceFlatTarget ? ('FAIL' as const) : trace.status,
    workRun: workRun.status,
    work: work.status,
  };
  if (Object.values(parse).some((status) => status !== 'PASS')) {
    const code = Object.values(parse).includes('MISSING') ? MISSING : FAIL;
    return {
      code,
      parse,
      inputsVerified: false,
    };
  }

  const boundary = await checkProjectionBoundary();
  const boundaryStatus = boundary.status;
  const oi38Status = await checkOi38Predicate(bundleRoot);
  const [sourceStatus, fixtureStatus] = await Promise.all([
    verifyWrecTree(sourceRoot, { allowChecksumFile: true }),
    verifyWrecTree(bundleRoot),
  ]);

  if (sourceStatus !== 'PASS' || fixtureStatus !== 'PASS') {
    const code =
      sourceStatus === 'MISSING' || fixtureStatus === 'MISSING' ? MISSING : FAIL;
    return {
      code,
      parse,
      inputsVerified: false,
      sourceStatus,
      fixtureStatus,
      boundaryStatus,
      boundaryScanScope: boundary.scope,
      boundaryScanFileCount: boundary.fileCount,
      boundaryScanHits: boundary.hits,
      oi38Status,
    };
  }

  try {
    if (!(await checkLegacyInputs()) || boundaryStatus !== 'PASS')
      return {
        code: FAIL,
        parse,
        inputsVerified: false,
        sourceStatus,
        fixtureStatus,
        boundaryStatus,
        boundaryScanScope: boundary.scope,
        boundaryScanFileCount: boundary.fileCount,
        boundaryScanHits: boundary.hits,
        oi38Status,
      };
  } catch {
    return {
      code: MISSING,
      parse,
      inputsVerified: false,
      sourceStatus,
      fixtureStatus,
      boundaryStatus,
      boundaryScanScope: boundary.scope,
      boundaryScanFileCount: boundary.fileCount,
      boundaryScanHits: boundary.hits,
      oi38Status,
    };
  }

  return {
    code:
      oi38Status === 'MISSING' || boundaryStatus === 'MISSING'
        ? MISSING
        : oi38Status === 'FAIL'
          ? FAIL
          : PASS,
    parse,
    inputsVerified: true,
    sourceStatus,
    fixtureStatus,
    boundaryStatus,
    oi38Status,
  };
}

export async function checkProductRecordingProvenance(): Promise<number> {
  return (await evaluateProductRecordingProvenance()).code;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  evaluateProductRecordingProvenance()
    .then((result) => {
      console.log(`trace_parse_status=${result.parse.trace}`);
      console.log(`work_run_parse_status=${result.parse.workRun}`);
      console.log(`work_parse_status=${result.parse.work}`);
      const schemasPass = Object.values(result.parse).every(
        (status) => status === 'PASS',
      );
      console.log(`wrec_schema_status=${schemasPass ? 'PASS' : 'FAIL'}`);
      if (schemasPass) {
        console.log('recorder_count=3');
        console.log('negative_control_count=1');
        console.log('old_oi38_summary_counted_as_recorder=false');
        console.log(
          `third_recorder_slot=${result.code === PASS ? 'PASS' : statusForCode(result.code)}`,
        );
        console.log(`wrec_source_verified=${result.sourceStatus === 'PASS'}`);
        console.log(`wrec_fixture_verified=${result.fixtureStatus === 'PASS'}`);
        console.log(`provenance_inputs_verified=${result.inputsVerified}`);
        console.log(`provenance_status=${statusForCode(result.code)}`);
        console.log(`oi38_foreign_missing_404_equivalent=${result.oi38Status}`);
        console.log(`product_projection_boundary_status=${result.boundaryStatus}`);
        console.log(`product_projection_boundary_scope=${result.boundaryScanScope?.join(',') ?? ''}`);
        console.log(`product_projection_boundary_file_count=${result.boundaryScanFileCount ?? 0}`);
        console.log(`product_projection_boundary_hits=${result.boundaryScanHits?.join(',') ?? ''}`);
        console.log(`o_h2_decision=${OH2_DECISION}`);
      } else {
        console.log(`third_recorder_slot=${statusForCode(result.code)}`);
        console.log('provenance_inputs_verified=false');
        console.log(`provenance_status=${statusForCode(result.code)}`);
      }
      console.log(`product_recording_provenance_exit=${result.code}`);
      process.exitCode = result.code;
    })
    .catch((error) => {
      console.error(
        `checker_error=${error instanceof Error ? error.message : String(error)}`,
      );
      process.exitCode = FAIL;
    });
}
