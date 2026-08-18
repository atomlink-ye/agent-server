import { describe, expect, it } from 'vitest';

import { AGENT_SERVER_COLLABORATION_MCP_NAMES } from '../../domain/collaboration/canonical-collaboration-tools.js';
import { SERVER_AUTHORIZED_TEAM_MCP_CATALOG } from '../../contracts/product-projection/edges.js';
import { executionObservationPayload } from './execution-observation-payload.js';

describe('executionObservationPayload', () => {
  it('projects provider-neutral tool detail without exposing arbitrary tool names', () => {
    expect(
      executionObservationPayload({
        kind: 'tool_updated',
        activityId: 'activity-1',
        category: 'shell',
        status: 'completed',
        label: 'Shell activity',
        summary: 'Shell.',
        toolName: 'provider_private_shell',
        resultObserved: true,
        provider: 'opencode',
        detail: { kind: 'shell', command: 'pwd', output: './' },
      }),
    ).toEqual(
      expect.objectContaining({
        kind: 'tool_status',
        activity_id: 'activity-1',
        category: 'shell',
        status: 'completed',
        provider: 'opencode',
        detail_kind: 'shell',
        detail_text: './',
      }),
    );
    expect(
      executionObservationPayload({
        kind: 'tool_updated',
        activityId: 'activity-1',
        category: 'shell',
        status: 'completed',
        label: 'Shell activity',
        summary: 'Shell.',
        toolName: 'provider_private_shell',
        provider: 'opencode',
      }),
    ).not.toHaveProperty('tool_name');
  });

  it('publishes a normalized collaboration MCP identity only for a team member', () => {
    const context = {
      isTeamMember: true,
    } as const;
    const observation = {
      kind: 'tool_updated',
      activityId: 'activity-2',
      category: 'other',
      status: 'completed',
      label: 'Collaboration message',
      summary: 'Message.',
      toolName: AGENT_SERVER_COLLABORATION_MCP_NAMES.messageSend,
      resultObserved: true,
      provider: 'opencode',
    } as const;

    expect(executionObservationPayload(observation, context)).toEqual(
      expect.objectContaining({
        kind: 'tool_status',
        activity_id: 'activity-2',
        provenance: SERVER_AUTHORIZED_TEAM_MCP_CATALOG,
        tool_identity_capture_status: 'present',
        response_observed: true,
      }),
    );
    expect(
      executionObservationPayload(observation, {
        ...context,
        isTeamMember: false,
      }),
    ).not.toHaveProperty('provenance');
  });

  it('projects child activity and usage while ignoring turn lifecycle observations', () => {
    expect(
      executionObservationPayload({
        kind: 'child_activity_updated',
        parentActivityId: 'parent-1',
        activityId: 'child-1',
        itemKind: 'assistant',
        status: 'running',
        label: 'Assistant',
        summary: 'Working',
        provider: 'opencode',
        text: 'nested work',
      }),
    ).toEqual(
      expect.objectContaining({
        kind: 'child_timeline_item',
        parent_activity_id: 'parent-1',
        activity_id: 'child-1',
        detail_text: 'nested work',
      }),
    );
    expect(
      executionObservationPayload({
        kind: 'usage_updated',
        usage: { inputTokens: 2, outputTokens: 3, totalCostUsd: 0 },
      }),
    ).toEqual({
      kind: 'usage',
      input_tokens: 2,
      output_tokens: 3,
      total_cost_usd: 0,
    });
    expect(
      executionObservationPayload({ kind: 'turn_started', runId: 'run-1' }),
    ).toBeNull();
    expect(
      executionObservationPayload({
        kind: 'turn_completed',
        provider: 'opencode',
        model: 'free/model',
      }),
    ).toBeNull();
  });
});
