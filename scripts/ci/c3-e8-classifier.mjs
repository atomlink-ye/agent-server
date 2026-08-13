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

const EMPTY_BUFFER = Buffer.alloc(0);
const INPUT_MARKER_PREFIX = 'c3_e8_input_missing:';
const CLASSIFIER_MARKER_PREFIX = 'c3_e8_classifier_';

function classifierLine(line) {
  process.stdout.write(`${line}\n`);
  return line;
}

export function classifierFraming(stdout) {
  return Buffer.isBuffer(stdout) && stdout.length > 0 && stdout.at(-1) !== 0x0a
    ? Buffer.from('\n')
    : EMPTY_BUFFER;
}

function result({
  processExit,
  stdout = EMPTY_BUFFER,
  stderr = EMPTY_BUFFER,
  childExitCode = null,
  childSignal = null,
  reason,
  marker,
}) {
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

function decodeForClassification(value) {
  if (Buffer.isBuffer(value)) return new TextDecoder().decode(value);
  return typeof value === 'string' ? value : '';
}

function reservedMarkerLines(stdout, stderr) {
  return `${decodeForClassification(stdout)}\n${decodeForClassification(stderr)}`
    .split(/\r?\n/u)
    .filter(
      (line) => line.startsWith(INPUT_MARKER_PREFIX) || line.startsWith(CLASSIFIER_MARKER_PREFIX),
    );
}

export function parseCliArgv(argv) {
  if (!Array.isArray(argv) || argv.length < 3) return null;
  const [kind, separator, command, ...args] = argv;
  if (typeof kind !== 'string' || kind.length === 0 || separator !== '--') return null;
  if (typeof command !== 'string' || command.length === 0) return null;
  if (args.some((argument) => typeof argument !== 'string' || argument.length === 0)) return null;
  return { kind, argv: [command, ...args] };
}

export function classifyChild({ kind, childExitCode, childSignal, stdout = EMPTY_BUFFER, stderr = EMPTY_BUFFER, spawnError }) {
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

  const markerLines = reservedMarkerLines(stdout, stderr);
  const expectedMarker = C3_E8_INPUT_MARKERS[kind];
  const expectedCount = markerLines.filter((line) => line === expectedMarker).length;

  if (markerLines.length === 1 && expectedCount === 1) {
    process.stdout.write(classifierFraming(stdout));
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
  if (command.length === 0) return Promise.resolve(invalidResult(`reason=empty-command:kind=${kind}`));

  let child;
  try {
    child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    if (error?.code === 'ENOENT') return Promise.resolve(missingResult(`reason=command-not-available:command=${command}`));
    return Promise.resolve(
      result({ processExit: 1, reason: `spawn-failure:${error?.code ?? error?.message ?? 'unknown'}` }),
    );
  }

  const stdoutChunks = [];
  const stderrChunks = [];
  let spawnError = null;
  child.stdout.on('data', (chunk) => {
    stdoutChunks.push(chunk);
    process.stdout.write(chunk);
  });
  child.stderr.on('data', (chunk) => {
    stderrChunks.push(chunk);
    process.stderr.write(chunk);
  });

  return new Promise((resolve) => {
    child.once('error', (error) => {
      spawnError = { code: error.code, message: error.message, command };
    });
    child.once('close', (childExitCode, childSignal) => {
      const stdout = Buffer.concat(stdoutChunks);
      const stderr = Buffer.concat(stderrChunks);
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
  const parsed = parseCliArgv(process.argv.slice(2));
  const outcome = parsed
    ? await classify(parsed)
    : invalidResult('reason=usage:expected=<kind> -- <nonempty-command> [args...]');
  process.exitCode = outcome.process;
}
