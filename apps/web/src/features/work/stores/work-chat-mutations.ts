import type { WorkChatMessageResponse } from '@atomlink-ye/agent-server/product-contract';
import type { StoreListener } from '../../conversations/stores/app';

export type WorkChatMutationStatus = 'idle' | 'sending' | 'failed';

export interface WorkChatMutationState {
  readonly draft: string;
  readonly status: WorkChatMutationStatus;
  readonly pendingBody: string | null;
  readonly pendingRequestId: string | null;
}

export interface WorkChatMutationStore {
  getSnapshot(): Readonly<Record<string, WorkChatMutationState>>;
  get(scope: string): WorkChatMutationState;
  subscribe(listener: StoreListener): () => void;
  setDraft(scope: string, draft: string): void;
  send(
    scope: string,
    sender: (
      body: string,
      requestId: string,
    ) => Promise<WorkChatMessageResponse>,
  ): Promise<WorkChatMessageResponse | null>;
}

const initialState = (): WorkChatMutationState => ({
  draft: '',
  status: 'idle',
  pendingBody: null,
  pendingRequestId: null,
});
const emptyState = initialState();

export function workChatScope(workId: string, workRunId?: string): string {
  return JSON.stringify([workId, workRunId ?? null]);
}

export function createWorkChatMutationStore(): WorkChatMutationStore {
  let snapshot: Readonly<Record<string, WorkChatMutationState>> = {};
  const listeners = new Set<StoreListener>();

  const update = (
    scope: string,
    updater: (current: WorkChatMutationState) => WorkChatMutationState,
  ) => {
    snapshot = {
      ...snapshot,
      [scope]: updater(snapshot[scope] ?? initialState()),
    };
    listeners.forEach((listener) => listener());
  };

  return {
    getSnapshot: () => snapshot,
    get: (scope) => snapshot[scope] ?? emptyState,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setDraft: (scope, draft) =>
      update(scope, (current) => {
        if (current.status === 'sending') return current;
        const retainsFailedAttempt =
          current.status === 'failed' && draft.trim() === current.pendingBody;
        return {
          draft,
          status: retainsFailedAttempt ? 'failed' : 'idle',
          pendingBody: retainsFailedAttempt ? current.pendingBody : null,
          pendingRequestId: retainsFailedAttempt
            ? current.pendingRequestId
            : null,
        };
      }),
    send: async (scope, sender) => {
      const current = snapshot[scope] ?? initialState();
      if (current.status === 'sending') return null;
      const body = current.draft.trim();
      if (!body) return null;
      const retrying =
        current.status === 'failed' && current.pendingBody === body;
      const requestId = retrying
        ? current.pendingRequestId!
        : crypto.randomUUID();
      update(scope, (state) => ({
        ...state,
        draft: body,
        status: 'sending',
        pendingBody: body,
        pendingRequestId: requestId,
      }));
      try {
        const message = await sender(body, requestId);
        update(scope, () => initialState());
        return message;
      } catch (error) {
        update(scope, (state) => ({
          ...state,
          draft: body,
          status: 'failed',
          pendingBody: body,
          pendingRequestId: requestId,
        }));
        throw error;
      }
    },
  };
}
