#!/usr/bin/env node

import { classifyAcceptanceExecutionCount } from './work-acceptance-raw-support.mjs';

const cases = [
  { expected_min_count: 0, observed_count: 0, expected: 'PASS' },
  { expected_min_count: 0, observed_count: 1, expected: 'PASS' },
  { expected_min_count: 1, observed_count: 0, expected: 'ZERO_EXECUTION' },
  { expected_min_count: 1, observed_count: 1, expected: 'PASS' },
  {
    expected_min_count: 3,
    observed_count: 2,
    expected: 'INSTRUMENT_UNDEREXECUTION',
  },
];
const results = cases.map((entry) => ({
  ...entry,
  actual: classifyAcceptanceExecutionCount({
    expectedMinCount: entry.expected_min_count,
    observedCount: entry.observed_count,
  }),
}));
const ok = results.every((entry) => entry.actual === entry.expected);
console.log(
  JSON.stringify({
    guard: 'acceptance-execution-count-contract',
    expected_source: 'caller-declared acceptance instrument minimum',
    observed_source: 'Vitest JSON passed+failed target assertions',
    legal_zero_expected: true,
    business_collection_rule: 'not_applicable',
    cases: results,
    ok,
  }),
);
process.exit(ok ? 0 : 1);
