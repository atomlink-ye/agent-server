import assert from 'node:assert/strict';

import { evaluateProcessEvidenceMatrix } from './phase-c.mjs';
import {
  hashProcessRecords,
  isPaseoExecutableProcess,
  isPaseoProcess,
} from './lib/phase-c-process-inspection.mjs';

const snapshot = (complete) => ({
  numeric_count: 1,
  emitted_count: 1,
  enoent_count: complete ? 0 : 1,
  read_error_count: 0,
  integrity_error_count: 0,
  error_class: complete ? 'none' : 'enoent',
});

function collection(processes, { complete = true } = {}) {
  return {
    snapshots: [snapshot(complete), snapshot(complete)],
    emitted_count: processes.length,
    record_hash: hashProcessRecords(processes),
    stable: complete,
    complete,
  };
}

function evidence(processes, expectation, forbidden, options) {
  return {
    collection: collection(processes, options),
    processes,
    expectation,
    forbidden,
  };
}

const strong = { pid: 10, identity: 'paseo-daemon' };
const ordinary = { pid: 11, identity: 'other' };

// Binding validity is globally first: a semantic contradiction cannot turn an
// independently invalid evidence arm into FAIL.
const contradictionPlusInvalid = evaluateProcessEvidenceMatrix({
  present_baseline: evidence([ordinary], 'present', isPaseoExecutableProcess),
  invalid_agent: {
    ...evidence([strong], 'absent', isPaseoProcess),
    processes: [{ ...strong, unknown_field: true }],
    collection: collection([{ ...strong, unknown_field: true }]),
  },
});
assert.equal(contradictionPlusInvalid.status, 'MISSING');

// A valid forbidden Agent witness is fail-loud even when completeness is
// unavailable; it must beat the absence unknown state.
const forbiddenIncomplete = evaluateProcessEvidenceMatrix({
  agent: evidence([strong], 'absent', isPaseoProcess, { complete: false }),
});
assert.equal(forbiddenIncomplete.status, 'FAIL');

const presentCompleteNoWitness = evaluateProcessEvidenceMatrix({
  runtime: evidence([ordinary], 'present', isPaseoExecutableProcess),
});
assert.equal(presentCompleteNoWitness.status, 'FAIL');

const presentIncompleteNoWitness = evaluateProcessEvidenceMatrix({
  runtime: evidence([ordinary], 'present', isPaseoExecutableProcess, {
    complete: false,
  }),
});
assert.equal(presentIncompleteNoWitness.status, 'MISSING');

// Positive witnesses are sufficient despite incomplete snapshots; complete
// absence is sufficient for expected-absent arms.
assert.equal(
  evaluateProcessEvidenceMatrix({
    runtime: evidence([strong], 'present', isPaseoExecutableProcess, {
      complete: false,
    }),
  }).status,
  'PASS',
);
assert.equal(
  evaluateProcessEvidenceMatrix({
    agent: evidence([ordinary], 'absent', isPaseoProcess),
  }).status,
  'PASS',
);

for (const processes of [
  [{ ...strong, identity: 'not-an-identity' }],
  [{ ...strong }, { ...strong }],
]) {
  const result = evaluateProcessEvidenceMatrix({
    tampered: {
      collection: collection(processes),
      processes,
      expectation: 'present',
      forbidden: isPaseoExecutableProcess,
    },
  });
  assert.equal(result.status, 'MISSING');
}

process.stdout.write(
  `${JSON.stringify({
    status: 'PASS',
    invalid_binding_precedes_contradiction: true,
    forbidden_incomplete_is_fail: true,
    present_complete_without_witness_is_fail: true,
    incomplete_without_witness_is_missing: true,
    both_polarities_covered: true,
    self_consistent_tamper_is_missing: true,
  })}\n`,
);
