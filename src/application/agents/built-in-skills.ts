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
export const AGENT_SERVER_TEAM_TOOL_REFS = Object.freeze([
  'agent-server/team-members-list',
  'agent-server/team-task-create',
  'agent-server/team-task-list',
  'agent-server/team-task-claim',
  'agent-server/team-task-update',
  'agent-server/team-complete',
]);
export const SUPPORTED_MANAGED_AGENT_TOOL_REFS = new Set([
  AGENT_SERVER_MEMORY_READ_TOOL_REF,
  AGENT_SERVER_SYNTHETIC_STOCK_SNAPSHOT_TOOL_REF,
  AGENT_SERVER_SYNTHETIC_EVENT_BATCH_TOOL_REF,
  AGENT_SERVER_SYNTHETIC_ANALOG_SUMMARY_TOOL_REF,
  AGENT_SERVER_LEARNING_PROPOSAL_CREATE_TOOL_REF,
  ...AGENT_SERVER_TEAM_TOOL_REFS,
]);
