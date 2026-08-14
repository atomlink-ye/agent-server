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

export const INDEPENDENT_EXPECTED_RULES = Object.freeze({
  'e8-browser': 'fixed Vitest summary: one file, two tests, no skip/todo',
  'e8-behavior': 'explicit mutation-arm registry: one selected arm',
  'c3-classifier': 'source-declared classifier case registry',
  'absence-runner': 'absence runner contract: fixed command and marker checks',
  'e8-request-ledger': 'list journey rule: one GET /api/works control',
  'c4-e10': 'declared E10 scenario set',
  'c4-e11': 'declared E11 scenario set',
  'c4-response': 'declared response tuple rule',
  'c4-dom': 'declared DOM assertion rule',
  'c4-cleanup': 'declared cleanup probe rule',
});

const kinds = new Set(Object.values(ZERO_EXECUTION_KINDS));
const subclasses = new Set(['instrument', 'target-unavailable']);

export function zeroExecutionMarker(kind, subclass) {
  return `c3_c4_zero_execution:kind=${kind}:subclass=${subclass}`;
}

export function zeroExecutionOutcome({
  kind,
  observedCount,
  independentExpectedCount,
  expectedRule,
  observedCountSource,
  expectedProvenance,
  unavailableClass = 'instrument',
}) {
  if (!kinds.has(kind))
    return { process: 2, marker: `c3_c4_zero_execution:kind=${kind ?? ''}:subclass=target-unavailable` };
  if (!subclasses.has(unavailableClass))
    return { process: 2, marker: zeroExecutionMarker(kind, 'instrument') };
  const expected = independentExpectedCount;
  if (!Number.isInteger(observedCount) || observedCount < 0 ||
      !Number.isInteger(expected) || expected < 0 ||
      expectedRule !== INDEPENDENT_EXPECTED_RULES[kind] ||
      !observedCountSource || !expectedProvenance ||
      observedCountSource === expectedProvenance)
    return { process: 2, marker: zeroExecutionMarker(kind, 'instrument') };
  if (observedCount === expected) return { process: 0, marker: null };
  if (expected === 0 && observedCount > 0)
    return { process: 1, marker: null };
  return { process: 2, marker: zeroExecutionMarker(kind, unavailableClass) };
}

export function parseZeroExecutionArgv(argv) {
  if (!Array.isArray(argv) || argv.length !== 7 || argv[1] !== '--observed' ||
      argv[3] !== '--expected' || argv[5] !== '--subclass') return null;
  return {
    kind: argv[0],
    observedCount: Number(argv[2]),
    independentExpectedCount: Number(argv[4]),
    unavailableClass: argv[6],
  };
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const parsed = parseZeroExecutionArgv(process.argv.slice(2));
  if (!parsed) {
    process.stdout.write('c3_c4_zero_execution:subclass=instrument:reason=usage\n');
    process.exitCode = 2;
  } else {
    const expectedRule = INDEPENDENT_EXPECTED_RULES[parsed.kind];
    const outcome = zeroExecutionOutcome({
      ...parsed,
      expectedRule,
      observedCountSource: 'cli-observed-count',
      expectedProvenance: 'cli-independent-rule',
    });
    if (outcome.marker) process.stdout.write(`${outcome.marker}\n`);
    process.exitCode = outcome.process;
  }
}
