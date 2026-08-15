export const AGENT_SERVER_COLLABORATION_TOOL_REFS = Object.freeze({
  state: 'agent-server/collaboration-state',
  boardList: 'agent-server/board-list',
  boardCreate: 'agent-server/board-create',
  boardAssign: 'agent-server/board-assign',
  boardClaim: 'agent-server/board-claim',
  boardCheckpoint: 'agent-server/board-checkpoint',
  boardBlock: 'agent-server/board-block',
  boardSubmit: 'agent-server/board-submit',
  boardAccept: 'agent-server/board-accept',
  boardRequestChanges: 'agent-server/board-request-changes',
  boardCancel: 'agent-server/board-cancel',
  inboxList: 'agent-server/inbox-list',
  messageSend: 'agent-server/message-send',
  messageAck: 'agent-server/message-ack',
  finish: 'agent-server/collaboration-finish',
} as const);

export const AGENT_SERVER_COLLABORATION_MCP_NAMES = Object.freeze({
  state: 'collaboration_state',
  boardList: 'board_list',
  boardCreate: 'board_create',
  boardAssign: 'board_assign',
  boardClaim: 'board_claim',
  boardCheckpoint: 'board_checkpoint',
  boardBlock: 'board_block',
  boardSubmit: 'board_submit',
  boardAccept: 'board_accept',
  boardRequestChanges: 'board_request_changes',
  boardCancel: 'board_cancel',
  inboxList: 'inbox_list',
  messageSend: 'message_send',
  messageAck: 'message_ack',
  finish: 'collaboration_finish',
} as const);

const READ_REFS = Object.freeze([
  AGENT_SERVER_COLLABORATION_TOOL_REFS.state,
  AGENT_SERVER_COLLABORATION_TOOL_REFS.boardList,
  AGENT_SERVER_COLLABORATION_TOOL_REFS.inboxList,
]);

export function collaborationToolRefsForRole(
  role: 'lead' | 'member',
): readonly string[] {
  const actions =
    role === 'lead'
      ? [
          AGENT_SERVER_COLLABORATION_TOOL_REFS.boardCreate,
          AGENT_SERVER_COLLABORATION_TOOL_REFS.boardAssign,
          AGENT_SERVER_COLLABORATION_TOOL_REFS.boardAccept,
          AGENT_SERVER_COLLABORATION_TOOL_REFS.boardRequestChanges,
          AGENT_SERVER_COLLABORATION_TOOL_REFS.boardCancel,
          AGENT_SERVER_COLLABORATION_TOOL_REFS.messageSend,
          AGENT_SERVER_COLLABORATION_TOOL_REFS.messageAck,
          AGENT_SERVER_COLLABORATION_TOOL_REFS.finish,
        ]
      : [
          AGENT_SERVER_COLLABORATION_TOOL_REFS.boardClaim,
          AGENT_SERVER_COLLABORATION_TOOL_REFS.boardCheckpoint,
          AGENT_SERVER_COLLABORATION_TOOL_REFS.boardBlock,
          AGENT_SERVER_COLLABORATION_TOOL_REFS.boardSubmit,
          AGENT_SERVER_COLLABORATION_TOOL_REFS.messageSend,
          AGENT_SERVER_COLLABORATION_TOOL_REFS.messageAck,
        ];
  return Object.freeze([...READ_REFS, ...actions]);
}
