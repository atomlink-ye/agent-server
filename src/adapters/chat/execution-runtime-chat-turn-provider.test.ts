import { describe, expect, it } from 'vitest';

import { ExecutionRuntimeChatTurnProvider } from './execution-runtime-chat-turn-provider.js';
import { ExecutionPlaneRuntimeFacade } from '../../application/runtime/execution-plane-runtime-facade.js';
import { ExecutionRunRegistry } from '../../application/runtime/execution-run-registry.js';
import type {
  CreatedExecutionSession,
  ExecutionPlaneCapabilities,
  ExecutionPlaneHealth,
  ExecutionPlanePort,
  ExecutionRunInput,
  ExecutionResult,
  ExecutionSession,
  ExecutionSessionBinding,
  ExecutionSessionCapabilities,
  ExecutionSessionSpec,
} from '../../application/ports/execution-plane.js';
import type { RuntimeMemoryCandidateCollector } from '../../application/ports/runtime-memory-candidate-collector.js';
import type {
  RuntimeSessionLookup,
  RuntimeSessionRepository,
} from '../../application/ports/runtime-session-repository.js';
import type { RuntimeWorkspaceRepository } from '../../application/ports/runtime-workspace-repository.js';
import type { ResolvedChatBrain } from '../../application/chat/chat-brain-resolver.js';

describe('ExecutionRuntimeChatTurnProvider', () => {
  it('passes the agent_chat scope to the execution plane when it creates a chat session', async () => {
    const plane = new RecordingExecutionPlane();
    const runtime = new ExecutionPlaneRuntimeFacade(
      plane,
      {} as RuntimeSessionRepository,
      {} as RuntimeSessionLookup,
      {} as RuntimeWorkspaceRepository,
      new ExecutionRunRegistry(),
      noMemoryCandidates,
      '/runtime-default',
    );
    const provider = new ExecutionRuntimeChatTurnProvider(runtime);

    await provider.runTurn({
      tenantId: 'tenant-1',
      agentDefinitionId: 'agent-definition-1',
      agentVersionId: 'agent-version-1',
      conversationId: 'conversation-1',
      triggerMessageId: 'message-1',
      brain: chatBrain(),
      messages: [
        {
          authorType: 'principal',
          authorId: 'principal-1',
          body: 'hello',
        },
      ],
    });

    expect(plane.createdSpecs).toHaveLength(1);
    expect(plane.createdSpecs[0]?.labels?.scope).toBe('agent_chat');
  });

  it('carries each resolved agent brain through the runtime facade into its execution system prompt', async () => {
    const plane = new RecordingExecutionPlane();
    const provider = new ExecutionRuntimeChatTurnProvider(createRuntime(plane));

    await provider.runTurn({
      ...turnIdentity(
        'definition-alpha',
        'version-alpha',
        'conversation-alpha',
      ),
      brain: chatBrain({
        instructions: 'Always answer in terse Alpha format.',
        capabilitySummary: {
          calendar: 'alpha-calendar-capability',
        },
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
        instructions: 'Always answer in warm Beta format.',
        capabilitySummary: {
          calendar: 'beta-calendar-capability',
        },
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

    expect(plane.createdSpecs).toHaveLength(2);
    const alphaSystemPrompt = plane.createdSpecs[0]?.systemPrompt;
    const betaSystemPrompt = plane.createdSpecs[1]?.systemPrompt;
    expect(alphaSystemPrompt).toBeDefined();
    expect(betaSystemPrompt).toBeDefined();

    expect(alphaSystemPrompt).toContain(
      'Agent definition ID: definition-alpha',
    );
    expect(alphaSystemPrompt).toContain('Agent version ID: version-alpha');
    expect(alphaSystemPrompt).not.toContain(
      'Agent definition ID: definition-beta',
    );
    expect(alphaSystemPrompt).not.toContain('Agent version ID: version-beta');
    expect(alphaSystemPrompt).toContain('Always answer in terse Alpha format.');
    expect(alphaSystemPrompt).toContain('alpha-calendar-capability');
    expect(alphaSystemPrompt).toContain('Alpha persona home content.');
    expect(alphaSystemPrompt).not.toContain(
      'Always answer in warm Beta format.',
    );
    expect(alphaSystemPrompt).not.toContain('beta-calendar-capability');
    expect(alphaSystemPrompt).not.toContain('Beta persona home content.');

    expect(betaSystemPrompt).toContain('Always answer in warm Beta format.');
    expect(betaSystemPrompt).toContain('Agent definition ID: definition-beta');
    expect(betaSystemPrompt).toContain('Agent version ID: version-beta');
    expect(betaSystemPrompt).not.toContain(
      'Agent definition ID: definition-alpha',
    );
    expect(betaSystemPrompt).not.toContain('Agent version ID: version-alpha');
    expect(betaSystemPrompt).toContain('beta-calendar-capability');
    expect(betaSystemPrompt).toContain('Beta persona home content.');
    expect(betaSystemPrompt).not.toContain(
      'Always answer in terse Alpha format.',
    );
    expect(betaSystemPrompt).not.toContain('alpha-calendar-capability');
    expect(betaSystemPrompt).not.toContain('Alpha persona home content.');

    expect(plane.runInputs[0]?.prompt).toContain('Alpha conversation context.');
    expect(plane.runInputs[1]?.prompt).toContain('Beta conversation context.');
  });

  it('keeps the trusted instruction segment equal when only other agent inputs differ', async () => {
    const plane = new RecordingExecutionPlane();
    const provider = new ExecutionRuntimeChatTurnProvider(createRuntime(plane));

    const sharedInstructions = 'Use the shared control instruction.';
    await provider.runTurn({
      ...turnIdentity(
        'definition-control-a',
        'version-control-a',
        'conversation-control-a',
      ),
      brain: chatBrain({
        instructions: sharedInstructions,
        capabilitySummary: { unique: 'control-a-capability' },
        agentHome: {
          conversation: [{ path: 'control-a.md', content: 'Control A home.' }],
        },
      }),
      messages: [
        {
          authorType: 'principal',
          authorId: 'principal-control-a',
          body: 'Control A context.',
        },
      ],
    });
    await provider.runTurn({
      ...turnIdentity(
        'definition-control-b',
        'version-control-b',
        'conversation-control-b',
      ),
      brain: chatBrain({
        instructions: sharedInstructions,
        capabilitySummary: { unique: 'control-b-capability' },
        agentHome: {
          conversation: [{ path: 'control-b.md', content: 'Control B home.' }],
        },
      }),
      messages: [
        {
          authorType: 'principal',
          authorId: 'principal-control-b',
          body: 'Control B context.',
        },
      ],
    });

    const controlASystemPrompt = plane.createdSpecs[0]?.systemPrompt;
    const controlBSystemPrompt = plane.createdSpecs[1]?.systemPrompt;
    expect(controlASystemPrompt).toBeDefined();
    expect(controlBSystemPrompt).toBeDefined();
    expect(extractTrustedInstructions(controlASystemPrompt!)).toBe(
      extractTrustedInstructions(controlBSystemPrompt!),
    );
    expect(controlASystemPrompt).not.toBe(controlBSystemPrompt);
    expect(plane.runInputs[0]?.prompt).toContain('Control A context.');
    expect(plane.runInputs[1]?.prompt).toContain('Control B context.');
  });
});

class RecordingExecutionPlane implements ExecutionPlanePort {
  public readonly createdSpecs: ExecutionSessionSpec[] = [];
  public readonly runInputs: ExecutionRunInput[] = [];

  public capabilities(): ExecutionPlaneCapabilities {
    return { supported: new Set() };
  }

  public async createSession(
    spec: ExecutionSessionSpec,
  ): Promise<CreatedExecutionSession> {
    this.createdSpecs.push(spec);
    return {
      session: recordingSession(this.runInputs),
      workspaceBinding: {
        plane: 'recording',
        externalWorkspaceId: 'workspace-1',
      },
      sessionBinding: { plane: 'recording', externalSessionId: 'session-1' },
    };
  }

  public async attachSession(
    _binding: ExecutionSessionBinding,
    _spec: ExecutionSessionSpec,
  ): Promise<ExecutionSession> {
    throw new Error('Chat turns create a fresh execution session.');
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
): ExecutionPlaneRuntimeFacade {
  return new ExecutionPlaneRuntimeFacade(
    plane,
    {} as RuntimeSessionRepository,
    {} as RuntimeSessionLookup,
    {} as RuntimeWorkspaceRepository,
    new ExecutionRunRegistry(),
    noMemoryCandidates,
    '/runtime-default',
  );
}

function turnIdentity(
  agentDefinitionId: string,
  agentVersionId: string,
  conversationId: string,
) {
  return {
    tenantId: 'tenant-1',
    agentDefinitionId,
    agentVersionId,
    conversationId,
    triggerMessageId: `${conversationId}-trigger`,
  } as const;
}

function extractTrustedInstructions(systemPrompt: string): string {
  const start = '\nTRUSTED AGENT INSTRUCTIONS:\n';
  const end = '\n\nCAPABILITY SUMMARY:';
  const startIndex = systemPrompt.indexOf(start);
  const endIndex = systemPrompt.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0)
    throw new Error('Trusted instruction section was not recorded.');
  return systemPrompt.slice(startIndex + start.length, endIndex);
}

function chatBrain(
  input: {
    instructions: string;
    capabilitySummary: Record<string, unknown>;
    agentHome: Record<string, unknown>;
  } = {
    instructions: 'Reply concisely.',
    capabilitySummary: {},
    agentHome: {},
  },
): ResolvedChatBrain {
  return input as ResolvedChatBrain;
}
