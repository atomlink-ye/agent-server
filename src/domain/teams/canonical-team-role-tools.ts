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

export function canonicalTeamToolRefsForRole(
  role: 'lead' | 'member',
): readonly string[] {
  const actions =
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
  return Object.freeze([...canonicalTeamSafeReadToolRefs, ...actions]);
}

export function canonicalTeamToolRefsForDirectMessage(): readonly string[] {
  return canonicalTeamSafeReadToolRefs;
}
