import { ScriptedExecutionPlane } from '../../src/adapters/runtime/scripted-execution-plane.js';
import type { RuntimeMcpServer } from '../../src/infrastructure/extensions/runtime-mcp-server.js';

export type ScriptedRuntimeHarness = Readonly<{
  plane: ScriptedExecutionPlane;
  createSession(input: {
    runtimeSessionId: string;
    systemPrompt: string;
    mcpServer?: RuntimeMcpServer;
    token?: string;
  }): ReturnType<ScriptedExecutionPlane['createSession']>;
}>;

export function createScriptedRuntimeHarness(): ScriptedRuntimeHarness {
  const plane = new ScriptedExecutionPlane();
  return {
    plane,
    createSession(input) {
      return plane.createSession({
        runtimeSessionId: input.runtimeSessionId,
        workspace: { cwd: process.cwd() },
        systemPrompt: input.systemPrompt,
        ...(input.mcpServer && input.token
          ? {
              extensions: {
                mcpServers: [
                  {
                    name: 'agent-server',
                    url: input.mcpServer.start(),
                    headers: { Authorization: `Bearer ${input.token}` },
                  },
                ],
              },
            }
          : {}),
      } as never);
    },
  };
}
