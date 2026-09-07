import { expect, it } from 'vitest';

import { workItemMentionBrief } from '../../../../../src/domain/work-organization/work-item-mention-brief';
import { recognizeLegacyWorkItemAssignmentBrief } from './legacy-work-item-assignment-brief';

const workItemId = '11111111-1111-4111-8111-111111111111';
const boardId = '22222222-2222-4222-8222-222222222222';
const columnId = '33333333-3333-4333-8333-333333333333';

function brief({ board = false }: { readonly board?: boolean } = {}): string {
  return workItemMentionBrief({
    reason: 'assignment',
    actorLabel: 'Ari',
    workItem: {
      id: workItemId,
      title: 'Review the launch plan',
      boardId: board ? boardId : undefined,
      columnId: board ? columnId : undefined,
    },
  });
}

it('recognizes the complete persisted assignment brief', () => {
  expect(recognizeLegacyWorkItemAssignmentBrief(brief())).toMatchObject({
    kind: 'work_item_dispatch',
    workItemId,
    reason: 'assignment',
    actorLabel: 'Ari',
    recipientLabel: '',
    taskTitle: 'Review the launch plan',
  });
});

it('recognizes the complete on-board assignment brief', () => {
  expect(
    recognizeLegacyWorkItemAssignmentBrief(brief({ board: true })),
  ).not.toBeNull();
});

it('recognizes the known server-added assignment wake suffix', () => {
  const wake =
    `${brief()}\n\nThis is an assignment wake. Call work_item_claim (tool agent-server/work-item-claim) to claim this WorkItem, then carry out the task below and reply in this conversation with the result.\n\nTask: \n` +
    'Read the launch plan and record the risks.';
  expect(recognizeLegacyWorkItemAssignmentBrief(wake)).not.toBeNull();
});

it('leaves a brief missing completion as ordinary chat', () => {
  expect(
    recognizeLegacyWorkItemAssignmentBrief(
      brief().split('\n').slice(0, -1).join('\n'),
    ),
  ).toBeNull();
});

it('leaves arbitrary appended text as ordinary chat', () => {
  expect(
    recognizeLegacyWorkItemAssignmentBrief(`${brief()}\nA separate note.`),
  ).toBeNull();
});

it('leaves a brief with a different claim UUID as ordinary chat', () => {
  expect(
    recognizeLegacyWorkItemAssignmentBrief(
      brief().replace(
        `"work_item_id":"${workItemId}"`,
        '"work_item_id":"44444444-4444-4444-8444-444444444444"',
      ),
    ),
  ).toBeNull();
});
