import { useCallback, useEffect, useState } from 'react';
import type { WorkListItem } from '@atomlink-ye/agent-server/product-contract';

import { isFeatureUnavailable } from '../../../api/feature-availability';
import { workClient } from '../../work/clients/work-client';

const AUTO_REFRESH_INTERVAL_MS = 5_000;

export type ObserveEntry = WorkListItem;

export type ObserveEntriesQuery = {
  readonly status: 'loading' | 'ready' | 'unavailable' | 'error';
  readonly entries: readonly ObserveEntry[];
  readonly refresh: () => void;
  readonly autoRefresh: boolean;
  readonly setAutoRefresh: (value: boolean) => void;
};

export function useObserveEntries(): ObserveEntriesQuery {
  const [status, setStatus] =
    useState<ObserveEntriesQuery['status']>('loading');
  const [entries, setEntries] = useState<readonly ObserveEntry[]>([]);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const refresh = useCallback(() => {
    setStatus('loading');
    void workClient
      .list()
      .then((response) => {
        setEntries(response.works);
        setStatus('ready');
      })
      .catch((reason: unknown) => {
        setStatus(isFeatureUnavailable(reason) ? 'unavailable' : 'error');
      });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(refresh, AUTO_REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [autoRefresh, refresh]);

  return { status, entries, refresh, autoRefresh, setAutoRefresh };
}
