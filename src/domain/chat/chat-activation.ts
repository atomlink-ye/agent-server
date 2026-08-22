export type ChatActivationCause =
  | Readonly<{
      readonly type: 'unread_message';
      readonly conversationId: string;
      readonly throughSequence: number;
      readonly messageId?: string;
    }>
  | Readonly<{
      readonly type: 'work_wake';
      readonly conversationId: string;
      readonly throughSequence: number;
      readonly deliveryId: string;
      readonly workId: string;
      readonly workRef: string;
      readonly productState: 'complete' | 'needs_you' | 'problem';
    }>;

export interface ChatActivation {
  readonly agentDefinitionId: string;
  readonly causes: readonly ChatActivationCause[];
  readonly priority: 'normal' | 'urgent';
  readonly dedupeKey: string;
}
