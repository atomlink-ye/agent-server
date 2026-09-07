import {
  AGENT_SERVER_DESCRIBE_WORKFLOW_TOOL_REF,
  AGENT_SERVER_LEARNING_PROPOSAL_CREATE_TOOL_REF,
  AGENT_SERVER_LIST_AGENT_WORKFLOWS_TOOL_REF,
  AGENT_SERVER_MEMORY_READ_TOOL_REF,
  AGENT_SERVER_PRODUCT_WORK_CREATE_TOOL_REF,
  AGENT_SERVER_PRODUCT_WORK_RUN_START_TOOL_REF,
  AGENT_SERVER_SYNTHETIC_ANALOG_SUMMARY_TOOL_REF,
  AGENT_SERVER_SYNTHETIC_EVENT_BATCH_TOOL_REF,
  AGENT_SERVER_SYNTHETIC_STOCK_SNAPSHOT_TOOL_REF,
  AGENT_SERVER_WHISPER_OPEN_TOOL_REF,
  AGENT_SERVER_WHISPER_SEND_TOOL_REF,
  AGENT_SERVER_WORKSPACE_LIST_TOOL_REF,
  AGENT_SERVER_WORKSPACE_READ_TOOL_REF,
  AGENT_SERVER_WORKSPACE_WRITE_TOOL_REF,
  AGENT_SERVER_WORK_ITEM_CLAIM_TOOL_REF,
  AGENT_SERVER_WORK_ITEM_COMMENT_TOOL_REF,
  AGENT_SERVER_WORK_ITEM_STATUS_TOOL_REF,
} from './built-in-skills.js';
import { AGENT_SERVER_COLLABORATION_MCP_NAMES } from '../../domain/collaboration/canonical-collaboration-tools.js';
import { AGENT_SERVER_COLLABORATION_TOOL_REFS } from '../../domain/collaboration/canonical-collaboration-tools.js';

/**
 * A granted Tool ref is not what a model can see. The provider reaches the
 * Runtime MCP endpoint and reads MCP tool *names* from it, and Codex 0.153
 * keeps MCP tools out of the directly-visible tool list unless the model looks
 * them up. An Agent that is never told the names therefore answers "I do not
 * have that tool" while holding a valid grant for it.
 *
 * This map is the single place that translates a granted ref into the name the
 * model will actually see, so prompt-level exposure cannot drift from the MCP
 * registration in `src/entrypoints/mcp`.
 */
const RUNTIME_TOOL_MCP_NAMES: Readonly<Record<string, string>> = Object.freeze({
  [AGENT_SERVER_MEMORY_READ_TOOL_REF]: 'agent_server_memory_read',
  [AGENT_SERVER_LEARNING_PROPOSAL_CREATE_TOOL_REF]: 'learning_proposal_create',
  [AGENT_SERVER_SYNTHETIC_STOCK_SNAPSHOT_TOOL_REF]: 'synthetic_stock_snapshot',
  [AGENT_SERVER_SYNTHETIC_EVENT_BATCH_TOOL_REF]: 'synthetic_event_batch',
  [AGENT_SERVER_SYNTHETIC_ANALOG_SUMMARY_TOOL_REF]: 'synthetic_analog_summary',
  [AGENT_SERVER_PRODUCT_WORK_CREATE_TOOL_REF]: 'product_work_create',
  [AGENT_SERVER_PRODUCT_WORK_RUN_START_TOOL_REF]: 'product_work_run_start',
  [AGENT_SERVER_LIST_AGENT_WORKFLOWS_TOOL_REF]: 'list_agent_workflows',
  [AGENT_SERVER_DESCRIBE_WORKFLOW_TOOL_REF]: 'describe_workflow',
  [AGENT_SERVER_WORK_ITEM_CLAIM_TOOL_REF]: 'work_item_claim',
  [AGENT_SERVER_WORK_ITEM_COMMENT_TOOL_REF]: 'work_item_comment',
  [AGENT_SERVER_WORK_ITEM_STATUS_TOOL_REF]: 'work_item_status',
  [AGENT_SERVER_WORKSPACE_LIST_TOOL_REF]: 'workspace_list',
  [AGENT_SERVER_WORKSPACE_READ_TOOL_REF]: 'workspace_read',
  [AGENT_SERVER_WORKSPACE_WRITE_TOOL_REF]: 'workspace_write',
  [AGENT_SERVER_WHISPER_OPEN_TOOL_REF]: 'whisper_open',
  [AGENT_SERVER_WHISPER_SEND_TOOL_REF]: 'whisper_send',
  [AGENT_SERVER_COLLABORATION_TOOL_REFS.state]:
    AGENT_SERVER_COLLABORATION_MCP_NAMES.state,
  [AGENT_SERVER_COLLABORATION_TOOL_REFS.boardList]:
    AGENT_SERVER_COLLABORATION_MCP_NAMES.boardList,
  [AGENT_SERVER_COLLABORATION_TOOL_REFS.boardCreate]:
    AGENT_SERVER_COLLABORATION_MCP_NAMES.boardCreate,
  [AGENT_SERVER_COLLABORATION_TOOL_REFS.boardAssign]:
    AGENT_SERVER_COLLABORATION_MCP_NAMES.boardAssign,
  [AGENT_SERVER_COLLABORATION_TOOL_REFS.boardClaim]:
    AGENT_SERVER_COLLABORATION_MCP_NAMES.boardClaim,
  [AGENT_SERVER_COLLABORATION_TOOL_REFS.boardCheckpoint]:
    AGENT_SERVER_COLLABORATION_MCP_NAMES.boardCheckpoint,
  [AGENT_SERVER_COLLABORATION_TOOL_REFS.boardBlock]:
    AGENT_SERVER_COLLABORATION_MCP_NAMES.boardBlock,
  [AGENT_SERVER_COLLABORATION_TOOL_REFS.boardSubmit]:
    AGENT_SERVER_COLLABORATION_MCP_NAMES.boardSubmit,
  [AGENT_SERVER_COLLABORATION_TOOL_REFS.boardAccept]:
    AGENT_SERVER_COLLABORATION_MCP_NAMES.boardAccept,
  [AGENT_SERVER_COLLABORATION_TOOL_REFS.boardRequestChanges]:
    AGENT_SERVER_COLLABORATION_MCP_NAMES.boardRequestChanges,
  [AGENT_SERVER_COLLABORATION_TOOL_REFS.boardCancel]:
    AGENT_SERVER_COLLABORATION_MCP_NAMES.boardCancel,
  [AGENT_SERVER_COLLABORATION_TOOL_REFS.inboxList]:
    AGENT_SERVER_COLLABORATION_MCP_NAMES.inboxList,
  [AGENT_SERVER_COLLABORATION_TOOL_REFS.messageSend]:
    AGENT_SERVER_COLLABORATION_MCP_NAMES.messageSend,
  [AGENT_SERVER_COLLABORATION_TOOL_REFS.messageAck]:
    AGENT_SERVER_COLLABORATION_MCP_NAMES.messageAck,
  [AGENT_SERVER_COLLABORATION_TOOL_REFS.finish]:
    AGENT_SERVER_COLLABORATION_MCP_NAMES.finish,
});

export { RUNTIME_TOOL_MCP_NAMES as AGENT_SERVER_RUNTIME_TOOL_MCP_NAMES };

/** The MCP tool name a granted ref appears as, or null for an unmapped ref. */
export function runtimeToolMcpName(toolRef: string): string | null {
  return RUNTIME_TOOL_MCP_NAMES[toolRef] ?? null;
}

/**
 * The MCP tool names for a grant, deduplicated and ordered so the rendered
 * prompt stays byte-stable for one Agent version. Unmapped refs are dropped
 * rather than guessed: naming a tool the provider does not serve would teach
 * the Agent to call something that cannot exist.
 */
export function runtimeToolMcpNames(
  toolRefs: readonly string[],
): readonly string[] {
  const names = new Set<string>();
  for (const toolRef of toolRefs) {
    const name = runtimeToolMcpName(toolRef);
    if (name) names.add(name);
  }
  return Object.freeze([...names].toSorted());
}

/**
 * The prompt section that makes a grant reachable. Codex 0.153 keeps MCP tools
 * out of the directly-visible tool list, so an Agent that reads only that list
 * concludes it holds none of its platform tools and answers from memory or
 * writes a stray local file instead of calling the Runtime. Both the Chat turn
 * and the Work run render this from their own granted refs. A grant with no
 * Runtime tools renders nothing rather than an empty heading, so a tool-less
 * Agent's prompt -- and its desired-state digest -- stays as it was.
 */
export function renderGrantedPlatformToolsPrompt(
  toolRefs: readonly string[],
  mcpServerName: string,
): string | null {
  const names = runtimeToolMcpNames(toolRefs);
  if (names.length === 0) return null;
  return [
    'GRANTED PLATFORM TOOLS:',
    `These tools are granted to you and are served by the MCP server named "${mcpServerName}":`,
    names.map((name) => `- ${name}`).join('\n'),
    'They may not appear in your default tool list. Look them up in your tool registry before answering, and never tell the user a tool listed here is unavailable to you without having tried it.',
  ].join('\n');
}
