import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { collectExecPlanErrors } from './check-exec-plans.mjs';

let root;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'agent-server-exec-plans-'));
  await Promise.all([
    mkdir(join(root, 'active')),
    mkdir(join(root, 'completed')),
  ]);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function plan(lane, name, status, body = '') {
  await writeFile(
    join(root, lane, name),
    `---\nstatus: ${status}\n---\n\n${body}\n`,
    'utf8',
  );
}

test('accepts an active standalone spec', async () => {
  await plan('active', '2026-07-24-new-feature-spec.md', 'active');

  assert.deepEqual(await collectExecPlanErrors(root), []);
});

test('rejects a completed document linking to active', async () => {
  await plan(
    'completed',
    '2026-07-24-feature.md',
    'completed',
    'See `docs/exec-plans/active/2026-07-24-feature-spec.md`.',
  );

  assert.match(
    (await collectExecPlanErrors(root)).join('\n'),
    /links to active/,
  );
});

test('rejects split spec and plan lanes', async () => {
  await plan('completed', '2026-07-24-feature-spec.md', 'completed');
  await plan('active', '2026-07-24-feature-plan.md', 'active');

  assert.match(
    (await collectExecPlanErrors(root)).join('\n'),
    /split across lanes/,
  );
});

test('rejects active detail beside canonical completed task', async () => {
  await plan('completed', '2026-07-24-feature.md', 'completed');
  await plan('active', '2026-07-24-feature-spec.md', 'active');

  assert.match(
    (await collectExecPlanErrors(root)).join('\n'),
    /canonical completed/,
  );
});

test('retains status and unchecked-item validation', async () => {
  await plan(
    'completed',
    '2026-07-24-feature.md',
    'active',
    '- [ ] unfinished',
  );

  const errors = (await collectExecPlanErrors(root)).join('\n');
  assert.match(errors, /status must be completed/);
  assert.match(errors, /cannot contain unchecked/);
});

test('accepts a completed spec-plan pair and canonical record', async () => {
  await plan('completed', '2026-07-24-feature.md', 'completed');
  await plan('completed', '2026-07-24-feature-spec.md', 'completed');
  await plan('completed', '2026-07-24-feature-plan.md', 'completed');

  assert.deepEqual(await collectExecPlanErrors(root), []);
});
