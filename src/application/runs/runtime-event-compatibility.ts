import { AGENT_SERVER_RUNTIME_MCP_SERVER_NAME } from '../ports/agent-runtime.js';
import type {
  RuntimeEvent,
  RuntimeToolDetail,
} from '../ports/agent-runtime.js';
import type { RunEventPayload } from '../ports/run-events.js';
import {
  canonicalTeamMcpName,
  canonicalTeamMcpRefForName,
} from '../agents/built-in-skills.js';

/**
 * Deprecated test/compatibility projector for the pre-ExecutionObservation
 * RuntimeEvent shape. Production ExecuteRun uses executionObservationPayload.
 */
export function runtimeEventPayload(
  event: RuntimeEvent,
  context?: {
    readonly isTeamMember: boolean;
    readonly runtimeToolRefs: readonly string[];
    readonly catalogTools: readonly string[];
  },
): RunEventPayload {
  switch (event.kind) {
    case 'assistant_text':
      return { kind: event.kind, text: event.text };
    case 'reasoning_progress':
      return {
        kind: event.kind,
        status: event.status,
        ...(event.text ? { text: event.text } : {}),
      };
    case 'tool_status': {
      const canonicalTeamToolName = canonicalTeamMcpName(event.toolName);
      const canonicalTeamToolRef = canonicalTeamToolName
        ? canonicalTeamMcpRefForName(canonicalTeamToolName)
        : null;
      const authorizedTeamTool =
        Boolean(context?.isTeamMember) &&
        canonicalTeamToolRef !== null &&
        context?.runtimeToolRefs.includes(canonicalTeamToolRef) === true &&
        context?.catalogTools.includes(canonicalTeamToolRef) === true;
      if (canonicalTeamToolName && authorizedTeamTool) {
        return {
          kind: event.kind,
          activity_id: event.activityId,
          category: event.category,
          status: event.status,
          tool_name: canonicalTeamToolName,
          provenance: 'server_authorized_team_mcp_catalog',
          tool_identity_capture_status: 'present',
          response_observed: event.resultObserved === true,
        };
      }
      return {
        kind: event.kind,
        activity_id: event.activityId,
        category: event.category,
        status: event.status,
        label: event.label,
        summary: event.summary,
        ...safeRuntimeToolNamePayload(event.toolName),
        ...(event.provider ? { provider: event.provider } : {}),
        ...(event.detail ? { detail: event.detail } : {}),
        ...flatDetailProjection(event.detail),
        ...(event.parentActivityId
          ? { parent_activity_id: event.parentActivityId }
          : {}),
      };
    }
    case 'child_timeline_item':
      return {
        kind: event.kind,
        activity_id: event.activityId,
        parent_activity_id: event.parentActivityId,
        item_kind: event.itemKind,
        status: event.status,
        label: event.label,
        summary: event.summary,
        ...(event.provider ? { provider: event.provider } : {}),
        ...(event.itemKind === 'tool' && event.detail
          ? { detail: event.detail }
          : {}),
        ...(event.itemKind === 'tool'
          ? flatDetailProjection(event.detail)
          : event.text
            ? { detail_text: event.text }
            : {}),
      };
    case 'permission':
      return {
        kind: event.kind,
        activity_id: event.activityId,
        category: event.category,
        status: event.status,
        ...(event.decision ? { decision: event.decision } : {}),
        summary: event.summary,
      };
    case 'usage': {
      const payload: Record<string, string | number | boolean | null> = {
        kind: event.kind,
      };
      if (event.inputTokens !== undefined)
        payload.input_tokens = event.inputTokens;
      if (event.cachedInputTokens !== undefined)
        payload.cached_input_tokens = event.cachedInputTokens;
      if (event.outputTokens !== undefined)
        payload.output_tokens = event.outputTokens;
      if (event.totalCostUsd !== undefined)
        payload.total_cost_usd = event.totalCostUsd;
      if (event.contextWindowMaxTokens !== undefined)
        payload.context_window_max_tokens = event.contextWindowMaxTokens;
      if (event.contextWindowUsedTokens !== undefined)
        payload.context_window_used_tokens = event.contextWindowUsedTokens;
      return payload;
    }
    default:
      return assertNeverRuntimeEvent(event);
  }
}

function flatDetailProjection(
  detail: RuntimeToolDetail | undefined,
): RunEventPayload {
  if (!detail) return {};
  let text: string | undefined;
  for (const key of [
    'text',
    'output',
    'result',
    'content',
    'unifiedDiff',
    'log',
    'error',
  ]) {
    const candidate = (detail as unknown as Record<string, unknown>)[key];
    if (typeof candidate === 'string') {
      text = candidate;
      break;
    }
  }
  return {
    detail_kind: detail.kind,
    ...(text ? { detail_text: text } : {}),
    ...('exitCode' in detail && detail.exitCode !== undefined
      ? { exit_code: detail.exitCode }
      : {}),
  };
}

const safeRuntimeToolNames = new Set([
  'synthetic_stock_snapshot',
  'synthetic_event_batch',
  'synthetic_analog_summary',
  'learning_proposal_create',
  'agent_server_memory_read',
]);
const runtimeMcpToolPrefix = `${AGENT_SERVER_RUNTIME_MCP_SERVER_NAME}_`;

function safeRuntimeToolNamePayload(toolName: string | undefined) {
  if (!toolName) return {};
  const normalized = toolName.startsWith(runtimeMcpToolPrefix)
    ? toolName.slice(runtimeMcpToolPrefix.length)
    : toolName;
  return safeRuntimeToolNames.has(normalized) ? { tool_name: normalized } : {};
}

function assertNeverRuntimeEvent(event: never): RunEventPayload {
  throw new Error(`Unhandled runtime event kind: ${String(event)}`);
}
