import { spawn } from 'node:child_process';

export const C3_E8_KINDS = Object.freeze({
  TEST_FILE_ABSENT: 'test-file-absent',
  IMPORTED_FIXTURE_ABSENT: 'imported-fixture-absent',
});

export const C3_E8_INPUT_MARKERS = Object.freeze({
  [C3_E8_KINDS.TEST_FILE_ABSENT]:
    'c3_e8_input_missing:test-file=apps/web/components/work/work-list.browser.test.tsx',
  [C3_E8_KINDS.IMPORTED_FIXTURE_ABSENT]:
    'c3_e8_input_missing:imported-fixture=apps/web/lib/__fixtures__/product-recordings/parallel-success-fa77ba9.json',
});

const REGISTERED_MARKERS = Object.freeze(Object.values(C3_E8_INPUT_MARKERS));

function classifierLine(line) {
  process.stdout.write(`${line}\n`);
  return line;
}

function result({ processExit, stdout = '', stderr = '', childExitCode = null, childSignal = null, reason, marker }) {
  return {
    process: processExit,
    exitCode: processExit,
    childExitCode,
    childSignal,
    stdout,
    stderr,
    ...(reason ? { reason } : {}),
    ...(marker ? { marker } : {}),
  };
}

function invalidResult(reason) {
  const marker = classifierLine(`c3_e8_classifier_invalid:${reason}`);
  return result({ processExit: 2, reason, marker });
}

function missingResult(reason) {
  const marker = classifierLine(`c3_e8_classifier_missing:${reason}`);
  return result({ processExit: 2, reason, marker });
}

function registeredMarkerLines(stdout, stderr) {
  return `${stdout}\n${stderr}`
    .split(/\r?\n/u)
    .filter((line) => REGISTERED_MARKERS.includes(line));
}

export function classifyChild({ kind, childExitCode, childSignal, stdout = '', stderr = '', spawnError }) {
  if (spawnError) {
    if (spawnError.code === 'ENOENT') {
      return missingResult(`reason=command-not-available:command=${spawnError.command}`);
    }
    return result({
      processExit: 1,
      childExitCode,
      childSignal,
      stdout,
      stderr,
      reason: `spawn-failure:${spawnError.code ?? spawnError.message}`,
    });
  }

  if (childSignal !== null || childExitCode === null) {
    return result({
      processExit: 1,
      childExitCode,
      childSignal,
      stdout,
      stderr,
      reason: childSignal ? `signal:${childSignal}` : 'null-child-status',
    });
  }

  if (childExitCode === 0) {
    return result({ processExit: 0, childExitCode, childSignal, stdout, stderr, reason: 'pass' });
  }

  const markerLines = registeredMarkerLines(stdout, stderr);
  const expectedMarker = C3_E8_INPUT_MARKERS[kind];
  const expectedCount = markerLines.filter((line) => line === expectedMarker).length;
  const hasWrongOrDuplicateMarker =
    markerLines.length !== 1 || expectedCount !== 1 || markerLines[0] !== expectedMarker;

  if (!hasWrongOrDuplicateMarker) {
    const marker = classifierLine(
      `c3_e8_classifier_missing:kind=${kind}:marker=${expectedMarker}`,
    );
    return result({
      processExit: 2,
      childExitCode,
      childSignal,
      stdout,
      stderr,
      reason: 'registered-input-marker',
      marker,
    });
  }

  return result({
    processExit: 1,
    childExitCode,
    childSignal,
    stdout,
    stderr,
    reason: markerLines.length === 0 ? 'nonzero-without-registered-marker' : 'contradictory-marker-evidence',
  });
}

export function classify({ kind, argv } = {}) {
  if (typeof kind !== 'string' || kind.length === 0) return Promise.resolve(invalidResult('reason=missing-kind'));
  if (!Object.hasOwn(C3_E8_INPUT_MARKERS, kind)) {
    return Promise.resolve(invalidResult(`reason=unknown-kind:kind=${kind}`));
  }
  if (!Array.isArray(argv) || argv.length === 0 || argv.some((argument) => typeof argument !== 'string')) {
    return Promise.resolve(invalidResult(`reason=missing-command:kind=${kind}`));
  }

  const [command, ...args] = argv;
  let child;
  try {
    child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    if (error?.code === 'ENOENT') return Promise.resolve(missingResult(`reason=command-not-available:command=${command}`));
    return Promise.resolve(
      result({ processExit: 1, reason: `spawn-failure:${error?.code ?? error?.message ?? 'unknown'}` }),
    );
  }

  let stdout = '';
  let stderr = '';
  let spawnError = null;
  child.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    stdout += text;
    process.stdout.write(text);
  });
  child.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    stderr += text;
    process.stderr.write(text);
  });

  return new Promise((resolve) => {
    child.once('error', (error) => {
      spawnError = { code: error.code, message: error.message, command };
    });
    child.once('close', (childExitCode, childSignal) => {
      resolve(
        classifyChild({
          kind,
          childExitCode,
          childSignal,
          stdout,
          stderr,
          spawnError,
        }),
      );
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [kind, separator, ...commandArgv] = process.argv.slice(2);
  const argv = separator === '--' ? commandArgv : [separator, ...commandArgv].filter((value) => value !== undefined);
  const outcome = await classify({ kind, argv });
  process.exitCode = outcome.process;
}
