import type { CollaborationCapability } from './collaboration.js';
import {
  collaborationCapabilitiesForRole,
  type CollaborationRole,
} from './collaboration-policy-definition.js';

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

const COLLABORATION_MCP_REF_BY_NAME = Object.freeze({
  [AGENT_SERVER_COLLABORATION_MCP_NAMES.state]:
    AGENT_SERVER_COLLABORATION_TOOL_REFS.state,
  [AGENT_SERVER_COLLABORATION_MCP_NAMES.boardList]:
    AGENT_SERVER_COLLABORATION_TOOL_REFS.boardList,
  [AGENT_SERVER_COLLABORATION_MCP_NAMES.boardCreate]:
    AGENT_SERVER_COLLABORATION_TOOL_REFS.boardCreate,
  [AGENT_SERVER_COLLABORATION_MCP_NAMES.boardAssign]:
    AGENT_SERVER_COLLABORATION_TOOL_REFS.boardAssign,
  [AGENT_SERVER_COLLABORATION_MCP_NAMES.boardClaim]:
    AGENT_SERVER_COLLABORATION_TOOL_REFS.boardClaim,
  [AGENT_SERVER_COLLABORATION_MCP_NAMES.boardCheckpoint]:
    AGENT_SERVER_COLLABORATION_TOOL_REFS.boardCheckpoint,
  [AGENT_SERVER_COLLABORATION_MCP_NAMES.boardBlock]:
    AGENT_SERVER_COLLABORATION_TOOL_REFS.boardBlock,
  [AGENT_SERVER_COLLABORATION_MCP_NAMES.boardSubmit]:
    AGENT_SERVER_COLLABORATION_TOOL_REFS.boardSubmit,
  [AGENT_SERVER_COLLABORATION_MCP_NAMES.boardAccept]:
    AGENT_SERVER_COLLABORATION_TOOL_REFS.boardAccept,
  [AGENT_SERVER_COLLABORATION_MCP_NAMES.boardRequestChanges]:
    AGENT_SERVER_COLLABORATION_TOOL_REFS.boardRequestChanges,
  [AGENT_SERVER_COLLABORATION_MCP_NAMES.boardCancel]:
    AGENT_SERVER_COLLABORATION_TOOL_REFS.boardCancel,
  [AGENT_SERVER_COLLABORATION_MCP_NAMES.inboxList]:
    AGENT_SERVER_COLLABORATION_TOOL_REFS.inboxList,
  [AGENT_SERVER_COLLABORATION_MCP_NAMES.messageSend]:
    AGENT_SERVER_COLLABORATION_TOOL_REFS.messageSend,
  [AGENT_SERVER_COLLABORATION_MCP_NAMES.messageAck]:
    AGENT_SERVER_COLLABORATION_TOOL_REFS.messageAck,
  [AGENT_SERVER_COLLABORATION_MCP_NAMES.finish]:
    AGENT_SERVER_COLLABORATION_TOOL_REFS.finish,
} as const);
const COLLABORATION_MCP_NAME_SET: ReadonlySet<string> = new Set(
  Object.values(AGENT_SERVER_COLLABORATION_MCP_NAMES),
);
const RUNTIME_MCP_PREFIX = 'agent-server_';

export function collaborationMcpName(
  value: string | null | undefined,
): string | null {
  if (typeof value !== 'string') return null;
  if (COLLABORATION_MCP_NAME_SET.has(value)) return value;
  if (!value.startsWith(RUNTIME_MCP_PREFIX)) return null;
  const publicName = value.slice(RUNTIME_MCP_PREFIX.length);
  return COLLABORATION_MCP_NAME_SET.has(publicName) ? publicName : null;
}

export function collaborationMcpRefForName(name: string): string | null {
  return (
    COLLABORATION_MCP_REF_BY_NAME[
      name as keyof typeof COLLABORATION_MCP_REF_BY_NAME
    ] ?? null
  );
}

export const COLLABORATION_TOOL_REF_BY_CAPABILITY: Readonly<
  Record<CollaborationCapability, readonly string[]>
> = Object.freeze({
  'board.read': Object.freeze([
    AGENT_SERVER_COLLABORATION_TOOL_REFS.state,
    AGENT_SERVER_COLLABORATION_TOOL_REFS.boardList,
  ]),
  'board.create': Object.freeze([
    AGENT_SERVER_COLLABORATION_TOOL_REFS.boardCreate,
  ]),
  'board.assign': Object.freeze([
    AGENT_SERVER_COLLABORATION_TOOL_REFS.boardAssign,
  ]),
  'board.claim': Object.freeze([
    AGENT_SERVER_COLLABORATION_TOOL_REFS.boardClaim,
  ]),
  'board.checkpoint': Object.freeze([
    AGENT_SERVER_COLLABORATION_TOOL_REFS.boardCheckpoint,
  ]),
  'board.block': Object.freeze([
    AGENT_SERVER_COLLABORATION_TOOL_REFS.boardBlock,
  ]),
  'board.submit': Object.freeze([
    AGENT_SERVER_COLLABORATION_TOOL_REFS.boardSubmit,
  ]),
  'board.review': Object.freeze([
    AGENT_SERVER_COLLABORATION_TOOL_REFS.boardAccept,
    AGENT_SERVER_COLLABORATION_TOOL_REFS.boardRequestChanges,
  ]),
  'board.cancel': Object.freeze([
    AGENT_SERVER_COLLABORATION_TOOL_REFS.boardCancel,
  ]),
  'mailbox.read': Object.freeze([
    AGENT_SERVER_COLLABORATION_TOOL_REFS.inboxList,
  ]),
  'mailbox.send': Object.freeze([
    AGENT_SERVER_COLLABORATION_TOOL_REFS.messageSend,
  ]),
  'mailbox.ack': Object.freeze([
    AGENT_SERVER_COLLABORATION_TOOL_REFS.messageAck,
  ]),
  'run.finalize': Object.freeze([
    AGENT_SERVER_COLLABORATION_TOOL_REFS.finish,
  ]),
});

export function collaborationToolRefsForCapabilities(
  capabilities: readonly CollaborationCapability[],
): readonly string[] {
  return Object.freeze([
    ...new Set(
      capabilities.flatMap(
        (capability) => COLLABORATION_TOOL_REF_BY_CAPABILITY[capability],
      ),
    ),
  ]);
}

export function collaborationToolRefsForRole(
  role: CollaborationRole,
): readonly string[] {
  return collaborationToolRefsForCapabilities(
    collaborationCapabilitiesForRole(role),
  );
}

export function collaborationToolRefsForMessageTurn(): readonly string[] {
  return collaborationToolRefsForCapabilities([
    'board.read',
    'board.claim',
    'mailbox.read',
    'mailbox.send',
    'mailbox.ack',
  ]);
}
