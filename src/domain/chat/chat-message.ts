export type ChatMessageAuthorType = 'principal' | 'agent_definition';

export interface ChatMessage {
  readonly id: string;
  readonly tenantId: string;
  readonly conversationId: string;
  readonly sequence: number;
  readonly authorType: ChatMessageAuthorType;
  readonly authorId: string;
  readonly body: string;
  readonly agentDefinitionId: string | null;
  readonly agentVersionId: string | null;
  readonly runtimeEpoch: number | null;
  readonly workRef: string | null;
  /** Optional durable delivery identity; legacy messages have no value. */
  readonly deliveryId?: string | null;
  readonly createdAt: string;
}

export function chatMessageRef(sequence: number): string {
  if (!Number.isSafeInteger(sequence) || sequence <= 0) {
    throw new Error('Chat message sequence is invalid.');
  }
  return `CM-${sequence}`;
}
