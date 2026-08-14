import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  evaluateMutationWindow,
  parseWindowEvents,
  runMutationWindow,
  WINDOW_MARKER,
} from './c3-e8-mutation-window-runner.mjs';

const event = (name) => `${WINDOW_MARKER}${JSON.stringify({ event: name, wallTime: Date.now() })}`;
const summary = 'Test Files 1 passed (1)\nTests 1 passed | 1 failed (2)';
const validFailureOutput = [
  event('target_started'),
  event('target_failed'),
  'work-list-semantic-read:runs',
  event('control_started'),
  event('control_completed'),
  summary,
].join('\n');

describe('C3 mutation-window parser', () => {
  it('accepts a target failure with a completed non-target control', () => {
    const result = evaluateMutationWindow({
      arm: 'completed-status',
      child: { code: 1 },
      stdout: Buffer.from(validFailureOutput),
      stderr: Buffer.alloc(0),
      restoreEqual: true,
    });
    assert.equal(result.process, 1);
    assert.equal(result.reason, 'target-failed-control-completed');
  });

  it('fails closed for missing and duplicate markers', () => {
    const missing = parseWindowEvents(Buffer.from(summary), Buffer.alloc(0));
    assert.equal(missing.events.length, 0);
    const duplicate = parseWindowEvents(
      Buffer.from(`${event('target_started')}\n${event('target_started')}`),
      Buffer.alloc(0),
    );
    assert.equal(duplicate.events.length, 2);
    const result = evaluateMutationWindow({
      arm: 'completed-status',
      child: { code: 1 },
      stdout: Buffer.from(`${event('target_started')}\n${event('target_started')}\n${summary}`),
      stderr: Buffer.alloc(0),
      restoreEqual: true,
    });
    assert.equal(result.process, 2);
  });

  it('restores exact source bytes after a child failure', () => {
    const root = mkdtempSync(join(tmpdir(), 'c3-window-'));
    const sourcePath = join(root, 'work-shell.tsx');
    const evidenceDirectory = join(root, 'evidence');
    const source = 'Product status is currently unavailable for this Work.';
    writeFileSync(sourcePath, source);
    const outcome = runMutationWindow({
      sourcePath,
      arm: 'unavailable-disclosure',
      evidenceDirectory,
      runCommand: () => ({
        code: 1,
        signal: null,
        spawnError: null,
        stdout: Buffer.from([
          event('target_started'),
          event('target_failed'),
          'Product status is currently unavailable for this Work.',
          event('control_started'),
          event('control_completed'),
          summary,
        ].join('\n')),
        stderr: Buffer.alloc(0),
      }),
    });
    assert.equal(outcome.process, 1);
    assert.equal(outcome.restoreEqual, true);
    assert.deepEqual(readFileSync(sourcePath), Buffer.from(source));
    rmSync(root, { recursive: true, force: true });
  });

  it('restores exact source bytes when the child runner throws', () => {
    const root = mkdtempSync(join(tmpdir(), 'c3-window-'));
    const sourcePath = join(root, 'work-shell.tsx');
    const evidenceDirectory = join(root, 'evidence');
    const source = 'data-testid="work-list"';
    writeFileSync(sourcePath, source);
    const outcome = runMutationWindow({
      sourcePath,
      arm: 'container-identity',
      evidenceDirectory,
      runCommand: () => { throw new Error('child failed'); },
    });
    assert.equal(outcome.process, 2);
    assert.equal(outcome.restoreEqual, true);
    assert.deepEqual(readFileSync(sourcePath), Buffer.from(source));
    rmSync(root, { recursive: true, force: true });
  });
});
