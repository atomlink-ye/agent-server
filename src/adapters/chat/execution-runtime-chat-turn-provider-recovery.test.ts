import { describe, expect, it } from 'vitest';

import type { RuntimeSession } from '../../domain/runtime/runtime-session.js';
import type { EnsureDesiredRuntimeSpecInput } from '../../application/ports/ensure-desired-runtime-spec.js';
import { createRuntimeSessionSpec } from '../../domain/runtime/runtime-session-spec.js';
import { runtimeSpecRevision } from '../../domain/runtime/runtime-session.js';
import type { ExecutionOutput } from '../../application/ports/runtime-execution-session.js';
import type {
  ExecuteRuntimeTurn,
  ExecuteRuntimeTurnInput,
} from '../../application/runtime/execute-runtime-turn.js';
import { ExecutionRuntimeChatTurnProvider } from './execution-runtime-chat-turn-provider.js';

describe('ExecutionRuntimeChatTurnProvider recovery handoff', () => {
  it('leaves reuse versus replacement recovery selection to ExecuteRuntimeTurn', async () => {
    const calls: ExecuteRuntimeTurnInput[] = [];
    const executor: Pick<ExecuteRuntimeTurn, 'execute'> = {
      async execute(input): Promise<ExecutionOutput> {
        calls.push(input);
        // This simulates EnsureRuntimeSession finding a replacement provider
        // generation. The application seam, rather than Chat, selects recovery.
        return {
          provider: 'recording',
          model: 'deterministic',
          text: input.recoveryPrompt ?? input.prompt,
        };
      },
    };
    const provider = new ExecutionRuntimeChatTurnProvider(
      {
        async execute(input: EnsureDesiredRuntimeSpecInput) {
          const session = durableSession();
          return {
            session,
            spec: createRuntimeSessionSpec({
              runtimeSessionId: session.id,
              revision: runtimeSpecRevision(1),
              workspaceId: session.owner.workspaceId,
              agentVersionId: input.agentVersionId ?? null,
              environmentVersionId: input.environmentVersionId,
              resolvedSkills: input.resolvedSkills,
              toolRefs: input.toolRefs,
              provider: input.configuration.provider,
              model: input.configuration.model,
              cwd: input.configuration.cwd,
              systemPromptDigest:
                input.configuration.desiredSystemPrompt.digest,
              skillSetDigest: 'skills',
              toolCatalogDigest: 'catalog',
              extensionSetDigest: 'extensions',
              contextEpoch: input.configuration.contextEpoch,
              createdAt: '2026-08-22T00:00:00.000Z',
            }),
          };
        },
      },
      executor,
      { provider: 'recording', model: 'deterministic', cwd: '/tmp/recording' },
    );

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
    expect(calls[0]?.runtimeSessionId).toBe('runtime-session-n2');
    expect(calls[0]?.source).toEqual({
      kind: 'conversation',
      conversationId: 'conversation-n2',
      triggerMessageId: 'message-n2',
    });
    expect(calls[0]?.prompt).toContain('CHAT DELTA');
    expect(calls[0]?.prompt).toContain('NEW_DELTA_ONLY');
    expect(calls[0]?.prompt).not.toContain('OLD_CANONICAL_CONTEXT');
    expect(calls[0]?.recoveryPrompt).toContain('CHAT RECOVERY SNAPSHOT');
    expect(calls[0]?.recoveryPrompt).toContain('OLD_CANONICAL_CONTEXT');
    expect(result.body).toContain('CHAT RECOVERY SNAPSHOT');
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
  const agentOwner = { scope: productScope, principal: actor };
  return {
    turnContext: {
      productScope,
      actor,
      agentOwner,
      agentDefinitionId: 'agent-n2',
      agentVersionId: 'version-n2',
      agentChatRuntimeId: 'runtime-n2',
      runtimeEpoch: 4,
      conversationId: 'conversation-n2',
      triggerMessageId: 'message-n2',
    },
    invocationContext: {
      scope: {
        kind: 'agent_chat' as const,
        agentChatRuntimeId: 'runtime-n2',
        runtimeEpoch: 4,
      },
      productScope,
      actor,
      agentOwner,
      agentDefinitionId: 'agent-n2',
      agentVersionId: 'version-n2',
      conversationId: 'conversation-n2',
      triggerMessageId: 'message-n2',
    },
    agentOwner,
    instructions: 'N2 deterministic instructions',
    capabilitySummary: {},
    agentHome: {},
    resolvedSkills: [],
    toolRefs: [],
  } as any;
}

function durableSession(): RuntimeSession {
  return {
    id: 'runtime-session-n2',
    owner: {
      tenantId: 'tenant-n2',
      workspaceId: 'workspace-n2',
      principalType: 'service_account',
      principalId: 'principal-n2',
    },
    scope: { kind: 'agent_chat', id: 'runtime-n2', epoch: 4 },
    desiredSpecRevision: 1,
    currentGenerationId: null,
    status: 'ready',
    createdAt: '2026-08-22T00:00:00.000Z',
    updatedAt: '2026-08-22T00:00:00.000Z',
    closedAt: null,
  } as RuntimeSession;
}
