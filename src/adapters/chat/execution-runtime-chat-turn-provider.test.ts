import { describe, expect, it } from 'vitest';

import type { RuntimeSession } from '../../domain/runtime/runtime-session.js';
import type { ResolvedChatBrain } from '../../application/chat/chat-brain-resolver.js';
import type { ExecutionOutput } from '../../application/ports/runtime-execution-session.js';
import type { CreateAgentChatRuntimeSession } from '../../application/runtime/create-agent-chat-runtime-session.js';
import type {
  ExecuteRuntimeTurn,
  ExecuteRuntimeTurnInput,
} from '../../application/runtime/execute-runtime-turn.js';
import { ExecutionRuntimeChatTurnProvider } from './execution-runtime-chat-turn-provider.js';

describe('ExecutionRuntimeChatTurnProvider', () => {
  it('creates a durable chat session and executes a conversation turn through the new seams', async () => {
    const session = runtimeSession('runtime-session-1');
    const creator = new RecordingSessionCreator([session]);
    const executor = new RecordingTurnExecutor();
    const provider = new ExecutionRuntimeChatTurnProvider(creator, executor);
    const brain = chatBrain({
      agentDefinitionId: 'agent-definition-1',
      agentVersionId: 'agent-version-1',
      agentChatRuntimeId: 'chat-runtime-1',
      runtimeEpoch: 1,
      instructions: 'Always answer in terse Alpha format.',
      capabilitySummary: { calendar: 'alpha-calendar-capability' },
      agentHome: {
        definition: [
          { path: 'persona.md', content: 'Alpha persona home content.' },
        ],
      },
    });

    const result = await provider.runTurn({
      ...turnIdentity('agent-definition-1', 'agent-version-1'),
      brain,
      messages: [
        {
          authorType: 'principal',
          authorId: 'principal-1',
          body: 'hello',
        },
      ],
    });

    expect(creator.calls).toEqual([
      expect.objectContaining({
        agentChatRuntimeId: 'chat-runtime-1',
        runtimeEpoch: 1,
        agentOwner: brain.agentOwner,
        agentVersionId: 'agent-version-1',
        resolvedSkills: [],
        toolRefs: [],
      }),
    ]);
    expect(executor.calls).toHaveLength(1);
    expect(executor.calls[0]).toEqual(
      expect.objectContaining({
        runtimeSessionId: 'runtime-session-1',
        source: {
          kind: 'conversation',
          conversationId: 'conversation-1',
          triggerMessageId: 'conversation-1-trigger',
        },
        turnId: 'chat:conversation-1:conversation-1-trigger',
      }),
    );
    expect(executor.calls[0]?.prompt).toContain(
      'Always answer in terse Alpha format.',
    );
    expect(executor.calls[0]?.prompt).toContain(
      'Alpha persona home content.',
    );
    expect(executor.calls[0]?.recoveryPrompt).toContain(
      'CHAT BOOTSTRAP SNAPSHOT',
    );
    expect(result).toEqual({
      body: 'deterministic reply',
      provider: 'recording',
      mode: 'bootstrap',
    });
  });

  it('passes delta and canonical recovery prompts so runtime Ensure chooses reuse or replacement', async () => {
    const creator = new RecordingSessionCreator([
      runtimeSession('runtime-session-1'),
      runtimeSession('runtime-session-1'),
    ]);
    const executor = new RecordingTurnExecutor();
    const provider = new ExecutionRuntimeChatTurnProvider(creator, executor);
    const common = {
      ...turnIdentity(
        'agent-definition-sticky',
        'agent-version-sticky',
        'conversation-sticky',
      ),
      brain: chatBrain({
        agentDefinitionId: 'agent-definition-sticky',
        agentVersionId: 'agent-version-sticky',
        agentChatRuntimeId: 'chat-runtime-sticky',
        runtimeEpoch: 3,
        conversationId: 'conversation-sticky',
      }),
    } as const;

    await provider.runTurn({
      ...common,
      messages: [
        { authorType: 'principal', authorId: 'principal-1', body: 'hello' },
      ],
    });
    await provider.runTurn({
      ...common,
      triggerMessageId: 'conversation-sticky-trigger-2',
      turn: {
        modeHint: 'delta',
        fromSequenceExclusive: 1,
        throughSequence: 2,
      },
      messages: [
        {
          sequence: 2,
          authorType: 'principal',
          authorId: 'principal-1',
          body: 'NEW_DELTA_ONLY',
        },
      ],
      recoveryMessages: [
        {
          sequence: 1,
          authorType: 'principal',
          authorId: 'principal-1',
          body: 'OLD_CANONICAL_CONTEXT',
        },
        {
          sequence: 2,
          authorType: 'principal',
          authorId: 'principal-1',
          body: 'NEW_DELTA_ONLY',
        },
      ],
    });

    expect(creator.calls).toHaveLength(2);
    expect(executor.calls).toHaveLength(2);
    const delta = executor.calls[1];
    expect(delta?.runtimeSessionId).toBe('runtime-session-1');
    expect(delta?.source).toEqual({
      kind: 'conversation',
      conversationId: 'conversation-sticky',
      triggerMessageId: 'conversation-sticky-trigger-2',
    });
    expect(delta?.prompt).toContain('CHAT DELTA');
    expect(delta?.prompt).toContain('NEW_DELTA_ONLY');
    expect(delta?.prompt).not.toContain('OLD_CANONICAL_CONTEXT');
    expect(delta?.recoveryPrompt).toContain('CHAT RECOVERY SNAPSHOT');
    expect(delta?.recoveryPrompt).toContain('OLD_CANONICAL_CONTEXT');
  });

  it('uses the creator result for each chat epoch without inspecting provider state', async () => {
    const creator = new RecordingSessionCreator([
      runtimeSession('runtime-session-epoch-1'),
      runtimeSession('runtime-session-epoch-2'),
    ]);
    const executor = new RecordingTurnExecutor();
    const provider = new ExecutionRuntimeChatTurnProvider(creator, executor);

    await provider.runTurn({
      ...turnIdentity(
        'definition-epoch',
        'version-1',
        'conversation-epoch',
        'message-epoch-1',
      ),
      brain: chatBrain({
        agentDefinitionId: 'definition-epoch',
        agentVersionId: 'version-1',
        agentChatRuntimeId: 'runtime-epoch',
        runtimeEpoch: 1,
      }),
      messages: [
        { authorType: 'principal', authorId: 'principal-1', body: 'first' },
      ],
    });
    await provider.runTurn({
      ...turnIdentity(
        'definition-epoch',
        'version-2',
        'conversation-epoch',
        'message-epoch-2',
      ),
      brain: chatBrain({
        agentDefinitionId: 'definition-epoch',
        agentVersionId: 'version-2',
        agentChatRuntimeId: 'runtime-epoch',
        runtimeEpoch: 2,
      }),
      messages: [
        { authorType: 'principal', authorId: 'principal-1', body: 'second' },
      ],
    });

    expect(creator.calls.map((call) => call.runtimeEpoch)).toEqual([1, 2]);
    expect(executor.calls.map((call) => call.runtimeSessionId)).toEqual([
      'runtime-session-epoch-1',
      'runtime-session-epoch-2',
    ]);
  });
});

type CreatorInput = Parameters<
  CreateAgentChatRuntimeSession['execute']
>[0];

class RecordingSessionCreator implements Pick<CreateAgentChatRuntimeSession, 'execute'> {
  public readonly calls: CreatorInput[] = [];

  public constructor(private readonly sessions: readonly RuntimeSession[]) {}

  public async execute(input: CreatorInput): Promise<RuntimeSession> {
    this.calls.push(input);
    const session = this.sessions[this.calls.length - 1];
    if (!session) throw new Error('recording runtime session missing');
    return session;
  }
}

class RecordingTurnExecutor implements Pick<ExecuteRuntimeTurn, 'execute'> {
  public readonly calls: ExecuteRuntimeTurnInput[] = [];

  public async execute(input: ExecuteRuntimeTurnInput): Promise<ExecutionOutput> {
    this.calls.push(input);
    return {
      provider: 'recording',
      model: 'deterministic',
      text: 'deterministic reply',
    };
  }
}

function runtimeSession(id: string): RuntimeSession {
  return {
    id,
    owner: {
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      principalType: 'service_account',
      principalId: 'principal-1',
    },
    scope: { kind: 'agent_chat', id: 'chat-runtime-1', epoch: 1 },
    desiredSpecRevision: 1,
    currentGenerationId: null,
    status: 'provisioning',
    createdAt: '2026-08-22T00:00:00.000Z',
    updatedAt: '2026-08-22T00:00:00.000Z',
    closedAt: null,
  } as RuntimeSession;
}

function turnIdentity(
  agentDefinitionId: string,
  agentVersionId: string,
  conversationId = 'conversation-1',
  triggerMessageId = `${conversationId}-trigger`,
) {
  return {
    tenantId: 'tenant-1',
    agentDefinitionId,
    agentVersionId,
    conversationId,
    triggerMessageId,
  } as const;
}

function chatBrain(
  input: {
    agentDefinitionId?: string;
    agentVersionId?: string;
    agentChatRuntimeId?: string;
    runtimeEpoch?: number;
    conversationId?: string;
    triggerMessageId?: string;
    instructions?: string;
    capabilitySummary?: Record<string, unknown>;
    agentHome?: Record<string, unknown>;
  } = {},
): ResolvedChatBrain {
  const agentDefinitionId = input.agentDefinitionId ?? 'agent-definition-1';
  const agentVersionId = input.agentVersionId ?? 'agent-version-1';
  const agentChatRuntimeId = input.agentChatRuntimeId ?? 'chat-runtime-1';
  const runtimeEpoch = input.runtimeEpoch ?? 1;
  const conversationId = input.conversationId ?? 'conversation-1';
  const triggerMessageId =
    input.triggerMessageId ?? `${conversationId}-trigger`;
  const productScope = {
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
  } as const;
  const actor = { type: 'service_account', id: 'principal-1' } as const;
  const agentOwner = { scope: productScope, principal: actor } as const;
  return {
    turnContext: {
      productScope,
      actor,
      agentOwner,
      conversationId,
      triggerMessageId,
      agentDefinitionId,
      agentVersionId,
      agentChatRuntimeId,
      runtimeEpoch,
    },
    invocationContext: {
      scope: { kind: 'agent_chat', agentChatRuntimeId, runtimeEpoch },
      productScope,
      actor,
      agentOwner,
      agentDefinitionId,
      agentVersionId,
      conversationId,
      triggerMessageId,
    },
    agentOwner,
    instructions: input.instructions ?? 'Reply concisely.',
    capabilitySummary: input.capabilitySummary ?? {},
    agentHome: input.agentHome ?? {},
    resolvedSkills: [],
    toolRefs: [],
  } as unknown as ResolvedChatBrain;
}
