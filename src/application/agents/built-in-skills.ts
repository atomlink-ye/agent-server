import { AGENT_SERVER_COLLABORATION_TOOL_REFS } from '../../domain/collaboration/canonical-collaboration-tools.js';

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
export const AGENT_SERVER_LIST_AGENT_WORKFLOWS_TOOL_REF =
  'agent-server/list-agent-workflows';
export const AGENT_SERVER_DESCRIBE_WORKFLOW_TOOL_REF =
  'agent-server/describe-workflow';

/**
 * User/ManagedAgent-declared tool refs.
 *
 * Agent Team collaboration is a platform capability and is intentionally not
 * part of this set. Team participants receive the Collaboration MCP
 * automatically from Agent Server runtime composition.
 */
export const SUPPORTED_MANAGED_AGENT_TOOL_REFS = new Set([
  AGENT_SERVER_MEMORY_READ_TOOL_REF,
  AGENT_SERVER_SYNTHETIC_STOCK_SNAPSHOT_TOOL_REF,
  AGENT_SERVER_SYNTHETIC_EVENT_BATCH_TOOL_REF,
  AGENT_SERVER_SYNTHETIC_ANALOG_SUMMARY_TOOL_REF,
  AGENT_SERVER_LEARNING_PROPOSAL_CREATE_TOOL_REF,
  AGENT_SERVER_PRODUCT_WORK_CREATE_TOOL_REF,
  AGENT_SERVER_PRODUCT_WORK_RUN_START_TOOL_REF,
  AGENT_SERVER_LIST_AGENT_WORKFLOWS_TOOL_REF,
  AGENT_SERVER_DESCRIBE_WORKFLOW_TOOL_REF,
]);

/** Internal platform catalog; never require users to list these in spec.tools. */
export const AGENT_SERVER_PLATFORM_COLLABORATION_TOOL_REFS = Object.freeze([
  ...Object.values(AGENT_SERVER_COLLABORATION_TOOL_REFS),
]);

export { AGENT_SERVER_COLLABORATION_TOOL_REFS } from '../../domain/collaboration/canonical-collaboration-tools.js';
