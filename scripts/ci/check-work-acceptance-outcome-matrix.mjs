#!/usr/bin/env node

import assert from 'node:assert/strict';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import {
  MARKER_CLASSES,
  classifyWorkAcceptanceOutcome,
  outcomeRuleMatches,
  structuralReachability,
} from './work-acceptance-outcome.mjs';

const statuses = [0, 1, 3, null];
const signals = [null, 'SIGTERM'];
const errors = [null, 'ENOENT'];
const theoretical = [];
for (const status of statuses) {
  for (const signal of signals) {
    for (const error of errors) {
      for (const markerClass of MARKER_CLASSES) {
        const point = { status, signal, error, markerClass };
        const matches = outcomeRuleMatches(point).filter(
          (rule) => rule.matches,
        );
        assert.equal(
          matches.length,
          1,
          `non_partition:${JSON.stringify(point)}`,
        );
        assert.equal(
          classifyWorkAcceptanceOutcome(point),
          matches[0].exit,
          `decision_mismatch:${JSON.stringify(point)}`,
        );
        theoretical.push({
          ...point,
          rule: matches[0].rule,
          classifier_exit: matches[0].exit,
          reachability: structuralReachability(point),
        });
      }
    }
  }
}
assert.equal(theoretical.length, 64);

const selected =
  'WORK_ACCEPTANCE_MISSING[work_http_projection_installer_missing]';
const other =
  'WORK_ACCEPTANCE_MISSING[work_mcp_registration_missing:product_work_create]';
const markerText = {
  absent: '',
  'exact-selected-kind': selected,
  'exact-other-kind': other,
  'near-miss': `not_${selected}_suffix`,
};
const runtimeCases = [];
for (const status of [0, 1, 3]) {
  for (const markerClass of MARKER_CLASSES) {
    runtimeCases.push(runChild({ status, markerClass }));
  }
}
for (const markerClass of MARKER_CLASSES) {
  runtimeCases.push(runChild({ status: null, signal: 'SIGTERM', markerClass }));
}
runtimeCases.push(runSpawnError());

console.log(
  JSON.stringify({
    guard: 'work-acceptance-outcome-matrix',
    theoretical_points: theoretical.length,
    mutually_exclusive_and_exhaustive: true,
    rules: [
      'status=0 + signal=none + error=none => PASS=0 for every marker class',
      'status=1 + signal=none + error=none + exact-selected-kind => MISSING=2',
      'every other point => FAIL=1',
    ],
    structurally_unreachable_points: theoretical.filter((point) =>
      point.reachability.startsWith('STRUCTURALLY_UNREACHABLE'),
    ),
    runtime_representatives: runtimeCases,
    ok: true,
  }),
);

function runChild({ status, signal = null, markerClass }) {
  const text = markerText[markerClass];
  const program = `${text ? `console.error(${JSON.stringify(text)});` : ''}${signal ? `process.kill(process.pid,${JSON.stringify(signal)})` : `process.exit(${status})`}`;
  const result = spawnSync(
    'node',
    [
      'scripts/ci/classify-work-acceptance.mjs',
      '--kind',
      'http-projection',
      '--',
      'node',
      '-e',
      program,
    ],
    { cwd: process.cwd(), encoding: 'utf8' },
  );
  const expected = classifyWorkAcceptanceOutcome({
    status,
    signal,
    error: null,
    markerClass,
  });
  assert.equal(
    result.status,
    expected,
    `runtime_case:${status}:${signal}:${markerClass}`,
  );
  return {
    status,
    signal,
    error: null,
    marker_class: markerClass,
    classifier_exit: result.status,
  };
}

function runSpawnError() {
  const result = spawnSync(
    'node',
    [
      'scripts/ci/classify-work-acceptance.mjs',
      '--kind',
      'http-projection',
      '--',
      '/tmp/mgr-b-deliberately-absent-work-acceptance-command',
    ],
    { cwd: process.cwd(), encoding: 'utf8' },
  );
  assert.equal(result.status, 1, 'runtime_spawn_error');
  assert.match(result.stderr, /status=null:signal=none:error=ENOENT/);
  return {
    status: null,
    signal: null,
    error: 'ENOENT',
    marker_class: 'absent',
    classifier_exit: 1,
  };
}
