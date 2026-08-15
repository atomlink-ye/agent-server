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
});

const canonicalTeamSafeReadToolRefs = Object.freeze([
  AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.state,
  AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.workList,
]);

/**
 * Legacy Team refs remain in the catalog during the cutover so old fixtures do
 * not fork the behavior. New prompts use the collaboration refs, both surfaces
 * resolve to the same durable collaboration facts.
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
