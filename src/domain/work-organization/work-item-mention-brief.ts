/**
 * What an agent is TOLD when a WorkItem names it.
 *
 * A wake that only says "you were mentioned" wastes a turn: the agent has to go
 * looking for the WorkItem, and cannot tell whether it is allowed to start. So
 * the brief carries the identifiers it needs to act and the exact tool call that
 * takes ownership, and nothing else.
 *
 * The prose is Chinese because a human or a Coworker reads it verbatim in chat;
 * identifiers, tool refs, and the JSON argument stay literal so they can be
 * copied into a call unchanged.
 *
 * It is pure so the wording is testable without a database, a runtime, or a
 * model, and so re-waking on the same event produces byte-identical prose.
 */

/** The tool an agent uses to take a WorkItem; see built-in-skills. */
const CLAIM_TOOL_REF = 'agent-server/work-item-claim';

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
  const actor = compact(input.actorLabel, 120) || '有人';
  const title = compact(input.workItem.title, MAX_TITLE);
  const onBoard = Boolean(input.workItem.boardId && input.workItem.columnId);
  const lines: string[] = [opening(input.reason, actor, title)];

  lines.push(`WorkItem：${input.workItem.id}`);
  if (onBoard)
    lines.push(
      `看板：${input.workItem.boardId}（列 ${input.workItem.columnId}）`,
    );

  const quote = input.quote ? compact(input.quote, MAX_QUOTE) : '';
  if (quote) lines.push(`对方写道：“${quote}”`);

  // Claiming is what makes the work yours, and it is also what tells everyone
  // else to leave it alone — so it is stated as the first step, not an option.
  // The board sentence is omitted off-board rather than hedged: telling an agent
  // about a Doing column that cannot exist invites it to go looking for one.
  lines.push(
    `要接手这项工作，请调用 ${CLAIM_TOOL_REF}，参数为 {"work_item_id":"${input.workItem.id}"}。` +
      '认领是原子操作：如果返回“已被他人认领”，说明已经有人在做，你不要开始。' +
      (onBoard
        ? '认领成功后，如果该看板声明了 Doing 列，这个 WorkItem 会同时被移动到该列。'
        : ''),
  );
  lines.push('如果你不是合适的执行者，请在这里回复说明原因，不要认领。');
  return lines.join('\n');
}

function opening(
  reason: WorkItemMentionReason,
  actor: string,
  title: string,
): string {
  switch (reason) {
    case 'assignment':
      return `${actor} 把一个 WorkItem 指派给了你：${title}`;
    case 'comment':
      return `${actor} 在一个 WorkItem 的评论里提到了你：${title}`;
    default:
      return `${actor} 在一个 WorkItem 上提到了你：${title}`;
  }
}

function compact(value: string, max: number): string {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  return normalized.length > max
    ? `${normalized.slice(0, max - 1)}…`
    : normalized;
}
