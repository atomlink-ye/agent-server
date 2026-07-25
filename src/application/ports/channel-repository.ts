import type {
  ChannelConversationBinding,
  ChannelConversationBindingInput,
  ChannelIngress,
  ChannelIngressInput,
} from '../../domain/channels/channel-event.js';
import type {
  ChannelDeliveryAttemptInput,
  ChannelOutbox,
  ChannelOutboxInput,
} from '../../domain/channels/channel-delivery.js';

export interface ChannelRepository {
  insertIngress(input: ChannelIngressInput): Promise<{
    readonly record: ChannelIngress;
    readonly inserted: boolean;
  }>;
  claimIngress(
    workerId: string,
    leaseMs: number,
  ): Promise<ChannelIngress | null>;
  completeIngress(input: {
    readonly ingressId: string;
    readonly status: 'processed' | 'failed';
    readonly safeErrorCode?: string;
    readonly admittedSessionId?: string;
    readonly admittedTaskId?: string;
    readonly leaseOwner: string;
    readonly attemptNumber: number;
  }): Promise<void>;
  completeIngressAdministrative(input: {
    readonly ingressId: string;
    readonly status: 'processed' | 'failed';
    readonly safeErrorCode?: string;
    readonly admittedSessionId?: string;
    readonly admittedTaskId?: string;
  }): Promise<void>;
  releaseIngress(input: {
    readonly ingressId: string;
    readonly leaseOwner: string;
    readonly attemptNumber: number;
    readonly safeErrorCode: string;
  }): Promise<void>;
  resolveBinding(
    input: ChannelConversationBindingInput,
  ): Promise<ChannelConversationBinding>;
  findBinding(input: {
    readonly connectionKey: string;
    readonly chatId: string;
    readonly rootMessageId: string;
  }): Promise<ChannelConversationBinding | null>;
  findBindingBySessionId?(
    input: Readonly<{ connectionKey: string; sessionId: string }>,
  ): Promise<ChannelConversationBinding | null>;
  saveOutbox(input: ChannelOutboxInput): Promise<{
    readonly record: ChannelOutbox;
    readonly inserted: boolean;
  }>;
  claimOutbox(workerId: string, leaseMs: number): Promise<ChannelOutbox | null>;
  recordAttempt(input: ChannelDeliveryAttemptInput): Promise<void>;
}
