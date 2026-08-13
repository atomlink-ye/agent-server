import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assertScenarioPredicate } from './capture-product-run.mjs';

const teamRows = [{ status: 'succeeded' }];
const workRows = [{ id: 'work-1', status: 'accepted' }];

test('rework-once predicate requires later-attempt feedback on the same work', () => {
  assert.doesNotThrow(() =>
    assertScenarioPredicate('rework-once', teamRows, workRows, [
      {
        work_item_id: 'work-1',
        attempt_no: 1,
        status: 'completed',
        feedback: null,
      },
      {
        work_item_id: 'work-1',
        attempt_no: 2,
        status: 'completed',
        feedback: 'fix the missing acceptance marker',
      },
    ]),
  );

  for (const attemptRows of [
    [
      {
        work_item_id: 'work-1',
        attempt_no: 1,
        status: 'completed',
        feedback: 'feedback without a rework attempt',
      },
    ],
    [
      {
        work_item_id: 'work-1',
        attempt_no: 1,
        status: 'completed',
        feedback: null,
      },
      {
        work_item_id: 'work-1',
        attempt_no: 2,
        status: 'completed',
        feedback: '   ',
      },
    ],
  ]) {
    assert.throws(
      () =>
        assertScenarioPredicate('rework-once', teamRows, workRows, attemptRows),
      (error) =>
        error instanceof Error &&
        error.message === 'rework_once_live_predicate_failed',
    );
  }
});
