import type { AppStore } from './app';
import type { Conversation } from '../contracts';
import type { StoreListener } from './app';

export type ConversationListStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface ConversationListState {
  readonly status: ConversationListStatus;
  readonly conversations: readonly Conversation[];
  readonly error: string | null;
}

export interface ConversationsStore {
  getSnapshot(): ConversationListState;
  subscribe(listener: StoreListener): () => void;
  load(loader: () => Promise<readonly Conversation[]>): Promise<void>;
  hydrate(conversations: readonly Conversation[]): void;
  clear(): void;
  fail(error: string): void;
}

export interface ConversationsStoreOptions {
  readonly selectionStore?: AppStore;
}

const initialState: ConversationListState = {
  status: 'idle',
  conversations: [],
  error: null,
};

export function createConversationsStore(
  options: ConversationsStoreOptions = {},
): ConversationsStore {
  let snapshot = initialState;
  let loadVersion = 0;
  const listeners = new Set<StoreListener>();

  const notify = (): void => {
    listeners.forEach((listener) => listener());
  };

  const setSnapshot = (next: ConversationListState): void => {
    snapshot = next;
    notify();
  };

  const preserveSelection = (conversations: readonly Conversation[]): void => {
    const selectedConversationId =
      options.selectionStore?.getSnapshot().selectedConversationId;
    if (
      selectedConversationId !== null &&
      selectedConversationId !== undefined &&
      !conversations.some(({ id }) => id === selectedConversationId)
    ) {
      options.selectionStore?.clearSelection();
    }
  };

  const hydrate = (conversations: readonly Conversation[]): void => {
    const nextConversations = [...conversations];
    preserveSelection(nextConversations);
    setSnapshot({
      status: 'ready',
      conversations: nextConversations,
      error: null,
    });
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    load: async (loader) => {
      const requestVersion = ++loadVersion;
      setSnapshot({ ...snapshot, status: 'loading', error: null });
      try {
        const conversations = await loader();
        if (requestVersion !== loadVersion) return;
        hydrate(conversations);
      } catch {
        if (requestVersion !== loadVersion) return;
        setSnapshot({ ...snapshot, status: 'error', error: 'Unable to load conversations.' });
      }
    },
    hydrate,
    clear: () => {
      loadVersion += 1;
      options.selectionStore?.clearSelection();
      setSnapshot(initialState);
    },
    fail: (error) => setSnapshot({ ...snapshot, status: 'error', error }),
  };
}

export const conversationsStore = createConversationsStore();
