import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import {
  ExecutionBindingUnavailableError,
  type CreatedExecutionSession,
  type ExecutionMcpServerConfig,
  type ExecutionPlaneCapabilities,
  type ExecutionPlaneHealth,
  type ExecutionPlanePort,
  type ExecutionResult,
  type ExecutionSession,
  type ExecutionSessionCapabilities,
  type ExecutionSessionBinding,
  type ExecutionSessionSpec,
} from '../../application/ports/execution-plane.js';

const CAPABILITIES: ExecutionPlaneCapabilities = { supported: new Set() };

/**
 * Deterministic test execution plane. It scripts the model decision only;
 * selected tools are still called through the granted MCP endpoint supplied
 * by the real runtime extension binder.
 */
export class ScriptedExecutionPlane implements ExecutionPlanePort {
  readonly #sessions = new Map<string, ExecutionSession>();
  #nextSession = 1;

  public capabilities(): ExecutionPlaneCapabilities {
    return CAPABILITIES;
  }

  public async createSession(
    spec: ExecutionSessionSpec,
  ): Promise<CreatedExecutionSession> {
    const externalSessionId = `scripted-session-${this.#nextSession++}`;
    const session = new ScriptedExecutionSession(spec);
    this.#sessions.set(externalSessionId, session);
    return {
      session,
      workspaceBinding: {
        plane: 'scripted',
        externalWorkspaceId: `scripted-workspace-${spec.runtimeSessionId}`,
      },
      sessionBinding: { plane: 'scripted', externalSessionId },
    };
  }

  public async attachSession(
    binding: ExecutionSessionBinding,
    _spec: ExecutionSessionSpec,
  ): Promise<ExecutionSession> {
    const session = this.#sessions.get(binding.externalSessionId);
    if (!session) throw new ExecutionBindingUnavailableError();
    return session;
  }

  public async health(): Promise<ExecutionPlaneHealth> {
    return {
      ready: true,
      plane: 'scripted',
      provider: 'scripted',
      model: 'deterministic',
      checks: [{ name: 'execution_plane', ready: true }],
    };
  }

  public async close(): Promise<void> {
    await Promise.all(
      [...this.#sessions.values()].map((session) => session.close()),
    );
    this.#sessions.clear();
  }
}

class ScriptedExecutionSession implements ExecutionSession {
  public readonly capabilities: ExecutionSessionCapabilities = {
    supported: new Set(),
  };

  public constructor(private readonly spec: ExecutionSessionSpec) {}

  public async run(input: {
    readonly runId: string;
    readonly prompt: string;
  }): Promise<ExecutionResult> {
    if (/hello/i.test(input.prompt)) return completed('hello');
    const mcp = requiredMcp(this.spec);
    const client = await connect(mcp);
    try {
      if (/正式分析|OpenAI/i.test(input.prompt)) {
        const workflows = await call(client, 'list_agent_workflows', {
          agent_definition_id: agentDefinitionId(this.spec.systemPrompt),
        });
        const workflow = firstWorkflow(workflows);
        await call(client, 'start_work', {
          work_definition_version_id: workflow.work_definition_version_id,
          input: inputFor(workflow.input_schema, input.prompt),
        });
        return completed('已开始正式分析。');
      }
      if (/删掉融资部分/.test(input.prompt)) {
        throw new Error(
          'Scripted continue_work requires a work reference in the prompt.',
        );
      }
      return completed('hello');
    } finally {
      await client.close();
    }
  }

  public async close(): Promise<void> {}
}

async function connect(server: ExecutionMcpServerConfig): Promise<Client> {
  const client = new Client({ name: 'scripted-execution-plane', version: '1' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(server.url), {
      requestInit: { headers: server.headers },
    }) as never,
  );
  return client;
}

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) throw new Error(`Scripted MCP tool ${name} failed.`);
  const content = result.content as readonly {
    readonly type: string;
    readonly text?: string;
  }[];
  const text = content.find((item) => item.type === 'text')?.text;
  if (!text)
    throw new Error(`Scripted MCP tool ${name} returned no text result.`);
  return JSON.parse(text);
}

function requiredMcp(spec: ExecutionSessionSpec): ExecutionMcpServerConfig {
  const server = spec.extensions?.mcpServers?.[0];
  if (!server)
    throw new Error('Scripted execution requires a granted MCP server.');
  return server;
}

function agentDefinitionId(systemPrompt: string): string {
  const match = /^Agent definition ID: (.+)$/m.exec(systemPrompt);
  if (!match?.[1])
    throw new Error(
      'Scripted execution could not read the agent definition ID.',
    );
  return match[1];
}

function firstWorkflow(value: unknown): {
  readonly work_definition_version_id: string;
  readonly input_schema: Record<string, unknown>;
} {
  const workflow = (value as { definitions?: unknown[] }).definitions?.[0] as
    | {
        readonly work_definition_version_id?: unknown;
        readonly input_schema?: unknown;
      }
    | undefined;
  if (
    !workflow ||
    typeof workflow.work_definition_version_id !== 'string' ||
    !workflow.input_schema ||
    typeof workflow.input_schema !== 'object'
  )
    throw new Error(
      'Scripted MCP list_agent_workflows returned no startable workflow.',
    );
  return {
    work_definition_version_id: workflow.work_definition_version_id,
    input_schema: workflow.input_schema as Record<string, unknown>,
  };
}

function inputFor(
  schema: Record<string, unknown>,
  prompt: string,
): Record<string, string> {
  const properties = schema.properties as Record<string, unknown> | undefined;
  const required = Array.isArray(schema.required) ? schema.required : [];
  const field =
    required.find((name): name is string => typeof name === 'string') ??
    Object.keys(properties ?? {})[0];
  if (!field) return {};
  return { [field]: prompt };
}

function completed(text: string): ExecutionResult {
  return {
    status: 'completed',
    output: { provider: 'scripted', model: 'deterministic', text },
  };
}
