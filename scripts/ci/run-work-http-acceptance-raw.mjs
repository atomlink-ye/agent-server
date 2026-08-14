#!/usr/bin/env node

import process from 'node:process';
import {
  requireCanonicalInputs,
  runVitestTarget,
} from './work-acceptance-raw-support.mjs';

if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) {
  console.error('WORK_ACCEPTANCE_MISSING[work_http_database_unavailable]');
  process.exit(1);
}
if (
  !(await requireCanonicalInputs({
    kind: 'http-projection',
    environmentMarker: 'work_http_environment_unavailable',
  }))
)
  process.exit(1);
process.exit(
  runVitestTarget({
    kind: 'http-projection',
    expectedMinCount: 3,
    zeroExecutionMarker: 'work_http_zero_execution',
    underExecutionMarker: 'work_http_instrument_underexecution',
    pattern: 'requires owner positive control|fails closed|runs the real HTTP',
  }),
);
