import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { chatCommands } from '../features/conversations/conversations-gateway';
import type { ChatCommands } from '../features/conversations/components/contracts';
import { createAppStore, type AppStore } from '../stores/app';
import {
  createConversationsStore,
  type ConversationsStore,
} from '../stores/conversations';
import { createMessagesStore, type MessagesStore } from '../stores/messages';

export interface AppRuntime {
  readonly commands: ChatCommands;
  readonly appStore: AppStore;
  readonly conversationsStore: ConversationsStore;
  readonly messagesStore: MessagesStore;
}

const AppRuntimeContext = createContext<AppRuntime | null>(null);

export function AppProviders({
  children,
  commands = chatCommands,
}: {
  readonly children: ReactNode;
  readonly commands?: ChatCommands;
}) {
  const appStore = useMemo(() => createAppStore(), []);
  const conversationsStore = useMemo(
    () => createConversationsStore({ selectionStore: appStore }),
    [appStore],
  );
  const messagesStore = useMemo(() => createMessagesStore(), []);
  const runtime = useMemo(
    () => ({ commands, appStore, conversationsStore, messagesStore }),
    [appStore, commands, conversationsStore, messagesStore],
  );
  return (
    <AppRuntimeContext.Provider value={runtime}>
      {children}
    </AppRuntimeContext.Provider>
  );
}

export function useAppRuntime(): AppRuntime {
  const runtime = useContext(AppRuntimeContext);
  if (!runtime) throw new Error('App runtime is not available.');
  return runtime;
}
