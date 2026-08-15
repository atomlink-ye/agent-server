import { describe, expect, it } from 'vitest';

import { AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS } from '../../domain/teams/canonical-team-role-tools.js';
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

  it('publishes canonical Team MCP identity only when the server-authorized catalog proves it', () => {
    const context = {
      isTeamMember: true,
      runtimeToolRefs: [AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.messageSend],
      catalogTools: [AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.messageSend],
    } as const;
    const observation = {
      kind: 'tool_updated',
      activityId: 'activity-2',
      category: 'other',
      status: 'completed',
      label: 'Team message',
      summary: 'Message.',
      toolName: 'agent-server_agent_team_message_send',
      resultObserved: true,
      provider: 'opencode',
    } as const;

    expect(executionObservationPayload(observation, context)).toEqual(
      expect.objectContaining({
        kind: 'tool_status',
        activity_id: 'activity-2',
        provenance: 'server_authorized_team_mcp_catalog',
        tool_identity_capture_status: 'present',
        response_observed: true,
      }),
    );
    expect(
      executionObservationPayload(observation, {
        ...context,
        runtimeToolRefs: [],
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
