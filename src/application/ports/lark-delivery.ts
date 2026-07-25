import type { ChannelDeliveryResult } from '../../domain/channels/channel-delivery.js';

export type LarkDeliveryResult = {
  readonly result: ChannelDeliveryResult;
  readonly providerMessageId?: string;
  readonly safeErrorCode?: string;
};

export type LarkDeliveryInput =
  | {
      readonly kind: 'text';
      readonly targetId: string;
      readonly text: string;
      readonly providerRequestId: string;
    }
  | {
      readonly kind: 'card_reply' | 'card_patch';
      readonly targetId: string;
      readonly cardJson: string;
      readonly providerRequestId: string;
      readonly text?: string;
    };

export interface LarkDelivery {
  deliver(input: LarkDeliveryInput): Promise<LarkDeliveryResult>;
}
