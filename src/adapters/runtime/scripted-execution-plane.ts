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

const CAPABILITIES: ExecutionPlaneCapabilities = {
  supported: new Set([
    'streaming',
    'cancellation',
    'reusable_session',
    'external_workspace',
    'timeline_replay',
    'permissions',
    'nested_activities',
    'provider_discovery',
    'platform_mcp',
  ]),
};

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
    const continuation = continuationRequest(input.prompt);
    if (continuation) {
      const client = await connect(requiredMcp(this.spec));
      try {
        await call(client, 'continue_work', continuation);
        return completed('已续做既有工作。');
      } finally {
        await client.close();
      }
    }
    if (/正式分析|OpenAI/i.test(input.prompt)) {
      const client = await connect(requiredMcp(this.spec));
      try {
        const workflows = await call(client, 'list_agent_workflows', {
          agent_definition_id: agentDefinitionId(this.spec),
        });
        const workflow = firstWorkflow(workflows);
        await call(client, 'start_work', {
          work_definition_version_id: workflow.work_definition_version_id,
          input: inputFor(workflow.input_schema, input.prompt),
        });
        return completed('已开始正式分析。');
      } finally {
        await client.close();
      }
    }
    if (/hello/i.test(input.prompt)) return completed('hello');
    return completed('hello');
  }

  public async close(): Promise<void> {}
}

function continuationRequest(
  prompt: string,
): { readonly work_ref: string; readonly feedback: string } | null {
  const match =
    /继续(?:做|返工)\s+Work\s+([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})\s*[:：]\s*(.+)/i.exec(
      prompt,
    );
  if (!match?.[1] || !match[2]) return null;
  return { work_ref: match[1], feedback: match[2] };
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
  const content = result.content as readonly {
    readonly type: string;
    readonly text?: string;
  }[];
  if (result.isError) {
    const detail = content?.find((item) => item.type === 'text')?.text;
    throw new Error(
      `Scripted MCP tool ${name} failed: ${detail ?? '<no text content returned>'}`,
    );
  }
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

function agentDefinitionId(spec: ExecutionSessionSpec): string {
  const id = spec.invocationContext?.agentDefinitionId;
  if (!id)
    throw new Error(
      'Scripted execution requires agentDefinitionId in RuntimeInvocationContext.',
    );
  return id;
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
