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

export const SOURCE_OWNED_RULES = Object.freeze({
  'e8-browser': { expectedCount: 2, permitsZero: false, provenance: 'fixed Vitest summary: one file, two tests, no skip/todo' },
  'e8-behavior': { expectedCount: 1, permitsZero: false, provenance: 'explicit C3 mutation-arm registry: one selected arm' },
  'c3-classifier': { expectedCount: 12, permitsZero: false, provenance: 'source-declared classifier case registry' },
  'absence-runner': { expectedCount: 1, permitsZero: false, provenance: 'absence runner fixed command and marker contract' },
  'e8-request-ledger': { expectedCount: 1, permitsZero: false, provenance: 'list journey rule: one GET /api/works control' },
});

export const SOURCE_OWNED_OPTIONAL_RULE = Object.freeze({
  id: 'c3-optional-business',
  expectedCount: 0,
  permitsZero: true,
  provenance: 'C3 optional-business fixture manifest explicitly permits an empty set',
});

const kinds = new Set(Object.values(ZERO_EXECUTION_KINDS));

export function zeroExecutionMarker(kind, subclass, reason = 'count-mismatch') {
  return `c3_c4_zero_execution:kind=${kind}:subclass=${subclass}:reason=${reason}`;
}

export function compareSourceOwnedRule({
  kind,
  rule,
  observedCount,
  observedCountSource,
  expectedProvenance,
  unavailableReason = 'instrument',
}) {
  const subclass = unavailableReason === 'target-unavailable'
    ? 'target-unavailable'
    : 'instrument';
  if (!rule || !Number.isInteger(rule.expectedCount) || rule.expectedCount < 0 ||
      !rule.provenance || !observedCountSource ||
      expectedProvenance !== rule.provenance || observedCountSource === expectedProvenance ||
      !Number.isInteger(observedCount) || observedCount < 0 ||
      (rule.expectedCount === 0 && !rule.permitsZero))
    return { process: 2, marker: zeroExecutionMarker(kind, 'instrument', 'rule-unavailable') };
  if (observedCount === rule.expectedCount) return { process: 0, marker: null };
  if (observedCount > rule.expectedCount) return { process: 1, marker: null };
  return { process: 2, marker: zeroExecutionMarker(kind, subclass, 'observed-less-than-independent-rule') };
}

export function zeroExecutionOutcome({ kind, observedCount, observedCountSource, unavailableReason }) {
  if (!kinds.has(kind))
    return { process: 2, marker: zeroExecutionMarker(kind ?? '', 'target-unavailable', 'unknown-kind') };
  const rule = SOURCE_OWNED_RULES[kind];
  if (!rule)
    return { process: 2, marker: zeroExecutionMarker(kind, 'instrument', 'independent-rule-unavailable') };
  return compareSourceOwnedRule({
    kind,
    rule,
    observedCount,
    observedCountSource,
    expectedProvenance: rule.provenance,
    unavailableReason,
  });
}

export function parseZeroExecutionArgv(argv) {
  if (!Array.isArray(argv) || argv.length !== 3 || argv[1] !== '--observed') return null;
  return { kind: argv[0], observedCount: Number(argv[2]) };
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const parsed = parseZeroExecutionArgv(process.argv.slice(2));
  if (!parsed) {
    process.stdout.write('c3_c4_zero_execution:kind=:subclass=instrument:reason=usage\n');
    process.exitCode = 2;
  } else {
    const outcome = zeroExecutionOutcome({
      ...parsed,
      observedCountSource: 'cli-observed-count',
    });
    if (outcome.marker) process.stdout.write(`${outcome.marker}\n`);
    process.exitCode = outcome.process;
  }
}
