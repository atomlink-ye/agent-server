import type { ChatMessage, ConversationId } from '../components/chat/contracts';
import type { StoreListener } from './app';

export type MessageListStatus = 'idle' | 'loading' | 'ready' | 'error';
export type MessageSendStatus = 'idle' | 'sending' | 'failed';

export interface ConversationMessagesState {
  readonly status: MessageListStatus;
  readonly messages: readonly ChatMessage[];
  readonly error: string | null;
  readonly draft: string;
  readonly sendStatus: MessageSendStatus;
  readonly sendError: string | null;
  readonly failedBody: string | null;
}

export interface MessagesStore {
  getSnapshot(): Readonly<Record<ConversationId, ConversationMessagesState>>;
  getConversation(conversationId: ConversationId): ConversationMessagesState;
  subscribe(listener: StoreListener): () => void;
  load(
    conversationId: ConversationId,
    loader: (conversationId: ConversationId) => Promise<readonly ChatMessage[]>,
  ): Promise<void>;
  hydrate(conversationId: ConversationId, messages: readonly ChatMessage[]): void;
  append(conversationId: ConversationId, message: ChatMessage): void;
  clear(conversationId?: ConversationId): void;
  setDraft(conversationId: ConversationId, draft: string): void;
  beginSend(conversationId: ConversationId, body: string): boolean;
  completeSend(conversationId: ConversationId): void;
  failSend(conversationId: ConversationId, body: string, error: string): void;
}

const initialConversationState = (): ConversationMessagesState => ({
  status: 'idle',
  messages: [],
  error: null,
  draft: '',
  sendStatus: 'idle',
  sendError: null,
  failedBody: null,
});

const emptyConversationState = initialConversationState();

function normalizeMessages(
  conversationId: ConversationId,
  messages: readonly ChatMessage[],
): readonly ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  messages.forEach((message) => {
    if (message.conversationId === conversationId) byId.set(message.id, message);
  });
  return [...byId.values()].sort(
    (left, right) =>
      left.sequence - right.sequence || left.id.localeCompare(right.id),
  );
}

export function createMessagesStore(): MessagesStore {
  let snapshot: Readonly<Record<ConversationId, ConversationMessagesState>> = {};
  const listeners = new Set<StoreListener>();
  const loadVersions = new Map<ConversationId, number>();

  const notify = (): void => {
    listeners.forEach((listener) => listener());
  };

  const update = (
    conversationId: ConversationId,
    updater: (current: ConversationMessagesState) => ConversationMessagesState,
  ): void => {
    const current = snapshot[conversationId] ?? initialConversationState();
    snapshot = { ...snapshot, [conversationId]: updater(current) };
    notify();
  };

  return {
    getSnapshot: () => snapshot,
    getConversation: (conversationId) =>
      snapshot[conversationId] ?? emptyConversationState,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    load: async (conversationId, loader) => {
      const requestVersion = (loadVersions.get(conversationId) ?? 0) + 1;
      loadVersions.set(conversationId, requestVersion);
      update(conversationId, (current) => ({
        ...current,
        status: 'loading',
        error: null,
      }));
      try {
        const messages = await loader(conversationId);
        if (loadVersions.get(conversationId) !== requestVersion) return;
        const current = snapshot[conversationId] ?? emptyConversationState;
        update(conversationId, () => ({
          ...current,
          status: 'ready',
          messages: normalizeMessages(conversationId, messages),
          error: null,
        }));
      } catch {
        if (loadVersions.get(conversationId) !== requestVersion) return;
        update(conversationId, (current) => ({
          ...current,
          status: 'error',
          error: 'Unable to load messages.',
        }));
      }
    },
    hydrate: (conversationId, messages) =>
      update(conversationId, (current) => ({
        ...current,
        status: 'ready',
        messages: normalizeMessages(conversationId, messages),
        error: null,
      })),
    append: (conversationId, message) => {
      if (message.conversationId !== conversationId) return;
      update(conversationId, (current) => ({
        ...current,
        status: 'ready',
        messages: normalizeMessages(conversationId, [...current.messages, message]),
        error: null,
      }));
    },
    clear: (conversationId) => {
      if (conversationId === undefined) {
        snapshot = {};
        loadVersions.clear();
        notify();
        return;
      }
      loadVersions.delete(conversationId);
      const next = { ...snapshot };
      delete next[conversationId];
      snapshot = next;
      notify();
    },
    setDraft: (conversationId, draft) =>
      update(conversationId, (current) => ({ ...current, draft })),
    beginSend: (conversationId, body) => {
      const current = snapshot[conversationId] ?? initialConversationState();
      if (current.sendStatus === 'sending') return false;
      update(conversationId, (state) => ({
        ...state,
        sendStatus: 'sending',
        sendError: null,
        failedBody: null,
        draft: body,
      }));
      return true;
    },
    completeSend: (conversationId) =>
      update(conversationId, (current) => ({
        ...current,
        sendStatus: 'idle',
        sendError: null,
        failedBody: null,
        draft: '',
      })),
    failSend: (conversationId, body, error) =>
      update(conversationId, (current) => ({
        ...current,
        sendStatus: 'failed',
        sendError: error,
        failedBody: body,
        draft: body,
      })),
  };
}

export const messagesStore = createMessagesStore();
