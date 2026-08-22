import { ScriptedExecutionPlane } from '../../src/adapters/runtime/scripted-execution-plane.js';
import type { ExecutionSessionSpec } from '../../src/application/ports/execution-plane.js';
import type { RuntimeMcpServer } from '../../src/infrastructure/extensions/runtime-mcp-server.js';

export type ScriptedRuntimeHarness = Readonly<{
  plane: ScriptedExecutionPlane;
  createSession(input: {
    runtimeSessionId: string;
    systemPrompt: string;
    invocationContext?: ExecutionSessionSpec['invocationContext'];
    mcpServer?: RuntimeMcpServer;
    token?: string;
  }): ReturnType<ScriptedExecutionPlane['createSession']>;
}>;

export function createScriptedRuntimeHarness(): ScriptedRuntimeHarness {
  const plane = new ScriptedExecutionPlane();
  return {
    plane,
    async createSession(input) {
      const mcpUrl = input.mcpServer
        ? await input.mcpServer.start()
        : undefined;
      return plane.createSession({
        runtimeSessionId: input.runtimeSessionId,
        workspace: { cwd: process.cwd() },
        systemPrompt: input.systemPrompt,
        ...(input.invocationContext
          ? { invocationContext: input.invocationContext }
          : {}),
        ...(mcpUrl && input.token
          ? {
              extensions: {
                mcpServers: [
                  {
                    name: 'agent-server',
                    url: mcpUrl,
                    headers: { Authorization: `Bearer ${input.token}` },
                  },
                ],
              },
            }
          : {}),
      });
    },
  };
}
