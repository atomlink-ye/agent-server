/**
 * What an agent is TOLD when a WorkItem names it.
 *
 * A wake that only says "you were mentioned" wastes a turn: the agent has to go
 * looking for the WorkItem, and cannot tell whether it is allowed to start. So
 * the brief carries the identifiers it needs to act and the exact tool call that
 * takes ownership, and nothing else.
 *
 * The prose is English to match the product surface a human or a Coworker reads
 * it in; identifiers, tool refs, and the JSON argument stay literal so they can
 * be copied into a call unchanged.
 *
 * It is pure so the wording is testable without a database, a runtime, or a
 * model, and so re-waking on the same event produces byte-identical prose.
 */

/** The tool an agent uses to take a WorkItem; see built-in-skills. */
const CLAIM_TOOL_REF = 'agent-server/work-item-claim';
const STATUS_TOOL_REF = 'agent-server/work-item-status';

// Enough to carry the point, short enough that the instructions below stay the
// most prominent thing in the message.
const MAX_TITLE = 160;
const MAX_QUOTE = 400;

export type WorkItemMentionReason = 'mention' | 'assignment' | 'comment';

export interface WorkItemMentionBriefInput {
  readonly reason: WorkItemMentionReason;
  /** How the person or agent that caused this should be named to the reader. */
  readonly actorLabel: string;
  readonly workItem: {
    readonly id: string;
    readonly title: string;
    readonly boardId?: string;
    readonly columnId?: string;
  };
  /** The comment text that carried the mention, when there was one. */
  readonly quote?: string;
}

export function workItemMentionBrief(input: WorkItemMentionBriefInput): string {
  const actor = compact(input.actorLabel, 120) || 'Someone';
  const title = compact(input.workItem.title, MAX_TITLE);
  const onBoard = Boolean(input.workItem.boardId && input.workItem.columnId);
  const lines: string[] = [opening(input.reason, actor, title)];

  lines.push(`WorkItem: ${input.workItem.id}`);
  if (onBoard)
    lines.push(
      `Board: ${input.workItem.boardId} (column ${input.workItem.columnId})`,
    );

  const quote = input.quote ? compact(input.quote, MAX_QUOTE) : '';
  if (quote) lines.push(`They wrote: "${quote}"`);

  // Claiming is what makes the work yours, and it is also what tells everyone
  // else to leave it alone — so it is stated as the first step, not an option.
  // The board sentence is omitted off-board rather than hedged: telling an agent
  // about a Doing column that cannot exist invites it to go looking for one.
  lines.push(
    `To take this work, call ${CLAIM_TOOL_REF} with {"work_item_id":"${input.workItem.id}"}. ` +
      'Claiming is atomic: if it returns that someone else already claimed it, ' +
      'they are on it and you must not start. Claiming does not set the status — ' +
      `call ${STATUS_TOOL_REF} with {"status":"in_progress"} when you start; ` +
      'if your brief says to wait, leave it in todo.' +
      (onBoard
        ? ' On a successful claim, if this board declares a Doing column, the WorkItem moves there too.'
        : ''),
  );
  lines.push(
    'If you are not the right one to do this, reply here explaining why and do not claim it.',
  );
  // Mirrors an incident we already fixed once (a WorkRun that succeeded but
  // showed nothing on Files/Overview): the wake should not let it recur by
  // omission, so it says the sentence out loud instead of assuming an agent
  // will think to close the loop on its own.
  lines.push(
    'When you finish the work, post the result as a comment on the WorkItem and ' +
      'set its status to done rather than leaving it in progress' +
      (onBoard
        ? ' — a board that disagrees with reality is worse than no board at all.'
        : '.'),
  );
  return lines.join('\n');
}

function opening(
  reason: WorkItemMentionReason,
  actor: string,
  title: string,
): string {
  switch (reason) {
    case 'assignment':
      return `${actor} assigned a WorkItem to you: ${title}`;
    case 'comment':
      return `${actor} mentioned you in a comment on a WorkItem: ${title}`;
    default:
      return `${actor} mentioned you on a WorkItem: ${title}`;
  }
}

function compact(value: string, max: number): string {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  return normalized.length > max
    ? `${normalized.slice(0, max - 1)}…`
    : normalized;
}
