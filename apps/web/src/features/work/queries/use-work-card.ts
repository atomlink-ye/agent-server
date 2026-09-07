import { useEffect, useState } from 'react';

import {
  isUuid,
  loadWorkCard,
  type WorkChatCard,
} from '../../conversations/conversations-gateway';

const workCardRefreshIntervalMs = 3000;

export type WorkCardQuery =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly card: WorkChatCard };

export function useWorkCard(workRef: string | null): WorkCardQuery {
  const [state, setState] = useState<WorkCardQuery>({ status: 'loading' });

  useEffect(() => {
    if (!isUuid(workRef)) return;

    let active = true;
    let refreshInFlight = false;
    let keepRefreshing = true;
    let intervalId: number | null = null;

    const stopPolling = (): void => {
      if (intervalId === null) return;
      window.clearInterval(intervalId);
      intervalId = null;
    };

    const refresh = async (showLoading: boolean): Promise<void> => {
      if (!active || refreshInFlight) return;
      refreshInFlight = true;
      if (showLoading) setState({ status: 'loading' });
      try {
        const card = await loadWorkCard(workRef);
        if (!active) return;
        keepRefreshing = shouldRefresh(card);
        setState({ status: 'ready', card });
        if (!keepRefreshing) stopPolling();
      } catch {
        if (active) setState({ status: 'error' });
      } finally {
        refreshInFlight = false;
      }
    };

    const startPolling = (): void => {
      if (
        !active ||
        !keepRefreshing ||
        document.visibilityState !== 'visible'
      ) {
        return;
      }
      stopPolling();
      intervalId = window.setInterval(() => {
        if (document.visibilityState === 'visible') void refresh(false);
      }, workCardRefreshIntervalMs);
    };

    const handleVisibilityChange = (): void => {
      stopPolling();
      if (document.visibilityState === 'visible' && keepRefreshing) {
        void refresh(false).finally(startPolling);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    void refresh(true).finally(startPolling);

    return () => {
      active = false;
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [workRef]);

  return state;
}

/**
 * Polling follows the stages that can still change on their own. A Work that
 * has not started yet belongs here too: it is started from the Work page or by
 * the Coworker itself, and a card that stopped polling would sit on "Ready to
 * start" through the whole Run. `complete` and `problem` are terminal, and a
 * status we could not read is not made readable by asking again on a timer.
 */
function shouldRefresh(card: WorkChatCard): boolean {
  if (card.availability !== 'available') return false;
  switch (card.productState) {
    case 'not_started':
    case 'starting':
    case 'running':
    case 'needs_you':
      return true;
    default:
      return false;
  }
}
