import type {
  ExecutionObservation,
  ExecutionToolDetail,
} from '../ports/execution-plane.js';
import { AGENT_SERVER_EXECUTION_MCP_SERVER_NAME } from '../ports/execution-plane.js';
import type { RunEventPayload } from '../ports/run-events.js';
import {
  canonicalTeamMcpName,
  canonicalTeamMcpRefForName,
} from '../agents/built-in-skills.js';

export interface ExecutionObservationProjectionContext {
  readonly isTeamMember: boolean;
  readonly runtimeToolRefs: readonly string[];
  readonly catalogTools: readonly string[];
}

/** UI/evidence projection belongs to Application, not the Execution Plane. */
export function executionObservationPayload(
  observation: ExecutionObservation,
  context?: ExecutionObservationProjectionContext,
): RunEventPayload | null {
  switch (observation.kind) {
    case 'turn_started':
    case 'turn_completed':
    case 'turn_failed':
      return null;
    case 'assistant_updated':
      return { kind: 'assistant_text', text: observation.text };
    case 'reasoning_updated':
      return {
        kind: 'reasoning_progress',
        status: observation.status,
        ...(observation.text ? { text: observation.text } : {}),
      };
    case 'tool_updated': {
      const canonicalTeamToolName = canonicalTeamMcpName(observation.toolName);
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
          kind: 'tool_status',
          activity_id: observation.activityId,
          category: observation.category,
          status: observation.status,
          tool_name: canonicalTeamToolName,
          provenance: 'server_authorized_team_mcp_catalog',
          tool_identity_capture_status: 'present',
          response_observed: observation.resultObserved === true,
        };
      }
      return {
        kind: 'tool_status',
        activity_id: observation.activityId,
        category: observation.category,
        status: observation.status,
        label: observation.label,
        summary: observation.summary,
        ...safeRuntimeToolNamePayload(observation.toolName),
        provider: observation.provider,
        ...(observation.detail ? { detail: observation.detail } : {}),
        ...flatDetailProjection(observation.detail),
        ...(observation.parentActivityId
          ? { parent_activity_id: observation.parentActivityId }
          : {}),
      };
    }
    case 'child_activity_updated':
      return {
        kind: 'child_timeline_item',
        activity_id: observation.activityId,
        parent_activity_id: observation.parentActivityId,
        item_kind: observation.itemKind,
        status: observation.status,
        label: observation.label,
        summary: observation.summary,
        provider: observation.provider,
        ...(observation.itemKind === 'tool' && observation.detail
          ? { detail: observation.detail }
          : {}),
        ...(observation.itemKind === 'tool'
          ? flatDetailProjection(observation.detail)
          : observation.text
            ? { detail_text: observation.text }
            : {}),
      };
    case 'permission_updated':
      return {
        kind: 'permission',
        activity_id: observation.activityId,
        category: observation.category,
        status: observation.status,
        ...(observation.decision ? { decision: observation.decision } : {}),
        summary: observation.summary,
      };
    case 'usage_updated': {
      const usage = observation.usage;
      const payload: Record<string, string | number | boolean | null> = {
        kind: 'usage',
      };
      if (usage.inputTokens !== undefined) payload.input_tokens = usage.inputTokens;
      if (usage.cachedInputTokens !== undefined)
        payload.cached_input_tokens = usage.cachedInputTokens;
      if (usage.outputTokens !== undefined)
        payload.output_tokens = usage.outputTokens;
      if (usage.totalCostUsd !== undefined)
        payload.total_cost_usd = usage.totalCostUsd;
      if (usage.contextWindowMaxTokens !== undefined)
        payload.context_window_max_tokens = usage.contextWindowMaxTokens;
      if (usage.contextWindowUsedTokens !== undefined)
        payload.context_window_used_tokens = usage.contextWindowUsedTokens;
      return payload;
    }
    default:
      return assertNever(observation);
  }
}

function flatDetailProjection(
  detail: ExecutionToolDetail | undefined,
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
const runtimeMcpToolPrefix = `${AGENT_SERVER_EXECUTION_MCP_SERVER_NAME}_`;

function safeRuntimeToolNamePayload(toolName: string | undefined) {
  if (!toolName) return {};
  const normalized = toolName.startsWith(runtimeMcpToolPrefix)
    ? toolName.slice(runtimeMcpToolPrefix.length)
    : toolName;
  return safeRuntimeToolNames.has(normalized) ? { tool_name: normalized } : {};
}

function assertNever(observation: never): null {
  throw new Error(
    `Unhandled execution observation kind: ${String(observation)}`,
  );
}
