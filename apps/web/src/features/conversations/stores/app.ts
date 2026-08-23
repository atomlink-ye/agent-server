import type { ConversationId } from '../contracts';

export interface AppSelectionState {
  readonly selectedConversationId: ConversationId | null;
}

export type StoreListener = () => void;

export interface AppStore {
  getSnapshot(): AppSelectionState;
  subscribe(listener: StoreListener): () => void;
  select(conversationId: ConversationId): void;
  clearSelection(): void;
}

export function createAppStore(
  initialConversationId: ConversationId | null = null,
): AppStore {
  let snapshot: AppSelectionState = {
    selectedConversationId: initialConversationId,
  };
  const listeners = new Set<StoreListener>();

  const notify = (): void => {
    listeners.forEach((listener) => listener());
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    select: (conversationId) => {
      if (snapshot.selectedConversationId === conversationId) return;
      snapshot = { selectedConversationId: conversationId };
      notify();
    },
    clearSelection: () => {
      if (snapshot.selectedConversationId === null) return;
      snapshot = { selectedConversationId: null };
      notify();
    },
  };
}
