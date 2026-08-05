export const AGENT_SERVER_MEMORY_API_SKILL_REF = 'agent-server/memory-api';
export const AGENT_SERVER_MEMORY_API_SKILL_VERSION = '1.0.0';
export const AGENT_SERVER_MEMORY_READ_TOOL_REF = 'agent-server/memory-read';
export const AGENT_SERVER_SYNTHETIC_STOCK_SNAPSHOT_TOOL_REF =
  'agent-server/synthetic-stock-snapshot';
export const AGENT_SERVER_SYNTHETIC_EVENT_BATCH_TOOL_REF =
  'agent-server/synthetic-event-batch';
export const AGENT_SERVER_SYNTHETIC_ANALOG_SUMMARY_TOOL_REF =
  'agent-server/synthetic-analog-summary';
export const AGENT_SERVER_LEARNING_PROPOSAL_CREATE_TOOL_REF =
  'agent-server/learning-proposal-create';
export const AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS = Object.freeze({
  state: 'agent-server/team-state',
  workList: 'agent-server/team-work-list',
  workCreate: 'agent-server/team-work-create',
  requestChanges: 'agent-server/team-work-request-changes',
  accept: 'agent-server/team-work-accept-v2',
  finish: 'agent-server/team-finish',
  checkpoint: 'agent-server/team-work-checkpoint',
  submit: 'agent-server/team-work-submit',
  messageSend: 'agent-server/team-message-send',
});
export const SUPPORTED_MANAGED_AGENT_TOOL_REFS = new Set([
  AGENT_SERVER_MEMORY_READ_TOOL_REF,
  AGENT_SERVER_SYNTHETIC_STOCK_SNAPSHOT_TOOL_REF,
  AGENT_SERVER_SYNTHETIC_EVENT_BATCH_TOOL_REF,
  AGENT_SERVER_SYNTHETIC_ANALOG_SUMMARY_TOOL_REF,
  AGENT_SERVER_LEARNING_PROPOSAL_CREATE_TOOL_REF,
  ...Object.values(AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS),
]);
