import { describe, expect, it } from 'vitest';

import { ExecutionRuntimeChatTurnProvider } from './execution-runtime-chat-turn-provider.js';
import { ExecutionPlaneRuntimeFacade } from '../../application/runtime/execution-plane-runtime-facade.js';
import { ExecutionRunRegistry } from '../../application/runtime/execution-run-registry.js';
import type {
  CreatedExecutionSession,
  AttachExecutionSessionOutcome,
  ExecutionAppliedSessionSpec,
  ExecutionPlaneCapabilities,
  ExecutionPlaneHealth,
  ExecutionPlanePort,
  ExecutionRunInput,
  ExecutionResult,
  ExecutionSession,
  ExecutionSessionBinding,
  ExecutionSessionCapabilities,
  ExecutionSessionSpec,
  ExecutionWorkspaceBinding,
} from '../../application/ports/execution-plane.js';
import { makeRuntimeSession } from '../../../tests/fixtures/runtime-session.js';
import type { RuntimeMemoryCandidateCollector } from '../../application/ports/runtime-memory-candidate-collector.js';
import type {
  RuntimeSession,
  RuntimeSessionLookup,
  RuntimeSessionRepository,
} from '../../application/ports/runtime-session-repository.js';
import type { RuntimeWorkspaceRepository } from '../../application/ports/runtime-workspace-repository.js';
import type { ResolvedChatBrain } from '../../application/chat/chat-brain-resolver.js';

describe('ExecutionRuntimeChatTurnProvider', () => {
  it('persists an agent_chat RuntimeSession and passes structured invocation context', async () => {
    const plane = new RecordingExecutionPlane();
    const runtimeSessions = new InMemoryRuntimeSessions();
    const provider = new ExecutionRuntimeChatTurnProvider(
      createRuntime(plane, runtimeSessions),
    );
    const brain = chatBrain({
      agentDefinitionId: 'agent-definition-1',
      agentVersionId: 'agent-version-1',
      agentChatRuntimeId: 'chat-runtime-1',
      runtimeEpoch: 1,
    });

    await provider.runTurn({
      tenantId: 'tenant-1',
      agentDefinitionId: 'agent-definition-1',
      agentVersionId: 'agent-version-1',
      conversationId: 'conversation-1',
      triggerMessageId: 'message-1',
      brain,
      messages: [
        {
          authorType: 'principal',
          authorId: 'principal-1',
          body: 'hello',
        },
      ],
    });

    expect(runtimeSessions.createAgentChatCalls).toEqual([
      expect.objectContaining({
        agentChatRuntimeId: 'chat-runtime-1',
        runtimeEpoch: 1,
        agentVersionId: 'agent-version-1',
      }),
    ]);
    expect(plane.createdSpecs).toHaveLength(1);
    expect(plane.createdSpecs[0]?.labels?.scope).toBe('agent_chat');
    expect(plane.createdSpecs[0]?.invocationContext).toEqual(
      expect.objectContaining({
        agentDefinitionId: 'agent-definition-1',
        agentVersionId: 'agent-version-1',
        conversationId: 'conversation-1',
        triggerMessageId: 'message-1',
        scope: {
          kind: 'agent_chat',
          agentChatRuntimeId: 'chat-runtime-1',
          runtimeEpoch: 1,
        },
      }),
    );
  });

  it('reuses one durable RuntimeSession and attaches the same provider session on the next chat turn', async () => {
    const plane = new RecordingExecutionPlane();
    const runtimeSessions = new InMemoryRuntimeSessions();
    const provider = new ExecutionRuntimeChatTurnProvider(
      createRuntime(plane, runtimeSessions),
    );

    await provider.runTurn({
      ...turnIdentity(
        'agent-definition-sticky',
        'agent-version-sticky',
        'conversation-sticky',
        'message-1',
      ),
      brain: chatBrain({
        agentDefinitionId: 'agent-definition-sticky',
        agentVersionId: 'agent-version-sticky',
        agentChatRuntimeId: 'chat-runtime-sticky',
        runtimeEpoch: 3,
        conversationId: 'conversation-sticky',
        triggerMessageId: 'message-1',
      }),
      messages: [
        { authorType: 'principal', authorId: 'principal-1', body: 'hello' },
      ],
    });
    await provider.runTurn({
      ...turnIdentity(
        'agent-definition-sticky',
        'agent-version-sticky',
        'conversation-sticky',
        'message-2',
      ),
      brain: chatBrain({
        agentDefinitionId: 'agent-definition-sticky',
        agentVersionId: 'agent-version-sticky',
        agentChatRuntimeId: 'chat-runtime-sticky',
        runtimeEpoch: 3,
        conversationId: 'conversation-sticky',
        triggerMessageId: 'message-2',
      }),
      messages: [
        { authorType: 'principal', authorId: 'principal-1', body: 'hello' },
        {
          authorType: 'principal',
          authorId: 'principal-1',
          body: 'continue from before',
        },
      ],
    });

    expect(runtimeSessions.sessions).toHaveLength(1);
    expect(plane.createdSpecs).toHaveLength(1);
    expect(plane.attachedSpecs).toHaveLength(1);
    expect(plane.attachedBindings[0]?.externalSessionId).toBe(
      'recording-session-1',
    );
    expect(runtimeSessions.bindCalls).toHaveLength(1);
  });

  it('uses a new RuntimeSession after the AgentChatRuntime epoch rotates', async () => {
    const plane = new RecordingExecutionPlane();
    const runtimeSessions = new InMemoryRuntimeSessions();
    const provider = new ExecutionRuntimeChatTurnProvider(
      createRuntime(plane, runtimeSessions),
    );

    await provider.runTurn({
      ...turnIdentity('definition-epoch', 'version-1', 'conversation-epoch'),
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
        triggerMessageId: 'message-epoch-2',
      }),
      messages: [
        { authorType: 'principal', authorId: 'principal-1', body: 'second' },
      ],
    });

    expect(runtimeSessions.sessions).toHaveLength(2);
    expect(plane.createdSpecs).toHaveLength(2);
    expect(plane.attachedSpecs).toHaveLength(0);
    expect(
      runtimeSessions.sessions.map((session) => session.agentVersionId),
    ).toEqual(['version-1', 'version-2']);
  });

  it('carries each resolved agent brain through the runtime facade into its execution system prompt', async () => {
    const plane = new RecordingExecutionPlane();
    const provider = new ExecutionRuntimeChatTurnProvider(
      createRuntime(plane, new InMemoryRuntimeSessions()),
    );

    await provider.runTurn({
      ...turnIdentity(
        'definition-alpha',
        'version-alpha',
        'conversation-alpha',
      ),
      brain: chatBrain({
        agentDefinitionId: 'definition-alpha',
        agentVersionId: 'version-alpha',
        agentChatRuntimeId: 'runtime-alpha',
        instructions: 'Always answer in terse Alpha format.',
        capabilitySummary: { calendar: 'alpha-calendar-capability' },
        agentHome: {
          definition: [
            { path: 'persona.md', content: 'Alpha persona home content.' },
          ],
        },
      }),
      messages: [
        {
          authorType: 'principal',
          authorId: 'principal-alpha',
          body: 'Alpha conversation context.',
        },
      ],
    });
    await provider.runTurn({
      ...turnIdentity('definition-beta', 'version-beta', 'conversation-beta'),
      brain: chatBrain({
        agentDefinitionId: 'definition-beta',
        agentVersionId: 'version-beta',
        agentChatRuntimeId: 'runtime-beta',
        instructions: 'Always answer in warm Beta format.',
        capabilitySummary: { calendar: 'beta-calendar-capability' },
        agentHome: {
          definition: [
            { path: 'persona.md', content: 'Beta persona home content.' },
          ],
        },
      }),
      messages: [
        {
          authorType: 'principal',
          authorId: 'principal-beta',
          body: 'Beta conversation context.',
        },
      ],
    });

    const alphaSystemPrompt = plane.createdSpecs[0]?.systemPrompt;
    const betaSystemPrompt = plane.createdSpecs[1]?.systemPrompt;
    expect(alphaSystemPrompt).toContain(
      'Agent definition ID: definition-alpha',
    );
    expect(alphaSystemPrompt).toContain('Always answer in terse Alpha format.');
    expect(alphaSystemPrompt).toContain('alpha-calendar-capability');
    expect(alphaSystemPrompt).toContain('Alpha persona home content.');
    expect(alphaSystemPrompt).not.toContain('definition-beta');
    expect(betaSystemPrompt).toContain('Agent definition ID: definition-beta');
    expect(betaSystemPrompt).toContain('Always answer in warm Beta format.');
    expect(betaSystemPrompt).toContain('beta-calendar-capability');
    expect(betaSystemPrompt).toContain('Beta persona home content.');
    expect(betaSystemPrompt).not.toContain('definition-alpha');
    expect(plane.runInputs[0]?.prompt).toContain('Alpha conversation context.');
    expect(plane.runInputs[1]?.prompt).toContain('Beta conversation context.');
  });
});

class RecordingExecutionPlane implements ExecutionPlanePort {
  public readonly createdSpecs: ExecutionSessionSpec[] = [];
  public readonly attachedSpecs: ExecutionSessionSpec[] = [];
  public readonly attachedBindings: ExecutionSessionBinding[] = [];
  public readonly runInputs: ExecutionRunInput[] = [];
  #nextSession = 1;

  public capabilities(): ExecutionPlaneCapabilities {
    return { supported: new Set(['reusable_session', 'external_workspace']) };
  }

  public async createSession(
    spec: ExecutionSessionSpec,
  ): Promise<CreatedExecutionSession> {
    this.createdSpecs.push(spec);
    const id = this.#nextSession++;
    return {
      session: recordingSession(this.runInputs),
      workspaceBinding: {
        plane: 'recording',
        externalWorkspaceId: `recording-workspace-${id}`,
      },
      sessionBinding: {
        plane: 'recording',
        externalSessionId: `recording-session-${id}`,
      },
    };
  }

  public async attachSession(
    binding: ExecutionSessionBinding,
    spec: ExecutionSessionSpec,
    _applied?: ExecutionAppliedSessionSpec,
  ): Promise<AttachExecutionSessionOutcome> {
    this.attachedBindings.push(binding);
    this.attachedSpecs.push(spec);
    return { kind: 'reused', session: recordingSession(this.runInputs), appliedRevision: spec.desiredRevision ?? 1 };
  }

  public async health(): Promise<ExecutionPlaneHealth> {
    return {
      ready: true,
      plane: 'recording',
      checks: [{ name: 'recording', ready: true }],
    };
  }

  public async close(): Promise<void> {}
}

class InMemoryRuntimeSessions
  implements RuntimeSessionRepository, RuntimeSessionLookup
{
  public readonly sessions: RuntimeSession[] = [];
  public readonly createAgentChatCalls: Record<string, unknown>[] = [];
  public readonly bindCalls: Record<string, unknown>[] = [];

  public async createOrGetForAgentChat(input: {
    agentChatRuntimeId: string;
    runtimeEpoch: number;
    tenantId: string;
    principalType: string;
    principalId: string;
    workspaceId: string;
    agentVersionId: string;
    resolvedSkills: readonly { ref: string; digest: string }[];
    toolRefs: readonly string[];
  }): Promise<RuntimeSession> {
    this.createAgentChatCalls.push(input);
    const found = this.sessions.find((session) => {
      const scope = session.scope;
      return (
        scope?.kind === 'agent_chat' &&
        scope.agentChatRuntimeId === input.agentChatRuntimeId &&
        scope.runtimeEpoch === input.runtimeEpoch
      );
    });
    if (found) return found;
    const session: RuntimeSession = makeRuntimeSession({
      id: `runtime-session-${this.sessions.length + 1}`,
      scope: {
        kind: 'agent_chat',
        agentChatRuntimeId: input.agentChatRuntimeId,
        runtimeEpoch: input.runtimeEpoch,
      },
      scopeKind: 'agent_chat',
      scopeId: `${input.agentChatRuntimeId}:${input.runtimeEpoch}`,
      productSessionId: null,
      taskId: null,
      launchSnapshotId: `snapshot-${this.sessions.length + 1}`,
      workspaceId: input.workspaceId,
      agentVersionId: input.agentVersionId,
      environmentVersionId: null,
      resolvedSkills: input.resolvedSkills,
      toolRefs: input.toolRefs,
      workspaceBinding: null,
      sessionBinding: null,
    });
    this.sessions.push(session);
    return session;
  }

  public async findByAgentChat(): Promise<RuntimeSession | null> {
    return null;
  }

  public async createOrGetForTeamMember() { return this.createOrGetForProductSession(); }
  public async findByTeamMember(): Promise<RuntimeSession | null> { return null; }
  public async reconcileDesiredSpec(input: { id: string; digest: string }) { const session = await this.findById(input.id); if (!session) throw new Error('runtime session missing'); return { ...session, desiredSpecDigest: input.digest, desiredRevision: session.desiredRevision + 1 }; }
  public async replaceExecution(input: { id: string; workspaceBinding: ExecutionWorkspaceBinding; sessionBinding: ExecutionSessionBinding }) { return this.bindExecution(input); }
  public async markUnavailable(id: string) { const session = await this.findById(id); if (!session) throw new Error('runtime session missing'); return { ...session, status: 'unavailable' as const }; }

  public async findById(id: string): Promise<RuntimeSession | null> {
    return this.sessions.find((session) => session.id === id) ?? null;
  }

  public async findByExecutionSessionBinding(
    binding: ExecutionSessionBinding,
  ): Promise<RuntimeSession | null> {
    return (
      this.sessions.find(
        (session) =>
          session.sessionBinding?.externalSessionId ===
          binding.externalSessionId,
      ) ?? null
    );
  }

  public async bindExecution(input: {
    id: string;
    workspaceBinding: ExecutionWorkspaceBinding;
    sessionBinding: ExecutionSessionBinding;
  }): Promise<RuntimeSession> {
    this.bindCalls.push(input);
    const index = this.sessions.findIndex((session) => session.id === input.id);
    if (index < 0) throw new Error('runtime session missing');
    const current = this.sessions[index]!;
    const next: RuntimeSession = {
      ...current,
      workspaceBinding: input.workspaceBinding,
      sessionBinding: input.sessionBinding,
    };
    this.sessions[index] = next;
    return next;
  }

  public async createOrGetForProductSession(): Promise<RuntimeSession> {
    return this.sessions[0] ?? this.createOrGetForAgentChat({ agentChatRuntimeId: 'fallback', runtimeEpoch: 1, tenantId: 'tenant', principalType: 'service_account', principalId: 'principal', workspaceId: 'workspace', agentVersionId: 'agent', resolvedSkills: [], toolRefs: [] });
  }
  public async createOrGetForTask(): Promise<RuntimeSession> {
    throw new Error('not used');
  }
  public async findByProductSession(): Promise<RuntimeSession | null> {
    return null;
  }
  public async findByTask(): Promise<RuntimeSession | null> {
    return null;
  }
}

function recordingSession(runInputs: ExecutionRunInput[]): ExecutionSession {
  return {
    capabilities: {
      supported: new Set(),
    } satisfies ExecutionSessionCapabilities,
    async run(input): Promise<ExecutionResult> {
      runInputs.push(input);
      return {
        status: 'completed',
        output: {
          provider: 'recording',
          model: 'deterministic',
          text: 'deterministic reply',
        },
      };
    },
    async close(): Promise<void> {},
  };
}

const noMemoryCandidates: RuntimeMemoryCandidateCollector = {
  async prepare() {
    return {
      decoratePrompt: (prompt) => prompt,
      async collect() {
        return [];
      },
    };
  },
};

function createRuntime(
  plane: RecordingExecutionPlane,
  runtimeSessions: InMemoryRuntimeSessions,
): ExecutionPlaneRuntimeFacade {
  return new ExecutionPlaneRuntimeFacade(
    plane,
    runtimeSessions,
    runtimeSessions,
    {
      async findForProductSession() {
        throw new Error('not used');
      },
      async findForTeamRun() {
        throw new Error('not used');
      },
    } as RuntimeWorkspaceRepository,
    new ExecutionRunRegistry(),
    noMemoryCandidates,
    '/runtime-default',
  );
}

function turnIdentity(
  agentDefinitionId: string,
  agentVersionId: string,
  conversationId: string,
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
  const turnContext = {
    productScope,
    actor,
    agentOwner,
    conversationId,
    triggerMessageId,
    agentDefinitionId,
    agentVersionId,
    agentChatRuntimeId,
    runtimeEpoch,
  } as const;
  return {
    turnContext,
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
