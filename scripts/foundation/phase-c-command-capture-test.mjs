import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { createCommandRunner } from './lib/phase-c-command-capture.mjs';

const root = resolve(import.meta.dirname, '../..');
const artifactRoot = mkdtempSync(join(tmpdir(), 'phase-c-command-capture-'));
const secret = 'fixture-secret-abc123';
try {
  const run = createCommandRunner({
    root,
    artifactRoot,
    defaultEnvironment: process.env,
    secretValues: [secret],
  });
  let failure;
  try {
    run(
      process.execPath,
      [
        '-e',
        `process.stdout.write('stdout-only\\n'); for(let i=0;i<60;i++) process.stderr.write('line-'+i+'\\n'); process.stderr.write('OPENCODE_GO_API_KEY=${secret}\\nBearer token-shaped-value\\n'); process.exit(17)`,
      ],
      { identity: 'fixture-nonzero' },
    );
  } catch (error) {
    failure = error;
  }
  if (!(failure instanceof Error) || !failure.message.includes('status=17'))
    throw new Error('raw nonzero exit was not preserved');
  const record = JSON.parse(
    readFileSync(join(artifactRoot, 'failure-record.json'), 'utf8'),
  );
  const stdout = readFileSync(join(artifactRoot, record.stdout_path), 'utf8');
  const stderr = readFileSync(join(artifactRoot, record.stderr_path), 'utf8');
  if (record.raw_exit !== 17) throw new Error('failure record lost raw exit');
  if (stdout !== 'stdout-only\n')
    throw new Error('stdout capture is not split');
  if (stderr.includes('stdout-only')) throw new Error('stderr contains stdout');
  if (stderr.includes(secret) || record.sanitized_stderr_tail.includes(secret))
    throw new Error('known secret was not redacted');
  if (
    failure.message.includes(secret) ||
    !failure.message.includes('line-59') ||
    !failure.message.includes('[REDACTED]')
  )
    throw new Error('thrown failure did not contain only the sanitized tail');
  if (!stderr.includes('[REDACTED]'))
    throw new Error('redaction marker missing');
  if (
    record.sanitized_stderr_tail.includes('line-0') ||
    !record.sanitized_stderr_tail.includes('line-59')
  )
    throw new Error('stderr tail is not bounded to the final lines');
  if ('argv' in record || 'env' in record || 'environment' in record)
    throw new Error('failure record persisted forbidden process inputs');
  for (const path of [record.stdout_path, record.stderr_path]) {
    if ((statSync(join(artifactRoot, path)).mode & 0o777) !== 0o600)
      throw new Error('captured stream mode is not 0600');
  }
  const configResult = run(
    process.execPath,
    ['-e', `process.stdout.write('{"services":{"secret":"${secret}"}}')`],
    { identity: 'fixture-effective-config', captureStdout: false },
  );
  if (!configResult.stdout.includes('services'))
    throw new Error('omitted stdout was not returned to its in-memory caller');
  const omitted = readFileSync(
    join(artifactRoot, 'command-logs/002-fixture-effective-config.stdout.log'),
    'utf8',
  );
  if (omitted.includes('services') || omitted.includes(secret))
    throw new Error('forbidden effective config was persisted');
  try {
    run(process.execPath, ['-e', 'process.exit(19)'], {
      identity: 'fixture-cleanup-failure',
    });
  } catch {
    // The first failure record must remain authoritative.
  }
  const preserved = JSON.parse(
    readFileSync(join(artifactRoot, 'failure-record.json'), 'utf8'),
  );
  if (preserved.raw_exit !== 17)
    throw new Error('later failure overwrote the first failure record');
  process.stdout.write(
    `${JSON.stringify({ status: 'PASS', raw_exit: record.raw_exit, streams_split: true, stderr_tail_bounded: true, secret_redacted: true, modes_0600: true, effective_config_omitted: true, first_failure_preserved: true })}\n`,
  );
} finally {
  rmSync(artifactRoot, { recursive: true, force: true });
}
