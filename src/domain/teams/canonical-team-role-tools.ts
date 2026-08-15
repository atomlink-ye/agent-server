import {
  AGENT_SERVER_COLLABORATION_TOOL_REFS,
  collaborationToolRefsForRole,
} from '../collaboration/canonical-collaboration-tools.js';

export const AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS = Object.freeze({
  state: 'agent-server/team-state',
  workList: 'agent-server/team-work-list',
  workCreate: 'agent-server/team-work-create',
  requestChanges: 'agent-server/team-work-request-changes',
  cancel: 'agent-server/team-work-cancel',
  accept: 'agent-server/team-work-accept-v2',
  finish: 'agent-server/team-finish',
  checkpoint: 'agent-server/team-work-checkpoint',
  submit: 'agent-server/team-work-submit',
  messageSend: 'agent-server/team-message-send',
  // During cutover this object is also the coordination-catalog classifier
  // used by AgentRunExecutor. Named entries avoid overwriting the legacy keys.
  collaborationState: AGENT_SERVER_COLLABORATION_TOOL_REFS.state,
  collaborationBoardList: AGENT_SERVER_COLLABORATION_TOOL_REFS.boardList,
  collaborationBoardCreate: AGENT_SERVER_COLLABORATION_TOOL_REFS.boardCreate,
  collaborationBoardAssign: AGENT_SERVER_COLLABORATION_TOOL_REFS.boardAssign,
  collaborationBoardClaim: AGENT_SERVER_COLLABORATION_TOOL_REFS.boardClaim,
  collaborationBoardCheckpoint:
    AGENT_SERVER_COLLABORATION_TOOL_REFS.boardCheckpoint,
  collaborationBoardBlock: AGENT_SERVER_COLLABORATION_TOOL_REFS.boardBlock,
  collaborationBoardSubmit: AGENT_SERVER_COLLABORATION_TOOL_REFS.boardSubmit,
  collaborationBoardAccept: AGENT_SERVER_COLLABORATION_TOOL_REFS.boardAccept,
  collaborationBoardRequestChanges:
    AGENT_SERVER_COLLABORATION_TOOL_REFS.boardRequestChanges,
  collaborationBoardCancel: AGENT_SERVER_COLLABORATION_TOOL_REFS.boardCancel,
  collaborationInboxList: AGENT_SERVER_COLLABORATION_TOOL_REFS.inboxList,
  collaborationMessageSend: AGENT_SERVER_COLLABORATION_TOOL_REFS.messageSend,
  collaborationMessageAck: AGENT_SERVER_COLLABORATION_TOOL_REFS.messageAck,
  collaborationFinish: AGENT_SERVER_COLLABORATION_TOOL_REFS.finish,
});

const canonicalTeamSafeReadToolRefs = Object.freeze([
  AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.state,
  AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.workList,
]);

/**
 * Legacy Team refs remain in the catalog during the cutover so old fixtures do
 * not fork the behavior. New prompts use the collaboration refs.
 */
export function canonicalTeamToolRefsForRole(
  role: 'lead' | 'member',
): readonly string[] {
  const legacyActions =
    role === 'lead'
      ? [
          AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.messageSend,
          AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.workCreate,
          AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.requestChanges,
          AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.cancel,
          AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.accept,
          AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.finish,
        ]
      : [
          AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.checkpoint,
          AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.submit,
        ];
  return Object.freeze([
    ...canonicalTeamSafeReadToolRefs,
    ...legacyActions,
    ...collaborationToolRefsForRole(role),
  ]);
}

export function canonicalTeamToolRefsForDirectMessage(): readonly string[] {
  return Object.freeze([
    ...canonicalTeamSafeReadToolRefs,
    AGENT_SERVER_COLLABORATION_TOOL_REFS.state,
    AGENT_SERVER_COLLABORATION_TOOL_REFS.boardList,
    AGENT_SERVER_COLLABORATION_TOOL_REFS.inboxList,
    AGENT_SERVER_COLLABORATION_TOOL_REFS.boardClaim,
    AGENT_SERVER_COLLABORATION_TOOL_REFS.messageSend,
    AGENT_SERVER_COLLABORATION_TOOL_REFS.messageAck,
  ]);
}
