import { AGENT_SERVER_COLLABORATION_TOOL_REFS } from '../../domain/collaboration/canonical-collaboration-tools.js';
import { AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS } from '../../domain/teams/canonical-team-role-tools.js';

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
export const AGENT_SERVER_PRODUCT_WORK_CREATE_TOOL_REF =
  'agent-server/product-work-create';
export const AGENT_SERVER_PRODUCT_WORK_RUN_START_TOOL_REF =
  'agent-server/product-work-run-start';

/** Legacy Team names retained only as compatibility aliases during cutover. */
export const AGENT_SERVER_CANONICAL_TEAM_MCP_NAMES = Object.freeze({
  state: 'team_state',
  workList: 'team_work_list',
  workCreate: 'team_work_create',
  requestChanges: 'team_work_request_changes',
  cancel: 'team_work_cancel',
  accept: 'team_work_accept',
  finish: 'team_finish',
  checkpoint: 'team_work_checkpoint',
  submit: 'team_work_submit',
  messageSend: 'team_message_send',
} as const);
export const AGENT_SERVER_CANONICAL_TEAM_MCP_NAME_SET: ReadonlySet<string> =
  new Set(Object.values(AGENT_SERVER_CANONICAL_TEAM_MCP_NAMES));
const AGENT_SERVER_CANONICAL_TEAM_MCP_REF_BY_NAME = Object.freeze({
  [AGENT_SERVER_CANONICAL_TEAM_MCP_NAMES.state]:
    AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.state,
  [AGENT_SERVER_CANONICAL_TEAM_MCP_NAMES.workList]:
    AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.workList,
  [AGENT_SERVER_CANONICAL_TEAM_MCP_NAMES.workCreate]:
    AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.workCreate,
  [AGENT_SERVER_CANONICAL_TEAM_MCP_NAMES.requestChanges]:
    AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.requestChanges,
  [AGENT_SERVER_CANONICAL_TEAM_MCP_NAMES.cancel]:
    AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.cancel,
  [AGENT_SERVER_CANONICAL_TEAM_MCP_NAMES.accept]:
    AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.accept,
  [AGENT_SERVER_CANONICAL_TEAM_MCP_NAMES.finish]:
    AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.finish,
  [AGENT_SERVER_CANONICAL_TEAM_MCP_NAMES.checkpoint]:
    AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.checkpoint,
  [AGENT_SERVER_CANONICAL_TEAM_MCP_NAMES.submit]:
    AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.submit,
  [AGENT_SERVER_CANONICAL_TEAM_MCP_NAMES.messageSend]:
    AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.messageSend,
} as const);
const AGENT_SERVER_CANONICAL_TEAM_MCP_RUNTIME_PREFIX = 'agent-server_';
export function canonicalTeamMcpName(
  value: string | null | undefined,
): string | null {
  if (typeof value !== 'string') return null;
  if (AGENT_SERVER_CANONICAL_TEAM_MCP_NAME_SET.has(value)) return value;
  if (!value.startsWith(AGENT_SERVER_CANONICAL_TEAM_MCP_RUNTIME_PREFIX))
    return null;
  const publicName = value.slice(
    AGENT_SERVER_CANONICAL_TEAM_MCP_RUNTIME_PREFIX.length,
  );
  return AGENT_SERVER_CANONICAL_TEAM_MCP_NAME_SET.has(publicName)
    ? publicName
    : null;
}
export function canonicalTeamMcpRefForName(name: string): string | null {
  return (
    AGENT_SERVER_CANONICAL_TEAM_MCP_REF_BY_NAME[
      name as keyof typeof AGENT_SERVER_CANONICAL_TEAM_MCP_REF_BY_NAME
    ] ?? null
  );
}

export const SUPPORTED_MANAGED_AGENT_TOOL_REFS = new Set([
  AGENT_SERVER_MEMORY_READ_TOOL_REF,
  AGENT_SERVER_SYNTHETIC_STOCK_SNAPSHOT_TOOL_REF,
  AGENT_SERVER_SYNTHETIC_EVENT_BATCH_TOOL_REF,
  AGENT_SERVER_SYNTHETIC_ANALOG_SUMMARY_TOOL_REF,
  AGENT_SERVER_LEARNING_PROPOSAL_CREATE_TOOL_REF,
  AGENT_SERVER_PRODUCT_WORK_CREATE_TOOL_REF,
  AGENT_SERVER_PRODUCT_WORK_RUN_START_TOOL_REF,
  ...Object.values(AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS),
  ...Object.values(AGENT_SERVER_COLLABORATION_TOOL_REFS),
]);

export { AGENT_SERVER_COLLABORATION_TOOL_REFS } from '../../domain/collaboration/canonical-collaboration-tools.js';
export { AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS } from '../../domain/teams/canonical-team-role-tools.js';
