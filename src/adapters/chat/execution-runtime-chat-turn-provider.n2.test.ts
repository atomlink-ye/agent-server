import { describe, expect, it } from 'vitest';

import { ExecutionBindingUnavailableError } from '../../application/ports/execution-plane.js';
import type { RuntimeSession } from '../../application/ports/runtime-session-repository.js';
import { ExecutionRuntimeChatTurnProvider } from './execution-runtime-chat-turn-provider.js';

describe('ExecutionRuntimeChatTurnProvider N2 modes', () => {
  it('sends only the admitted delta to a healthy same-epoch provider session', async () => {
    const calls: any[] = [];
    const provider = new ExecutionRuntimeChatTurnProvider({
      async ensureAgentChatRuntimeSession() {
        return durableSession(true);
      },
      async resetRuntimeSessionBinding() {
        throw new Error('must not reset');
      },
      async executeTurn(input) {
        calls.push(input);
        return outcome();
      },
    });

    const result = await provider.runTurn({
      ...identity(),
      brain: brain(),
      turn: {
        modeHint: 'delta',
        fromSequenceExclusive: 2,
        throughSequence: 3,
      },
      messages: [
        {
          messageId: 'm3',
          sequence: 3,
          authorType: 'principal',
          authorId: 'principal-n2',
          body: 'NEW_DELTA_ONLY',
        },
      ],
      recoveryMessages: [
        {
          messageId: 'm1',
          sequence: 1,
          authorType: 'principal',
          authorId: 'principal-n2',
          body: 'OLD_CANONICAL_CONTEXT',
        },
        {
          messageId: 'm3',
          sequence: 3,
          authorType: 'principal',
          authorId: 'principal-n2',
          body: 'NEW_DELTA_ONLY',
        },
      ],
    });

    expect(result.mode).toBe('delta');
    expect(calls).toHaveLength(1);
    expect(calls[0].prompt).toContain('CHAT DELTA');
    expect(calls[0].prompt).toContain('NEW_DELTA_ONLY');
    expect(calls[0].prompt).not.toContain('OLD_CANONICAL_CONTEXT');
  });

  it('clears a stale provider binding and retries once with bounded canonical recovery state', async () => {
    const prompts: string[] = [];
    let attempts = 0;
    let resets = 0;
    const provider = new ExecutionRuntimeChatTurnProvider({
      async ensureAgentChatRuntimeSession() {
        return durableSession(true);
      },
      async resetRuntimeSessionBinding() {
        resets += 1;
        return durableSession(false);
      },
      async executeTurn(input) {
        attempts += 1;
        prompts.push(input.prompt);
        if (attempts === 1) throw new ExecutionBindingUnavailableError();
        return outcome();
      },
    });

    const result = await provider.runTurn({
      ...identity(),
      brain: brain(),
      turn: {
        modeHint: 'delta',
        fromSequenceExclusive: 7,
        throughSequence: 8,
      },
      messages: [
        {
          messageId: 'm8',
          sequence: 8,
          authorType: 'principal',
          authorId: 'principal-n2',
          body: 'CURRENT_DELTA',
        },
      ],
      recoveryMessages: [
        {
          messageId: 'm6',
          sequence: 6,
          authorType: 'principal',
          authorId: 'principal-n2',
          body: 'BOUNDED_RECOVERY_CONTEXT',
        },
        {
          messageId: 'm8',
          sequence: 8,
          authorType: 'principal',
          authorId: 'principal-n2',
          body: 'CURRENT_DELTA',
        },
      ],
    });

    expect(resets).toBe(1);
    expect(attempts).toBe(2);
    expect(prompts[0]).toContain('CHAT DELTA');
    expect(prompts[0]).not.toContain('BOUNDED_RECOVERY_CONTEXT');
    expect(prompts[1]).toContain('CHAT RECOVERY SNAPSHOT');
    expect(prompts[1]).toContain('BOUNDED_RECOVERY_CONTEXT');
    expect(result.mode).toBe('recover');
  });
});

function identity() {
  return {
    tenantId: 'tenant-n2',
    agentDefinitionId: 'agent-n2',
    agentVersionId: 'version-n2',
    conversationId: 'conversation-n2',
    triggerMessageId: 'message-n2',
  } as const;
}

function brain() {
  const productScope = { tenantId: 'tenant-n2', workspaceId: 'workspace-n2' };
  const actor = { type: 'service_account' as const, id: 'principal-n2' };
  return {
    turnContext: {
      tenantId: 'tenant-n2',
      agentDefinitionId: 'agent-n2',
      agentVersionId: 'version-n2',
      agentChatRuntimeId: 'runtime-n2',
      runtimeEpoch: 4,
      conversationId: 'conversation-n2',
      triggerMessageId: 'message-n2',
      actor,
      agentOwner: { scope: productScope, principal: actor },
    },
    invocationContext: {
      scope: {
        kind: 'agent_chat' as const,
        agentChatRuntimeId: 'runtime-n2',
        runtimeEpoch: 4,
      },
      productScope,
      actor,
      agentOwner: { scope: productScope, principal: actor },
      agentDefinitionId: 'agent-n2',
      agentVersionId: 'version-n2',
      conversationId: 'conversation-n2',
      triggerMessageId: 'message-n2',
    },
    agentOwner: { scope: productScope, principal: actor },
    instructions: 'N2 deterministic instructions',
    capabilitySummary: {},
    agentHome: {},
    resolvedSkills: [],
    toolRefs: [],
  } as any;
}

function durableSession(bound: boolean): RuntimeSession {
  return {
    id: 'runtime-session-n2',
    scope: {
      kind: 'agent_chat',
      agentChatRuntimeId: 'runtime-n2',
      runtimeEpoch: 4,
    },
    scopeKind: 'agent_chat',
    scopeId: 'runtime-n2:4',
    productSessionId: null,
    taskId: null,
    launchSnapshotId: 'snapshot-n2',
    workspaceId: 'workspace-n2',
    agentVersionId: 'version-n2',
    environmentVersionId: null,
    resolvedSkills: [],
    toolRefs: [],
    workspaceBinding: bound
      ? { plane: 'paseo', externalWorkspaceId: 'workspace-provider-n2' }
      : null,
    sessionBinding: bound
      ? { plane: 'paseo', externalSessionId: 'session-provider-n2' }
      : null,
    createdAt: '2026-08-22T00:00:00.000Z',
    updatedAt: '2026-08-22T00:00:00.000Z',
  };
}

function outcome() {
  return {
    provider: 'recording',
    model: 'deterministic',
    text: 'reply',
    workspaceBinding: {
      plane: 'recording',
      externalWorkspaceId: 'workspace-recording',
    },
    sessionBinding: {
      plane: 'recording',
      externalSessionId: 'session-recording',
    },
  };
}
