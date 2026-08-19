export type ChatActivationCause = {
  readonly type: 'unread_message';
  readonly conversationId: string;
  readonly throughSequence: number;
};

export interface ChatActivation {
  readonly agentDefinitionId: string;
  readonly causes: readonly ChatActivationCause[];
  readonly priority: 'normal' | 'urgent';
  readonly dedupeKey: string;
}
