export interface WhisperMessage {
  readonly id: string;
  readonly tenantId: string;
  readonly whisperChannelId: string;
  readonly sequence: number;
  readonly authorAgentDefinitionId: string;
  readonly body: string;
  readonly createdAt: string;
}
