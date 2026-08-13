import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  C3_E8_INPUT_MARKERS,
  C3_E8_KINDS,
  classify,
  classifyChild,
  classifierFraming,
  parseCliArgv,
} from './c3-e8-classifier.mjs';
import { inputMarkerFraming, parseRunnerArgs, runnerOutcome } from './c3-e8-absence-runner.mjs';

const node = process.execPath;
const classifierPath = fileURLToPath(new URL('./c3-e8-classifier.mjs', import.meta.url));
const kind = C3_E8_KINDS.TEST_FILE_ABSENT;
const otherKind = C3_E8_KINDS.IMPORTED_FIXTURE_ABSENT;
const marker = C3_E8_INPUT_MARKERS[kind];
const otherMarker = C3_E8_INPUT_MARKERS[otherKind];

function child(source) {
  return [node, '-e', source];
}

function bytes(...values) {
  return Buffer.from(values);
}

describe('C3/E8 classifier duals', () => {
  it('maps child status 0 to process 0', async () => {
    const outcome = await classify({ kind, argv: child('process.stdout.write("ok\\n")') });
    assert.equal(outcome.process, 0);
    assert.equal(outcome.childExitCode, 0);
  });

  it('maps one exact registered marker and nonzero child to process 2', async () => {
    const outcome = await classify({
      kind,
      argv: child(`process.stdout.write(${JSON.stringify(`${marker}\n`)}); process.exitCode = 2`),
    });
    assert.equal(outcome.process, 2);
    assert.equal(outcome.childExitCode, 2);
    assert.equal(outcome.marker, `c3_e8_classifier_missing:kind=${kind}:marker=${marker}`);
  });

  it('frames an unterminated child marker before the classifier marker without changing child bytes', () => {
    const childBytes = Buffer.from(marker);
    const outcome = classifyChild({
      kind,
      childExitCode: 2,
      childSignal: null,
      stdout: childBytes,
      stderr: Buffer.alloc(0),
      spawnError: null,
    });
    assert.equal(outcome.process, 2);
    assert.deepEqual(classifierFraming(childBytes), Buffer.from('\n'));
    const finalBytes = Buffer.concat([
      childBytes,
      classifierFraming(childBytes),
      Buffer.from(`${outcome.marker}\n`),
    ]);
    assert.deepEqual(finalBytes, Buffer.from(`${marker}\nc3_e8_classifier_missing:kind=${kind}:marker=${marker}\n`));
    assert.deepEqual(childBytes, Buffer.from(marker));
  });

  it('does not infer missing from an unmarked child exit 2', async () => {
    const outcome = await classify({ kind, argv: child('process.exitCode = 2') });
    assert.equal(outcome.process, 1);
  });

  it('maps arbitrary child exit 3 to process 1', async () => {
    const outcome = await classify({ kind, argv: child('process.exitCode = 3') });
    assert.equal(outcome.process, 1);
  });

  it('rejects wrong, malformed, and pre-existing classifier reserved lines', () => {
    for (const evidence of [
      `${marker}\n${otherMarker}\n`,
      `${marker} suffix\n`,
      `${marker}\nc3_e8_classifier_preexisting:bad\n`,
    ]) {
      const outcome = classifyChild({
        kind,
        childExitCode: 1,
        childSignal: null,
        stdout: Buffer.from(evidence),
        stderr: Buffer.alloc(0),
        spawnError: null,
      });
      assert.equal(outcome.process, 1);
    }
  });

  it('maps missing and unknown kind to process 2 with distinct invalid markers', async () => {
    const missingKind = await classify({ argv: child('process.exitCode = 1') });
    assert.equal(missingKind.process, 2);
    assert.match(missingKind.marker, /^c3_e8_classifier_invalid:/u);

    const unknownKind = await classify({ kind: 'not-a-c3-kind', argv: child('process.exitCode = 1') });
    assert.equal(unknownKind.process, 2);
    assert.match(unknownKind.marker, /^c3_e8_classifier_invalid:/u);
    assert.notEqual(missingKind.marker, unknownKind.marker);
  });

  it('rejects duplicate marker, signal, null, ordinary spawn failure, and raw 125', async () => {
    const duplicate = classifyChild({
      kind,
      childExitCode: 2,
      childSignal: null,
      stdout: Buffer.from(`${marker}\n${marker}\n`),
      stderr: Buffer.alloc(0),
      spawnError: null,
    });
    assert.equal(duplicate.process, 1);

    const signalled = await classify({ kind, argv: child('process.kill(process.pid, "SIGTERM")') });
    assert.equal(signalled.process, 1);

    const raw125 = await classify({ kind, argv: ['/bin/sh', '-c', 'exit 125'] });
    assert.equal(raw125.process, 1);

    const nullStatus = classifyChild({ kind, childExitCode: null, childSignal: null });
    assert.equal(nullStatus.process, 1);

    const ordinarySpawnFailure = classifyChild({
      kind,
      childExitCode: null,
      childSignal: null,
      spawnError: { code: 'EACCES', command: '/root/not-executable' },
    });
    assert.equal(ordinarySpawnFailure.process, 1);

    const commandUnavailable = await classify({ kind, argv: ['/definitely/not/a/c3-command'] });
    assert.equal(commandUnavailable.process, 2);
    assert.match(commandUnavailable.marker, /^c3_e8_classifier_missing:reason=command-not-available:/u);
  });

  it('requires the strict CLI separator and nonempty command without executing malformed input', () => {
    assert.equal(parseCliArgv([kind, node]), null);
    assert.equal(parseCliArgv([kind, '--', '']), null);
    assert.equal(parseCliArgv([kind, '--', node, undefined]), null);
    assert.deepEqual(parseCliArgv([kind, '--', node, '-e', 'process.exit(0)']), {
      kind,
      argv: [node, '-e', 'process.exit(0)'],
    });

    for (const args of [[kind, node], [kind, '--'], [kind, '--', ''], [kind, '--', node, '']]) {
      const run = spawnSync(node, [classifierPath, ...args], { encoding: null });
      assert.equal(run.status, 2);
      assert.match(run.stdout.toString('utf8'), /^c3_e8_classifier_invalid:/u);
    }
  });

  it('forwards split multibyte and invalid bytes without re-encoding', () => {
    const source = [
      'process.stdout.write(Buffer.from([0xe2]));',
      'process.stdout.write(Buffer.from([0x82, 0xac]));',
      'process.stderr.write(Buffer.from([0xff, 0xfe]));',
      'process.exitCode = 3;',
    ].join('');
    const run = spawnSync(node, [classifierPath, kind, '--', node, '-e', source], { encoding: null });
    assert.equal(run.status, 1);
    assert.deepEqual(run.stdout, bytes(0xe2, 0x82, 0xac));
    assert.deepEqual(run.stderr, bytes(0xff, 0xfe));
  });

  it('requires the runner exact three-argument shape and only emits for safe raw failure', () => {
    assert.deepEqual(parseRunnerArgs([kind, '--evidence', '/tmp/evidence']), {
      kind,
      evidenceDirectory: '/tmp/evidence',
    });
    for (const argv of [
      [kind, '--evidence'],
      [kind, '--evidence', '/tmp/evidence', 'trailing'],
      [kind, '--wrong', '/tmp/evidence'],
    ]) {
      assert.throws(() => parseRunnerArgs(argv), /usage/u);
    }

    const safe = runnerOutcome({
      targetAbsent: true,
      targetStillAbsent: true,
      status: { code: 1, signal: null, spawnError: null },
    });
    assert.deepEqual(safe, { emitMarker: true, processExit: 1 });

    const rawNonNewline = Buffer.from('raw-vitest-output');
    const framedInput = inputMarkerFraming(rawNonNewline, marker);
    assert.deepEqual(framedInput, Buffer.from(`\n${marker}\n`));
    const outer = classifyChild({
      kind,
      childExitCode: 1,
      childSignal: null,
      stdout: Buffer.concat([rawNonNewline, framedInput]),
      stderr: Buffer.alloc(0),
      spawnError: null,
    });
    assert.equal(outer.process, 2);
    const finalBytes = Buffer.concat([
      rawNonNewline,
      framedInput,
      Buffer.from(`${outer.marker}\n`),
    ]);
    assert.deepEqual(
      finalBytes,
      Buffer.from(`raw-vitest-output\n${marker}\nc3_e8_classifier_missing:kind=${kind}:marker=${marker}\n`),
    );

    for (const status of [
      { code: 0, signal: null, spawnError: null },
      { code: 1, signal: null, spawnError: { code: 'ENOENT' } },
      { code: 1, signal: null, spawnError: { code: 'EACCES' } },
      { code: null, signal: null, spawnError: null },
      { code: null, signal: 'SIGTERM', spawnError: null },
    ]) {
      assert.deepEqual(runnerOutcome({ targetAbsent: true, targetStillAbsent: true, status }), {
        emitMarker: false,
        processExit: 1,
      });
    }
    assert.deepEqual(
      runnerOutcome({
        targetAbsent: true,
        targetStillAbsent: false,
        status: { code: 1, signal: null, spawnError: null },
      }),
      { emitMarker: false, processExit: 1 },
    );
  });
});
