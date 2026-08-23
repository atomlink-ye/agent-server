export const AGENT_SERVER_EXECUTION_MCP_SERVER_NAME = 'agent-server';

export interface ExecutionMcpServerConfig {
  readonly name: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

/** Runtime extension identity excludes bearer plaintext from its stable digest. */
export interface ExecutionExtensionBinding {
  readonly mcpServers?: readonly ExecutionMcpServerConfig[];
  readonly endpointEpoch?: string;
  readonly digest?: string;
  readonly grantId?: string;
}
