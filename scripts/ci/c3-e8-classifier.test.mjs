import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  C3_E8_INPUT_MARKERS,
  C3_E8_KINDS,
  classify,
  classifyChild,
} from './c3-e8-classifier.mjs';

const node = process.execPath;
const kind = C3_E8_KINDS.TEST_FILE_ABSENT;
const otherKind = C3_E8_KINDS.IMPORTED_FIXTURE_ABSENT;
const marker = C3_E8_INPUT_MARKERS[kind];
const otherMarker = C3_E8_INPUT_MARKERS[otherKind];

function child(source) {
  return [node, '-e', source];
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

  it('does not infer missing from an unmarked child exit 2', async () => {
    const outcome = await classify({ kind, argv: child('process.exitCode = 2') });
    assert.equal(outcome.process, 1);
  });

  it('maps arbitrary child exit 3 to process 1', async () => {
    const outcome = await classify({ kind, argv: child('process.exitCode = 3') });
    assert.equal(outcome.process, 1);
  });

  it('rejects the other kind marker as wrong evidence', async () => {
    const outcome = await classify({
      kind,
      argv: child(`process.stdout.write(${JSON.stringify(`${otherMarker}\n`)}); process.exitCode = 2`),
    });
    assert.equal(outcome.process, 1);
  });

  it('maps missing and unknown kind to process 2 with invalid markers', async () => {
    const missingKind = await classify({ argv: child('process.exitCode = 1') });
    assert.equal(missingKind.process, 2);
    assert.match(missingKind.marker, /^c3_e8_classifier_invalid:/u);

    const unknownKind = await classify({ kind: 'not-a-c3-kind', argv: child('process.exitCode = 1') });
    assert.equal(unknownKind.process, 2);
    assert.match(unknownKind.marker, /^c3_e8_classifier_invalid:/u);
  });

  it('rejects duplicate, malformed, signal, null, and ordinary spawn failures', async () => {
    const duplicate = await classify({
      kind,
      argv: child(`process.stdout.write(${JSON.stringify(`${marker}\n${marker}\n`)}); process.exitCode = 2`),
    });
    assert.equal(duplicate.process, 1);

    const malformed = await classify({
      kind,
      argv: child(`process.stdout.write(${JSON.stringify(`${marker} suffix\n`)}); process.exitCode = 2`),
    });
    assert.equal(malformed.process, 1);

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

    const spawnFailure = await classify({ kind, argv: ['/definitely/not/a/c3-command'] });
    assert.equal(spawnFailure.process, 2);
    assert.match(spawnFailure.marker, /^c3_e8_classifier_missing:reason=command-not-available:/u);
  });
});
