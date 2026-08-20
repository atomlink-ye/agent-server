export interface AgentHomeDefinitionEntry {
  readonly path: string;
  readonly content: string;
}

export interface AgentHomeDefinitionSource {
  readDefinition(
    tenantId: string,
    agentDefinitionId: string,
  ): Promise<readonly AgentHomeDefinitionEntry[] | null>;
}
