#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PASS = 0;
const FAIL = 1;
const MISSING = 2;
const WREC_DIRECTORY = 'wrec-third-oi38-20260813';
const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const fixtureRoot = resolve(
  repoRoot,
  'apps/web/lib/__fixtures__/product-recordings',
  WREC_DIRECTORY,
);
const sourceRoot = resolve(
  repoRoot,
  '../../../../tasks/active/agent-server-implementation-20260722/rounds/2026-08-13-refactor-and-web-rebuild/artifacts/w-rec-third-recording/recording-artifacts/wrec-third/oi38-negative/20260813T213910949Z-c5f4a431-02ab-44e5-acd8-49d775db83ea',
);

const expectedHashes = {
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
};

const cases = [
  {
    name: 'baseline',
    expectedExit: PASS,
    mutation: 'No mutation; isolated copy of the committed W-REC fixture.',
  },
  {
    name: 'hash-mismatch',
    expectedExit: FAIL,
    mutation:
      'Flip one byte in db/team_messages.json; non-API input isolates hash validation.',
  },
  {
    name: 'missing-file',
    expectedExit: MISSING,
    mutation:
      'Remove required db/team_messages.json; API documents remain available for schema parsing.',
  },
  {
    name: 'schema-invalid-flat-target',
    expectedExit: FAIL,
    mutation:
      'Replace one existing trace target object with valid JSON shape {"run_id":0}; only api/trace.json changes.',
  },
];

function usage(message) {
  throw new Error(
    `${message}\nusage: run-product-recording-provenance-e2.mjs --checker-runtime <command> --checker-command <command> --output-root <outside-candidate-dir> --candidate-sha <exact-sha>`,
  );
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) usage(`unexpected argument: ${argument}`);
    const key = argument.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) usage(`missing value for --${key}`);
    values[key] = value;
    index += 1;
  }
  for (const key of ['checker-runtime', 'checker-command', 'output-root', 'candidate-sha'])
    if (!values[key]) usage(`missing required --${key}`);
  if (!/^[0-9a-f]{40,64}$/u.test(values['candidate-sha']))
    usage('--candidate-sha must be an exact 40-64 character hexadecimal SHA');
  return {
    checkerRuntime: values['checker-runtime'],
    checkerCommand: values['checker-command'],
    outputRoot: resolve(values['output-root']),
    candidateSha: values['candidate-sha'],
  };
}

function assertOutsideCandidate(path) {
  const candidateRelative = relative(repoRoot, path);
  if (
    candidateRelative === '' ||
    (!candidateRelative.startsWith('..') && !isAbsolute(candidateRelative))
  )
    throw new Error(`output root must be outside candidate worktree: ${path}`);
}

async function filesUnder(root, prefix = '') {
  const entries = await readdir(resolve(root, prefix), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...(await filesUnder(root, child)));
    else files.push(child);
  }
  return files.sort();
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function hashAt(root, path) {
  try {
    const bytes = await readFile(join(root, path));
    return { exists: true, sha256: sha256(bytes) };
  } catch (error) {
    if (error?.code === 'ENOENT') return { exists: false, sha256: null };
    throw error;
  }
}

async function treeSnapshot(root, { allowChecksumFile = false } = {}) {
  let actual;
  try {
    actual = await filesUnder(root);
  } catch (error) {
    if (error?.code === 'ENOENT')
      return {
        status: 'MISSING',
        actual: [],
        extra: [],
        missing: Object.keys(expectedHashes).sort(),
        rows: [],
      };
    throw error;
  }
  const comparable = allowChecksumFile
    ? actual.filter((path) => path !== 'SHA256SUMS')
    : actual;
  const expected = Object.keys(expectedHashes).sort();
  const extra = comparable.filter((path) => !expected.includes(path));
  const missing = expected.filter((path) => !comparable.includes(path));
  const rows = await Promise.all(
    expected.map(async (path) => {
      const source = await hashAt(root, path);
      return {
        relative_path: path,
        expected_sha256: expectedHashes[path],
        actual_sha256: source.sha256,
        exists: source.exists,
        matches: source.exists && source.sha256 === expectedHashes[path],
      };
    }),
  );
  const status =
    extra.length > 0 || rows.some((row) => row.exists && !row.matches)
      ? 'FAIL'
      : missing.length > 0 || rows.some((row) => !row.exists)
        ? 'MISSING'
        : comparable.length === expected.length
          ? 'PASS'
          : 'MISSING';
  return { status, actual, extra, missing, rows };
}

async function mutateHashMismatch(inputRoot) {
  const path = join(inputRoot, 'db/team_messages.json');
  const bytes = Buffer.from(await readFile(path));
  bytes[Math.max(0, bytes.length - 1)] ^= 1;
  await writeFile(path, bytes);
  return path;
}

async function mutateMissingFile(inputRoot) {
  const path = join(inputRoot, 'db/team_messages.json');
  await rm(path);
  return path;
}

function replaceTargetWithFlatRunId(value) {
  if (Array.isArray(value)) {
    for (const child of value) if (replaceTargetWithFlatRunId(child)) return true;
    return false;
  }
  if (value === null || typeof value !== 'object') return false;
  for (const [key, child] of Object.entries(value)) {
    if (
      key === 'target' &&
      child !== null &&
      typeof child === 'object' &&
      !Array.isArray(child)
    ) {
      value[key] = { run_id: 0 };
      return true;
    }
    if (replaceTargetWithFlatRunId(child)) return true;
  }
  return false;
}

async function mutateSchemaInvalid(inputRoot) {
  const path = join(inputRoot, 'api/trace.json');
  const trace = JSON.parse(await readFile(path, 'utf8'));
  if (!replaceTargetWithFlatRunId(trace)) trace.target = { run_id: 0 };
  await writeFile(path, `${JSON.stringify(trace, null, 2)}\n`);
  return path;
}

function parseBaselineStatus(stdout, key) {
  const match = stdout.match(new RegExp(`^${key}=([^\\n]+)$`, 'mu'));
  return match?.[1] ?? 'NOT_REPORTED';
}

function parseCheckerMarkers(stdout) {
  return {
    trace_parse_status: parseBaselineStatus(stdout, 'trace_parse_status'),
    work_run_parse_status: parseBaselineStatus(stdout, 'work_run_parse_status'),
    work_parse_status: parseBaselineStatus(stdout, 'work_parse_status'),
    wrec_source_verified: parseBaselineStatus(stdout, 'wrec_source_verified'),
    wrec_fixture_verified: parseBaselineStatus(stdout, 'wrec_fixture_verified'),
    provenance_inputs_verified: parseBaselineStatus(
      stdout,
      'provenance_inputs_verified',
    ),
    provenance_status: parseBaselineStatus(stdout, 'provenance_status'),
    third_recorder_slot: parseBaselineStatus(stdout, 'third_recorder_slot'),
    product_recording_provenance_exit: parseBaselineStatus(
      stdout,
      'product_recording_provenance_exit',
    ),
  };
}

function stageAssertion(caseName, markers) {
  const schemasPass =
    markers.trace_parse_status === 'PASS' &&
    markers.work_run_parse_status === 'PASS' &&
    markers.work_parse_status === 'PASS';
  const noProvenanceVerification =
    markers.provenance_inputs_verified === 'false';
  if (caseName === 'baseline')
    return (
      schemasPass &&
      markers.provenance_inputs_verified === 'true' &&
      markers.wrec_source_verified === 'true' &&
      markers.wrec_fixture_verified === 'true'
    );
  if (caseName === 'hash-mismatch' || caseName === 'missing-file')
    return schemasPass && noProvenanceVerification;
  if (caseName === 'schema-invalid-flat-target')
    return (
      markers.trace_parse_status === 'FAIL' &&
      markers.work_run_parse_status === 'PASS' &&
      markers.work_parse_status === 'PASS' &&
      noProvenanceVerification
    );
  return false;
}

async function runChecker(invocation, inputRoot, immutableSourceRoot) {
  const command = invocation;
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, {
      cwd: repoRoot,
      env: {
        ...process.env,
        PRODUCT_RECORDING_BUNDLE_ROOT: inputRoot,
        PRODUCT_RECORDING_SOURCE_ROOT: immutableSourceRoot,
      },
      shell: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code, signal) =>
      resolveResult({
        command,
        exit: code,
        signal,
        stdout,
        stderr,
      }),
    );
  });
}

async function setupCase(caseInfo, caseRoot) {
  const inputRoot = join(caseRoot, 'bundle');
  await cp(fixtureRoot, inputRoot, { recursive: true });
  let inputPath = inputRoot;
  if (caseInfo.name === 'hash-mismatch') inputPath = await mutateHashMismatch(inputRoot);
  if (caseInfo.name === 'missing-file') inputPath = await mutateMissingFile(inputRoot);
  if (caseInfo.name === 'schema-invalid-flat-target')
    inputPath = await mutateSchemaInvalid(inputRoot);
  return { inputRoot, inputPath };
}

async function writeCaseEvidence(
  outputRoot,
  candidateSha,
  caseInfo,
  caseRoot,
  setup,
  result,
  immutableSourceRoot,
) {
  const sourceTable = await treeSnapshot(sourceRoot, { allowChecksumFile: true });
  const committedFixtureTable = await treeSnapshot(fixtureRoot);
  const mutatedFixtureTable = await treeSnapshot(setup.inputRoot);
  const baseline = caseInfo.name === 'baseline';
  const checkerMarkers = parseCheckerMarkers(result.stdout);
  const evidence = {
    candidate_sha: candidateSha,
    case: caseInfo.name,
    expected_exit: caseInfo.expectedExit,
    actual_exit: result.exit,
    signal: result.signal,
    command: result.command,
    cwd: repoRoot,
    mutation: caseInfo.mutation,
    input_root: setup.inputRoot,
    mutation_input_path: setup.inputPath,
    environment: {
      PRODUCT_RECORDING_BUNDLE_ROOT: setup.inputRoot,
      PRODUCT_RECORDING_SOURCE_ROOT: immutableSourceRoot,
    },
    stdout: result.stdout,
    stderr: result.stderr,
    post_case_restore_source_status: sourceTable.status,
    post_case_restore_fixture_status: committedFixtureTable.status,
    post_case_restore_source_files: sourceTable.actual,
    post_case_restore_fixture_files: committedFixtureTable.actual,
    post_case_restore_source_extra_paths: sourceTable.extra,
    post_case_restore_fixture_extra_paths: committedFixtureTable.extra,
    post_case_restore_source_missing_paths: sourceTable.missing,
    post_case_restore_fixture_missing_paths: committedFixtureTable.missing,
    post_case_restore_wrec_rows: sourceTable.rows.map((row, index) => ({
      ...row,
      committed_fixture_sha256:
        committedFixtureTable.rows[index]?.actual_sha256 ?? null,
      committed_fixture_exists: committedFixtureTable.rows[index]?.exists ?? false,
      committed_fixture_matches: committedFixtureTable.rows[index]?.matches ?? false,
    })),
    mutated_fixture_tree_status: mutatedFixtureTable.status,
    mutated_fixture_tree_files: mutatedFixtureTable.actual,
    mutated_fixture_extra_paths: mutatedFixtureTable.extra,
    mutated_fixture_missing_paths: mutatedFixtureTable.missing,
    mutated_wrec_rows: sourceTable.rows.map((row, index) => ({
      ...row,
      fixture_sha256: mutatedFixtureTable.rows[index]?.actual_sha256 ?? null,
      fixture_exists: mutatedFixtureTable.rows[index]?.exists ?? false,
      fixture_matches: mutatedFixtureTable.rows[index]?.matches ?? false,
    })),
    checker_markers: checkerMarkers,
    stage_assertion_pass: stageAssertion(caseInfo.name, checkerMarkers),
    baseline_schema_statuses: baseline
      ? {
          ProductRunTraceResponseSchema: checkerMarkers.trace_parse_status,
          ProductWorkRunResponseSchema: checkerMarkers.work_run_parse_status,
          WorkResponseSchema: checkerMarkers.work_parse_status,
        }
      : null,
    baseline_boundary_checks: baseline
      ? {
          old_negative_summary_not_recorder:
            parseBaselineStatus(
              result.stdout,
              'old_oi38_summary_counted_as_recorder',
            ),
          new_wrec_absent_from_product_projection:
            parseBaselineStatus(
              result.stdout,
              'product_projection_boundary_status',
            ),
        }
      : null,
  };
  const suffix = result.exit === null ? 'signal' : `exit-${result.exit}`;
  const outputPath = join(outputRoot, `case-${caseInfo.name}-${suffix}.json`);
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
  return { outputPath, evidence };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  assertOutsideCandidate(args.outputRoot);
  await mkdir(args.outputRoot, { recursive: true });
  const invocation = `${args.checkerRuntime} ${args.checkerCommand}`;
  const runRoot = await mkdtemp(join(tmpdir(), 'product-recording-e2-'));
  const results = [];
  let baselineEvidence;
  for (const caseInfo of cases) {
    const caseRoot = join(runRoot, caseInfo.name);
    await mkdir(caseRoot, { recursive: true });
    const setup = await setupCase(caseInfo, caseRoot);
    const result = await runChecker(invocation, setup.inputRoot, sourceRoot);
    const evidence = await writeCaseEvidence(
      args.outputRoot,
      args.candidateSha,
      caseInfo,
      caseRoot,
      setup,
      result,
      sourceRoot,
    );
    if (caseInfo.name === 'baseline') baselineEvidence = evidence.evidence;
    results.push({
      case: caseInfo.name,
      expected_exit: caseInfo.expectedExit,
      actual_exit: result.exit,
      stage_assertion_pass: evidence.evidence.stage_assertion_pass,
      evidence: evidence.outputPath,
      input_root: setup.inputRoot,
    });
  }

  const failures = results.filter(
    (result) =>
      result.actual_exit !== result.expected_exit ||
      result.stage_assertion_pass !== true,
  );
  const summary = {
    candidate_sha: args.candidateSha,
    checker_runtime: args.checkerRuntime,
    checker_command: args.checkerCommand,
    invocation,
    cwd: repoRoot,
    output_root: args.outputRoot,
    source_root: sourceRoot,
    fixture_root: fixtureRoot,
    post_case_restore_source_status:
      baselineEvidence?.post_case_restore_source_status ?? null,
    post_case_restore_fixture_status:
      baselineEvidence?.post_case_restore_fixture_status ?? null,
    wrec_source_verified:
      baselineEvidence?.post_case_restore_source_status === 'PASS',
    wrec_fixture_verified:
      baselineEvidence?.post_case_restore_fixture_status === 'PASS',
    expected_paths: Object.keys(expectedHashes).sort(),
    wrec_rows: baselineEvidence?.post_case_restore_wrec_rows ?? null,
    baseline_schema_statuses: baselineEvidence?.baseline_schema_statuses ?? null,
    baseline_boundary_checks: baselineEvidence?.baseline_boundary_checks ?? null,
    cases: results,
    harness_exit: failures.length === 0 ? PASS : FAIL,
    mismatches: failures,
  };
  const summaryPath = join(
    args.outputRoot,
    `summary-${summary.harness_exit === PASS ? 'pass' : 'fail'}.json`,
  );
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  process.exitCode = summary.harness_exit;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = FAIL;
});
