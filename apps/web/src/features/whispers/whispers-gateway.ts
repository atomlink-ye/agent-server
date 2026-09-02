import { apiTransport } from '../../api/transport';

export interface WhisperOrigin {
  readonly conversationId: string | null;
  readonly triggerMessageId: string | null;
  readonly workRef: string | null;
}

export interface WhisperChannel {
  readonly id: string;
  readonly topic: string | null;
  readonly members: readonly string[];
  readonly initiatedBy: string;
  readonly origin: WhisperOrigin;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WhisperMessage {
  readonly id: string;
  readonly whisperChannelId: string;
  readonly sequence: number;
  readonly authorAgentId: string;
  readonly body: string;
  readonly createdAt: string;
}

/**
 * Read-only by design: this gateway has no `send`. Humans peek at whisper
 * channels, they never post into one -- the backend never even registers a
 * write route for `/api/whispers`, so there is nothing to call here.
 */
export async function loadWhispers(): Promise<readonly WhisperChannel[]> {
  const payload = record(await apiTransport.request('/api/whispers'));
  const whispers = payload?.whispers;
  if (!Array.isArray(whispers)) throw new Error('Invalid Whispers response.');
  return whispers.map(whisperChannel);
}

export async function loadWhisperMessages(
  whisperChannelId: string,
): Promise<readonly WhisperMessage[]> {
  const payload = record(
    await apiTransport.request(
      `/api/whispers/${encodeURIComponent(whisperChannelId)}/messages`,
    ),
  );
  const messages = payload?.messages;
  if (!Array.isArray(messages))
    throw new Error('Invalid Whisper messages response.');
  return messages.map(whisperMessage);
}

function whisperChannel(value: unknown): WhisperChannel {
  const entry = record(value);
  const origin = record(entry?.origin);
  if (!entry || !origin) throw new Error('Invalid Whisper channel.');
  return {
    id: text(entry.whisper_channel_id),
    topic: nullableText(entry.topic),
    members: stringArray(entry.members),
    initiatedBy: text(entry.initiated_by),
    origin: {
      conversationId: nullableText(origin.conversation_id),
      triggerMessageId: nullableText(origin.trigger_message_id),
      workRef: nullableText(origin.work_ref),
    },
    createdAt: text(entry.created_at),
    updatedAt: text(entry.updated_at),
  };
}

function whisperMessage(value: unknown): WhisperMessage {
  const entry = record(value);
  if (!entry) throw new Error('Invalid Whisper message.');
  return {
    id: text(entry.message_id),
    whisperChannelId: text(entry.whisper_channel_id),
    sequence: integer(entry.sequence),
    authorAgentId: text(entry.author_agent_id),
    body: text(entry.body),
    createdAt: text(entry.created_at),
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid Whisper response.');
  return value;
}
function nullableText(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
function integer(value: unknown): number {
  if (!Number.isSafeInteger(value))
    throw new Error('Invalid Whisper response.');
  return value as number;
}
function stringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string'))
    throw new Error('Invalid Whisper response.');
  return value;
}
