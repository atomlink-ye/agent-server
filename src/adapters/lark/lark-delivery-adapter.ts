import { AppType, Client, Domain } from '@larksuiteoapi/node-sdk';
import type { LarkDelivery } from '../../application/ports/lark-delivery.js';
import type { LarkDeliveryResult } from '../../application/ports/lark-delivery.js';
import type { LarkCanaryEnabledConfig } from '../../shared/config.js';

type ReplyClient = {
  im: {
    message: {
      reply(payload: {
        path: { message_id: string };
        data: {
          msg_type: string;
          content: string;
          reply_in_thread: boolean;
          uuid: string;
        };
      }): Promise<unknown>;
      patch?(payload: {
        path: { message_id: string };
        data: { content: string };
      }): Promise<unknown>;
    };
  };
};

export type LarkDeliveryClientFactory = (
  config: LarkCanaryEnabledConfig,
) => ReplyClient;

export function createLarkDeliveryAdapter(
  config: LarkCanaryEnabledConfig,
  clientFactory: LarkDeliveryClientFactory = createClient,
): LarkDelivery {
  const client = clientFactory(config);
  return {
    async deliver(input): Promise<LarkDeliveryResult> {
      let response: unknown;
      try {
        if (input.kind === 'card_patch') {
          if (!client.im.message.patch) throw new Error('patch unavailable');
          response = await client.im.message.patch({
            path: { message_id: input.targetId },
            data: { content: input.cardJson },
          });
        } else {
          response = await client.im.message.reply({
            path: { message_id: input.targetId },
            data: {
              msg_type: input.kind === 'card_reply' ? 'interactive' : 'text',
              content:
                input.kind === 'text'
                  ? JSON.stringify({ text: input.text })
                  : input.cardJson,
              reply_in_thread: true,
              uuid: input.providerRequestId,
            },
          });
        }
      } catch (error: unknown) {
        const status = errorStatus(error);
        if (status === 429 || (status !== undefined && status >= 500)) {
          return {
            result: 'retryable_failure',
            safeErrorCode: `http_${status}`,
          };
        }
        return { result: 'unknown', safeErrorCode: 'transport_unknown' };
      }
      return mapResponse(response, input.kind === 'card_patch');
    },
  };
}

function createClient(config: LarkCanaryEnabledConfig): ReplyClient {
  return new Client({
    appId: config.appId,
    appSecret: config.appSecret,
    appType: AppType.SelfBuild,
    domain: config.domain === 'feishu' ? Domain.Feishu : Domain.Lark,
  }) as unknown as ReplyClient;
}

function mapResponse(
  response: unknown,
  patchSuccessWithoutMessage = false,
): LarkDeliveryResult {
  if (!isRecord(response))
    return { result: 'unknown', safeErrorCode: 'invalid_response' };
  const code = typeof response.code === 'number' ? response.code : undefined;
  if (
    code === 0 &&
    isRecord(response.data) &&
    typeof response.data.message_id === 'string' &&
    response.data.message_id.length > 0
  ) {
    return { result: 'delivered', providerMessageId: response.data.message_id };
  }
  if (code === 0) {
    if (patchSuccessWithoutMessage) return { result: 'delivered' };
    return { result: 'unknown', safeErrorCode: 'invalid_provider_response' };
  }
  if (code === 230020 || code === 230049) {
    return { result: 'retryable_failure', safeErrorCode: `provider_${code}` };
  }
  const status =
    response.statusCode ??
    (isRecord(response.response) ? response.response.status : undefined);
  if (typeof status === 'number' && (status === 429 || status >= 500)) {
    return { result: 'retryable_failure', safeErrorCode: `http_${status}` };
  }
  if (code !== undefined)
    return { result: 'permanent_failure', safeErrorCode: 'provider_rejected' };
  return { result: 'unknown', safeErrorCode: 'invalid_response' };
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null;
}

function errorStatus(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined;
  if (typeof error.statusCode === 'number') return error.statusCode;
  if (isRecord(error.response) && typeof error.response.status === 'number')
    return error.response.status;
  return undefined;
}
