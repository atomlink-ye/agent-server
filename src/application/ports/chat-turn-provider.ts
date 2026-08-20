export interface ChatTurnMessage {
  readonly authorType: 'principal' | 'agent_definition';
  readonly authorId: string;
  readonly body: string;
}

export interface ChatTurnProvider {
  runTurn(input: {
    readonly tenantId: string;
    readonly agentDefinitionId: string;
    readonly agentVersionId: string;
    readonly conversationId: string;
    readonly messages: readonly ChatTurnMessage[];
  }): Promise<{ readonly body: string }>;
}
