import { describe, expect, it } from 'vitest';

import { ExecutionRuntimeChatTurnProvider } from './execution-runtime-chat-turn-provider.js';
import { ExecutionPlaneRuntimeFacade } from '../../application/runtime/execution-plane-runtime-facade.js';
import { ExecutionRunRegistry } from '../../application/runtime/execution-run-registry.js';
import type {
  CreatedExecutionSession,
  ExecutionPlaneCapabilities,
  ExecutionPlaneHealth,
  ExecutionPlanePort,
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
});

class RecordingExecutionPlane implements ExecutionPlanePort {
  public readonly createdSpecs: ExecutionSessionSpec[] = [];

  public capabilities(): ExecutionPlaneCapabilities {
    return { supported: new Set() };
  }

  public async createSession(
    spec: ExecutionSessionSpec,
  ): Promise<CreatedExecutionSession> {
    this.createdSpecs.push(spec);
    return {
      session: completedSession,
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

const completedSession: ExecutionSession = {
  capabilities: { supported: new Set() } satisfies ExecutionSessionCapabilities,
  async run(): Promise<ExecutionResult> {
    return {
      status: 'completed',
      output: { provider: 'recording', model: 'deterministic', text: 'hello' },
    };
  },
  async close(): Promise<void> {},
};

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

function chatBrain(): ResolvedChatBrain {
  return {
    instructions: 'Reply concisely.',
    capabilitySummary: {},
    agentHome: {},
  } as ResolvedChatBrain;
}
