/** Resolves the live HTTP endpoint used by provider-hosted runtime MCP tools. */
export interface RuntimeMcpEndpoint {
  current(): Promise<{
    readonly url: string;
  }>;
}
