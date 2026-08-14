export const ZERO_EXECUTION_KINDS = Object.freeze({
  E8_BROWSER: 'e8-browser',
  E8_BEHAVIOR: 'e8-behavior',
  C3_CLASSIFIER: 'c3-classifier',
  ABSENCE_RUNNER: 'absence-runner',
  E8_REQUEST_LEDGER: 'e8-request-ledger',
  C4_E10: 'c4-e10',
  C4_E11: 'c4-e11',
  C4_RESPONSE: 'c4-response',
  C4_DOM: 'c4-dom',
  C4_CLEANUP: 'c4-cleanup',
});

export const EXPECTED_MIN_COUNTS = Object.freeze({
  'e8-browser': 2,
  'e8-behavior': 1,
  'c3-classifier': 12,
  'absence-runner': 1,
  'e8-request-ledger': 1,
  'c4-e10': 2,
  'c4-e11': 2,
  'c4-response': 1,
  'c4-dom': 1,
  'c4-cleanup': 1,
});

const kinds = new Set(Object.values(ZERO_EXECUTION_KINDS));

export function zeroExecutionMarker(kind, expectedMinCount) {
  return `c3_c4_zero_execution:kind=${kind}:expected_min_count=${expectedMinCount}`;
}

export function zeroExecutionOutcome({ kind, observedCount, expectedMinCount }) {
  if (!kinds.has(kind))
    return { process: 2, marker: `c3_c4_zero_execution_invalid:kind=${kind ?? ''}` };
  if (!Number.isInteger(observedCount) || observedCount < 0)
    return { process: 2, marker: `c3_c4_zero_execution_invalid:count=${observedCount}` };
  const expected = expectedMinCount ?? EXPECTED_MIN_COUNTS[kind];
  if (!Number.isInteger(expected) || expected < 1)
    return { process: 2, marker: `c3_c4_zero_execution_invalid:expected_min_count=${expected}` };
  if (observedCount < expected)
    return { process: 2, marker: zeroExecutionMarker(kind, expected) };
  return { process: 0, marker: null };
}

export function parseZeroExecutionArgv(argv) {
  if (!Array.isArray(argv) || argv.length !== 5 || argv[1] !== '--count' || argv[3] !== '--expected')
    return null;
  const kind = argv[0];
  const observedCount = Number(argv[2]);
  const expectedMinCount = Number(argv[4]);
  return { kind, observedCount, expectedMinCount };
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const [kind, separator, count, expectedFlag, expected] = process.argv.slice(2);
  if (separator !== '--count' || expectedFlag !== '--expected' || count === undefined || expected === undefined) {
    process.stdout.write('c3_c4_zero_execution_invalid:reason=usage\n');
    process.exitCode = 2;
  } else {
    const outcome = zeroExecutionOutcome({
      kind,
      observedCount: Number(count),
      expectedMinCount: Number(expected),
    });
    if (outcome.marker) process.stdout.write(`${outcome.marker}\n`);
    process.exitCode = outcome.process;
  }
}
