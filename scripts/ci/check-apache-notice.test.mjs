import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { afterEach, beforeEach, test } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFile = promisify(execFileCallback);
const checkScript = join(
  dirname(fileURLToPath(import.meta.url)),
  'check-apache-notice.mjs',
);
const requiredCommit = '0eaec6c5e8fc6b3298ea1aa73bf5c3e47b923c7f';

let root;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'agent-server-apache-notice-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function runNoticeCheck() {
  try {
    const result = await execFile(
      process.execPath,
      [checkScript, '--root', root],
      { encoding: 'utf8' },
    );
    return { status: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      status: typeof error.code === 'number' ? error.code : 1,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? '',
    };
  }
}

test('rejects a root missing the required NOTICE file', async () => {
  const result = await runNoticeCheck();

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing required notice: NOTICE/);
});

test('rejects a NOTICE without the required source and commit provenance', async () => {
  await writeFile(
    join(root, 'NOTICE'),
    'Third-party notice without the required provenance.\n',
    'utf8',
  );

  const result = await runNoticeCheck();

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Cloudflare OS/);
  assert.match(result.stderr, new RegExp(requiredCommit));
});

test('accepts a NOTICE containing the required source and exact commit', async () => {
  await writeFile(
    join(root, 'NOTICE'),
    [
      'Third-party source: Cloudflare OS',
      `Upstream commit: ${requiredCommit}`,
      '',
    ].join('\n'),
    'utf8',
  );

  const result = await runNoticeCheck();

  assert.equal(result.status, 0, result.stderr);
});
