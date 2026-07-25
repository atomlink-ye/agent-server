import { randomUUID } from 'node:crypto';
import { Domain, EventDispatcher, WSClient } from '@larksuiteoapi/node-sdk';
import type { ChannelRepository } from '../../application/ports/channel-repository.js';
import type { LarkCanaryEnabledConfig } from '../../shared/config.js';
import {
  cardActionIngressKey,
  createLarkCardCallbackResponse,
  createSingleConsumerLock,
  hashCardActionToken,
  normalizeLarkEvent,
} from './normalize-lark-event.js';

type ReceiverClient = {
  start(input: { eventDispatcher: EventDispatcher }): Promise<void>;
  close(): void;
};

export function larkWebsocketDomain(
  domain: LarkCanaryEnabledConfig['domain'],
): Domain {
  return domain === 'feishu' ? Domain.Feishu : Domain.Lark;
}

export type LarkWebsocketReceiverOptions = {
  readonly config: LarkCanaryEnabledConfig;
  readonly repository: Pick<ChannelRepository, 'insertIngress'>;
  readonly clientFactory?: (config: LarkCanaryEnabledConfig) => ReceiverClient;
  readonly dispatcherFactory?: () => EventDispatcher;
  readonly idFactory?: () => string;
};

export class LarkWebsocketReceiver {
  readonly #options: LarkWebsocketReceiverOptions;
  readonly #lock;
  #client: ReceiverClient | null = null;
  #started = false;

  public constructor(options: LarkWebsocketReceiverOptions) {
    this.#options = options;
    this.#lock = createSingleConsumerLock(options.config.connectionKey);
  }

  public async start(): Promise<void> {
    if (this.#started) return;
    const owner = this.#lock.acquire();
    let client: ReceiverClient | null = null;
    try {
      const dispatcher =
        this.#options.dispatcherFactory?.() ?? new EventDispatcher({});
      dispatcher.register({
        ['im.message.receive_v1']: async (event: unknown) => {
          const normalized = normalizeLarkEvent(toNormalizedEnvelope(event), {
            botOpenId: this.#options.config.botOpenId,
          });
          if (normalized.kind !== 'message' && normalized.kind !== 'command')
            return { accepted: false };
          await this.#options.repository.insertIngress({
            id: this.#options.idFactory?.() ?? randomUUID(),
            connectionKey: this.#options.config.connectionKey,
            kind: normalized.kind,
            externalKey: normalized.externalMessageId,
            providerEventId: normalized.providerEventId,
            externalMessageId: normalized.externalMessageId,
            chatId: normalized.chatId,
            ...(normalized.rootId ? { rootMessageId: normalized.rootId } : {}),
            ...(normalized.threadId ? { threadId: normalized.threadId } : {}),
            ...(normalized.replyToId
              ? { replyToId: normalized.replyToId }
              : {}),
            externalActorId: normalized.senderId,
            botMentionVerified: normalized.mentions.some(
              (mention) => mention.openId === this.#options.config.botOpenId,
            ),
            ...(normalized.kind === 'message'
              ? { text: normalized.text }
              : { action: normalized.action }),
            normalizationVersion:
              normalized.kind === 'command'
                ? 'lark-memory-command-v1'
                : 'lark-message-v1',
          });
          return { accepted: true };
        },
        'card.action.trigger': async (event: unknown) => {
          const normalized = normalizeLarkEvent(toNormalizedEnvelope(event));
          if (normalized.kind !== 'card_action') return { accepted: false };
          await this.#options.repository.insertIngress({
            id: this.#options.idFactory?.() ?? randomUUID(),
            connectionKey: this.#options.config.connectionKey,
            kind: 'card_action',
            externalKey: cardActionIngressKey({
              cardMessageId: normalized.cardMessageId,
              operatorId: normalized.operatorId,
              action: normalized.action.action,
              token: normalized.action.token,
            }),
            providerEventId: normalized.providerEventId,
            externalMessageId: normalized.cardMessageId,
            chatId: normalized.chatId,
            externalActorId: normalized.operatorId,
            action: {
              action: normalized.action.action,
              digest: hashCardActionToken(normalized.action.token),
            },
            normalizationVersion: 'lark-card-action-v1',
          });
          return createLarkCardCallbackResponse({
            toast: { type: 'success', content: 'Received' },
          });
        },
      });
      client =
        this.#options.clientFactory?.(this.#options.config) ??
        new WSClient({
          appId: this.#options.config.appId,
          appSecret: this.#options.config.appSecret,
          domain: larkWebsocketDomain(this.#options.config.domain),
          autoReconnect: true,
        });
      await client.start({ eventDispatcher: dispatcher });
      this.#client = client;
      this.#started = true;
    } catch (error) {
      try {
        client?.close();
      } catch {
        // Preserve the startup failure while still releasing ownership.
      }
      owner.release();
      throw error;
    }
  }

  public async stop(): Promise<void> {
    if (this.#client) this.#client.close();
    this.#client = null;
    this.#started = false;
    this.#lock.close();
  }
}

function toNormalizedEnvelope(event: unknown): unknown {
  if (typeof event !== 'object' || event === null) return event;
  const root = event as Record<string, unknown>;
  if (root.header !== undefined) return event;
  return {
    header: {
      event_id: root.event_id,
      event_type: root.event_type,
    },
    event: root,
  };
}

export function createLarkWebsocketReceiver(
  options: LarkWebsocketReceiverOptions,
): LarkWebsocketReceiver {
  return new LarkWebsocketReceiver(options);
}
