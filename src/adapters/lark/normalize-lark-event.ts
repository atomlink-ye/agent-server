import { createHash } from 'node:crypto';
import { assertCardActionToken } from '../../domain/channels/card-action.js';
import { assertChannelIdentifier } from '../../domain/channels/channel-identifiers.js';

export const CARD_ACTION_WS_REQUIRES_REAL_SMOKE = true;
const MAX_TEXT_BYTES = 8192;
const MAX_ACTION_BYTES = 8192;
export { MAX_CARD_ACTION_TOKEN_BYTES } from '../../domain/channels/card-action.js';
const MAX_CALLBACK_CONTENT_BYTES = 256;
const MAX_MEMORY_CONTENT_BYTES = 4096;

type JsonRecord = Record<string, unknown>;

export type LarkMention = {
  readonly openId: string;
  readonly userId?: string;
  readonly name?: string;
  readonly key?: string;
};

export type LarkMessageEvent = {
  readonly kind: 'message';
  readonly providerEventId: string;
  readonly externalMessageId: string;
  readonly deduplicationKey: string;
  readonly chatId: string;
  readonly rootId?: string;
  readonly threadId?: string;
  readonly replyToId?: string;
  readonly senderId: string;
  readonly text: string;
  readonly mentions: readonly LarkMention[];
};

export type LarkCommandEvent = Omit<LarkMessageEvent, 'kind' | 'text'> & {
  readonly kind: 'command';
  readonly action: {
    readonly name: 'memory_review';
    readonly decision: 'accept' | 'edit_and_accept' | 'reject' | 'invalid';
    readonly proposalId?: string;
    readonly content?: string;
  };
};

export type LarkCardActionEvent = {
  readonly kind: 'card_action';
  readonly providerEventId: string;
  readonly deduplicationKey: string;
  readonly operatorId: string;
  readonly chatId: string;
  readonly cardMessageId: string;
  readonly action: {
    readonly action:
      'accept' | 'edit_in_doc' | 'reject' | 'preview_doc' | 'accept_preview';
    readonly token: string;
  };
};

export type LarkCardCallbackResponse = {
  readonly toast: {
    readonly type: 'success' | 'info' | 'warning' | 'error';
    readonly content: string;
  };
};

export type LarkNormalizedEvent =
  LarkMessageEvent | LarkCommandEvent | LarkCardActionEvent;

export function hashCardActionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function cardActionIngressKey(input: {
  readonly cardMessageId: string;
  readonly operatorId: string;
  readonly action: LarkCardActionEvent['action']['action'];
  readonly token: string;
}): string {
  return createHash('sha256')
    .update(
      [
        input.cardMessageId,
        input.operatorId,
        input.action,
        hashCardActionToken(input.token),
      ].join('\u0000'),
      'utf8',
    )
    .digest('hex');
}

function record(value: unknown): JsonRecord {
  return typeof value === 'object' && value !== null
    ? (value as JsonRecord)
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function required(value: unknown, label: string): string {
  const result = stringValue(value);
  if (!result) throw new Error(`invalid Lark envelope: missing ${label}`);
  return result;
}

function identifier(value: unknown, label: string): string {
  const result = required(value, label);
  try {
    assertChannelIdentifier(result, label);
  } catch {
    throw new Error(`invalid Lark envelope: invalid ${label}`);
  }
  return result;
}

function bounded(value: string, label: string, maxBytes: number): string {
  if (Buffer.byteLength(value, 'utf8') > maxBytes) {
    throw new Error(
      `invalid Lark envelope: ${label} exceeds ${maxBytes} bytes`,
    );
  }
  return value;
}

export function createLarkCardCallbackResponse(
  input: unknown,
): LarkCardCallbackResponse {
  const root = record(input);
  const toast = record(root.toast);
  const type = toast.type;
  const content = toast.content;
  if (
    Object.keys(root).length !== 1 ||
    (type !== 'success' &&
      type !== 'info' &&
      type !== 'warning' &&
      type !== 'error') ||
    typeof content !== 'string'
  ) {
    throw new Error('invalid Lark card callback response');
  }
  return {
    toast: {
      type,
      content: bounded(
        content,
        'card callback content',
        MAX_CALLBACK_CONTENT_BYTES,
      ),
    },
  };
}

function id(value: unknown, key: string): string | undefined {
  return stringValue(record(value)[key]);
}

function plainText(content: unknown): string {
  const raw = stringValue(content) ?? '';
  try {
    const parsed = record(JSON.parse(raw));
    return (stringValue(parsed.text) ?? raw).replace(
      /<at[^>]*>(.*?)<\/at>/g,
      '$1',
    );
  } catch {
    return raw.replace(/<at[^>]*>(.*?)<\/at>/g, '$1');
  }
}

function memoryCommand(
  text: string,
  mentions: readonly LarkMention[],
  botOpenId?: string,
): LarkCommandEvent['action'] | undefined {
  const leadingMention = mentions.find(
    (mention) =>
      (botOpenId === undefined || mention.openId === botOpenId) &&
      [mention.name, mention.key].some(
        (value) => value !== undefined && text.startsWith(`${value} /memory`),
      ),
  );
  if (!text.startsWith('/memory') && !leadingMention) return undefined;
  const match =
    /^(?:.+?\s+)?\/memory(?:\s+([a-z-]+)(?:\s+([^\s]+)(?:\s+([\s\S]*))?)?)?$/.exec(
      text,
    );
  if (!match) return undefined;
  const decision = match[1];
  const proposalId = match[2];
  const content = match[3];
  if (
    decision !== 'accept' &&
    decision !== 'edit-and-accept' &&
    decision !== 'reject'
  ) {
    return { name: 'memory_review', decision: 'invalid' };
  }
  if (
    !proposalId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      proposalId,
    )
  ) {
    return { name: 'memory_review', decision: 'invalid' };
  }
  if (decision === 'edit-and-accept') {
    if (
      !content ||
      Buffer.byteLength(content, 'utf8') > MAX_MEMORY_CONTENT_BYTES
    )
      return { name: 'memory_review', decision: 'invalid' };
    return {
      name: 'memory_review',
      decision: 'edit_and_accept',
      proposalId,
      content,
    };
  }
  if (content !== undefined)
    return { name: 'memory_review', decision: 'invalid' };
  return { name: 'memory_review', decision, proposalId };
}

export function normalizeLarkEvent(
  input: unknown,
  options: Readonly<{ botOpenId?: string }> = {},
): LarkNormalizedEvent {
  const root = record(input);
  const header = record(root.header);
  const event = record(root.event);
  const providerEventId = required(header.event_id, 'header.event_id');
  const eventType = required(header.event_type, 'header.event_type');

  if (eventType === 'card.action.trigger') {
    const operator = record(event.operator);
    const cardProviderEventId = identifier(header.event_id, 'header.event_id');
    const operatorId = identifier(
      stringValue(operator.open_id) ?? id(operator.operator_id, 'open_id'),
      'event.operator.open_id',
    );
    const context = record(event.context);
    const action = record(event.action);
    if ((action.action_tag ?? action.tag) !== 'button')
      throw new Error('invalid Lark card action: action tag');
    let parsedValue: unknown = action.value;
    if (typeof action.value === 'string') {
      try {
        parsedValue = JSON.parse(action.value);
      } catch {
        throw new Error('invalid Lark card action: malformed value');
      }
    }
    const value = record(parsedValue);
    const actionName = value.action;
    const token = value.token;
    if (
      Object.keys(value).length !== 2 ||
      (actionName !== 'accept' &&
        actionName !== 'edit_in_doc' &&
        actionName !== 'reject' &&
        actionName !== 'preview_doc' &&
        actionName !== 'accept_preview') ||
      typeof token !== 'string'
    )
      throw new Error('invalid Lark card action: value');
    try {
      assertCardActionToken(token);
    } catch {
      throw new Error('invalid Lark card action: value');
    }
    const normalized: LarkCardActionEvent = {
      kind: 'card_action',
      providerEventId: cardProviderEventId,
      deduplicationKey: cardProviderEventId,
      operatorId,
      chatId: identifier(context.open_chat_id, 'event.context.open_chat_id'),
      cardMessageId: identifier(
        context.open_message_id,
        'event.context.open_message_id',
      ),
      action: { action: actionName, token },
    };
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_ACTION_BYTES) {
      throw new Error(
        `invalid Lark envelope: action exceeds ${MAX_ACTION_BYTES} bytes`,
      );
    }
    return normalized;
  }

  if (eventType !== 'im.message.receive_v1') {
    throw new Error(
      `invalid Lark envelope: unsupported event type ${eventType}`,
    );
  }

  const message = record(event.message);
  const messageType = required(
    message.message_type,
    'event.message.message_type',
  );
  if (messageType !== 'text') {
    throw new Error(
      `invalid Lark envelope: unsupported message type ${messageType}`,
    );
  }
  const sender = record(event.sender);
  const mentions = Array.isArray(message.mentions)
    ? message.mentions.flatMap((mention): LarkMention[] => {
        const mentionRecord = record(mention);
        const mentionId = record(mentionRecord.id);
        const openId = stringValue(mentionId.open_id);
        if (!openId) return [];
        const userId = stringValue(mentionId.user_id);
        const name = stringValue(mentionRecord.name);
        const key = stringValue(mentionRecord.key);
        return [
          {
            openId,
            ...(userId ? { userId } : {}),
            ...(name ? { name } : {}),
            ...(key ? { key } : {}),
          },
        ];
      })
    : [];
  const messageId = required(message.message_id, 'event.message.message_id');
  const chatId = required(message.chat_id, 'event.message.chat_id');
  const senderId = required(
    id(sender.sender_id, 'open_id'),
    'event.sender.sender_id.open_id',
  );
  const text = bounded(
    plainText(message.content),
    'message text',
    MAX_TEXT_BYTES,
  );
  const normalized: LarkMessageEvent = {
    kind: 'message',
    providerEventId,
    externalMessageId: messageId,
    deduplicationKey: messageId,
    chatId,
    senderId,
    text,
    mentions,
  };
  const rootId = stringValue(message.root_id);
  const threadId = stringValue(message.thread_id);
  const replyToId =
    stringValue(message.parent_id) ?? stringValue(message.upper_message_id);
  const withThread = {
    ...normalized,
    ...(rootId ? { rootId } : {}),
    ...(threadId ? { threadId } : {}),
    ...(replyToId ? { replyToId } : {}),
  };
  const command = memoryCommand(text, mentions, options.botOpenId);
  return command
    ? { ...withThread, kind: 'command' as const, action: command }
    : withThread;
}

export type SingleConsumerLock = {
  readonly acquire: () => { readonly release: () => void };
  readonly close: () => void;
};

const consumerOwners = new Map<string, symbol>();

export function createSingleConsumerLock(
  connectionKey = 'default',
): SingleConsumerLock {
  let closed = false;
  let ownedToken: symbol | undefined;
  return {
    acquire() {
      if (closed) throw new Error('consumer lock is closed');
      if (consumerOwners.has(connectionKey)) {
        throw new Error('another consumer already owns the lock');
      }
      const token = Symbol('consumer-owner');
      consumerOwners.set(connectionKey, token);
      ownedToken = token;
      let released = false;
      return {
        release: () => {
          if (released) return;
          released = true;
          if (consumerOwners.get(connectionKey) === token) {
            consumerOwners.delete(connectionKey);
            if (ownedToken === token) ownedToken = undefined;
          }
        },
      };
    },
    close() {
      closed = true;
      const token = ownedToken;
      if (token !== undefined && consumerOwners.get(connectionKey) === token) {
        consumerOwners.delete(connectionKey);
      }
      ownedToken = undefined;
    },
  };
}
