import type { WorkItemDispatch } from './contracts';

const UUID_PATTERN =
  '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const assignmentOpening = new RegExp(
  '^(.{1,120}) assigned a WorkItem to you: (.{1,160})$',
  'u',
);
const workItemLine = new RegExp(`^WorkItem: (${UUID_PATTERN})$`, 'iu');
const boardLine = new RegExp(
  `^Board: (${UUID_PATTERN}) \\(column (${UUID_PATTERN})\\)$`,
  'iu',
);
const quoteLine = /^They wrote: "(.{1,400})"$/u;
const wakeSuffix =
  /^\n\nThis is an assignment wake\. Call work_item_claim \(tool agent-server\/work-item-claim\) to claim this WorkItem, then carry out the task below and reply in this conversation with the result\.\n\nTask: (?:complete the work described by the WorkItem title\.|\n[\s\S]*)$/u;
const rejectionLine =
  'If you are not the right one to do this, reply here explaining why and do not claim it.';
const completionLine =
  'When you finish the work, post the result as a comment on the WorkItem and set its status to done rather than leaving it in progress.';
const boardCompletionLine =
  'When you finish the work, post the result as a comment on the WorkItem and set its status to done rather than leaving it in progress — a board that disagrees with reality is worse than no board at all.';

/**
 * Recognizes only the complete, old assignment brief that was persisted before
 * dispatch metadata existed. It is a display bridge, not a durable parser.
 */
export function recognizeLegacyWorkItemAssignmentBrief(
  body: string,
): WorkItemDispatch | null {
  const lines = body.split('\n');
  const opening = assignmentOpening.exec(lines[0] ?? '');
  const workItem = workItemLine.exec(lines[1] ?? '');
  if (!opening || !workItem) return null;

  let index = 2;
  const board = boardLine.exec(lines[index] ?? '');
  if (board) index += 1;
  if (quoteLine.test(lines[index] ?? '')) index += 1;

  const workItemId = workItem[1]!;
  const claimLine =
    `To take this work, call agent-server/work-item-claim with {"work_item_id":"${workItemId}"}. ` +
    'Claiming is atomic: if it returns that someone else already claimed it, they are on it and you must not start.';
  const expectedClaimLine = board
    ? `${claimLine} On a successful claim, if this board declares a Doing column, the WorkItem moves there too.`
    : claimLine;
  const expectedCompletionLine = board ? boardCompletionLine : completionLine;
  if (
    lines[index] !== expectedClaimLine ||
    lines[index + 1] !== rejectionLine ||
    lines[index + 2] !== expectedCompletionLine
  ) {
    return null;
  }

  const core = lines.slice(0, index + 3).join('\n');
  const tail = body.slice(core.length);
  if (tail && !wakeSuffix.test(tail)) return null;

  return {
    kind: 'work_item_dispatch',
    workItemId,
    reason: 'assignment',
    actorLabel: opening[1]!.trim(),
    recipientLabel: '',
    taskTitle: opening[2]!.trim(),
  };
}
