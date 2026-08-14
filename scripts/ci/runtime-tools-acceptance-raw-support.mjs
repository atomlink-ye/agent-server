import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

export function runRuntimeToolsVitestTarget({
  expectedMinCount,
  zeroExecutionMarker,
  underExecutionMarker,
  pattern,
}) {
  const temp = fs.mkdtempSync(
    path.join(os.tmpdir(), 'runtime-tools-acceptance-'),
  );
  const resultFile = path.join(temp, 'vitest.json');
  try {
    const result = spawnSync(
      'pnpm',
      [
        'exec',
        'vitest',
        'run',
        '--config',
        'vitest.integration.config.ts',
        '--no-file-parallelism',
        'tests/integration/product-api-v1-oi38.integration.test.ts',
        '-t',
        pattern,
        '--reporter=json',
        '--outputFile',
        resultFile,
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, REAL_POSTGRES_REQUIRED: '1' },
        encoding: 'utf8',
      },
    );
    process.stdout.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    let report;
    try {
      report = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
    } catch {
      console.error(`RUNTIME_TOOLS_MISSING[${zeroExecutionMarker}]`);
      return 1;
    }
    const assertions = (report.testResults ?? []).flatMap(
      (testFile) => testFile.assertionResults ?? [],
    );
    const selected = assertions.filter((assertion) =>
      `${assertion.fullName ?? assertion.title ?? ''}`.includes(pattern),
    );
    const passed = selected.filter(
      (assertion) => assertion.status === 'passed',
    ).length;
    const failed = selected.filter(
      (assertion) => assertion.status === 'failed',
    ).length;
    const skipCount = selected.filter((assertion) =>
      ['pending', 'skipped', 'disabled'].includes(assertion.status),
    ).length;
    const todoCount = selected.filter(
      (assertion) => assertion.status === 'todo',
    ).length;
    const failureMessages = selected.flatMap(
      (assertion) => assertion.failureMessages ?? [],
    );
    for (const message of failureMessages) process.stderr.write(`${message}\n`);
    console.log(
      JSON.stringify({
        guard: 'runtime-tools-target-execution',
        control_identity: pattern,
        child_raw_exit: result.status,
        passed,
        failed,
        expected_min_count: expectedMinCount,
        observed_count: passed + failed,
        skip_count: skipCount,
        todo_count: todoCount,
        failure_messages: failureMessages.length,
      }),
    );
    if (passed + failed === 0) {
      console.error(`RUNTIME_TOOLS_MISSING[${zeroExecutionMarker}]`);
      return 1;
    }
    if (passed + failed < expectedMinCount) {
      console.error(`RUNTIME_TOOLS_MISSING[${underExecutionMarker}]`);
      return 1;
    }
    if (skipCount !== 0 || todoCount !== 0) {
      console.error(
        'RUNTIME_TOOLS_MISSING[runtime_tools_instrument_skip_or_todo]',
      );
      return 1;
    }
    return result.status === null || result.signal || result.error
      ? 1
      : result.status;
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
